import type { Logger } from '@wrongstack/core';
import { describe, expect, it, vi } from 'vitest';
import { OutboundQueue } from '../../src/outbound-queue.js';

const silentLog: Logger = {
  level: 'debug',
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child() {
    return this;
  },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('OutboundQueue', () => {
  it('serialises messages to the same chat in enqueue order', async () => {
    const order: string[] = [];
    let release!: () => void;
    const send = vi.fn(
      (chatId: number, text: string) =>
        new Promise<string>((resolve) => {
          order.push(`${chatId}:${text}`);
          if (text === 'two') {
            // Hold the second send so a third enqueue can't overtake it.
            const r = new Promise<void>((res) => {
              release = () => res();
            });
            r.then(() => resolve('done'));
          } else {
            resolve('done');
          }
        }),
    );
    const queue = new OutboundQueue({
      maxPerChat: 4,
      maxConcurrency: 4,
      send: send as unknown as (c: number, t: string) => Promise<unknown>,
      log: silentLog,
    });

    const p1 = queue.enqueue({ chatId: 1, text: 'one', kind: 'notification' });
    const p2 = queue.enqueue({ chatId: 1, text: 'two', kind: 'notification' });
    const p3 = queue.enqueue({ chatId: 1, text: 'three', kind: 'notification' });

    await p1;
    await p2;
    await p3;
    release();
    await flush();

    expect(send).toHaveBeenCalledTimes(3);
    expect(order).toEqual(['1:one', '1:two', '1:three']);
  });

  it('drops the oldest notification when per-chat limit is exceeded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = () => res();
    });
    const send = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          gate.then(() => resolve('done'));
        }),
    );
    const debug = vi.fn();
    const log: Logger = {
      level: 'debug',
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug,
      trace: vi.fn(),
      child() {
        return this;
      },
    };
    const queue = new OutboundQueue({
      maxPerChat: 2,
      maxConcurrency: 4,
      send: send as unknown as (c: number, t: string) => Promise<unknown>,
      log,
    });

    const p1 = queue.enqueue({ chatId: 1, text: 'one', kind: 'notification' });
    const p2 = queue.enqueue({ chatId: 1, text: 'two', kind: 'notification' });
    // The third enqueue while the first is still pending must drop the oldest.
    const p3 = queue.enqueue({ chatId: 1, text: 'three', kind: 'notification' });
    const p4 = queue.enqueue({ chatId: 1, text: 'four', kind: 'notification' });

    // All notification enqueue promises resolve immediately on accept.
    await Promise.all([p1, p2, p3, p4]);

    const stats = queue.stats();
    expect(stats.dropped).toBe(2);
    expect(stats.pending).toBe(2);

    release();
    await flush();

    // Only 'three' and 'four' should have made it to the transport.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((c) => c[1])).toEqual(['three', 'four']);

    // Drop reason is recorded.
    expect(
      debug.mock.calls.some(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('per-chat limit') &&
          args[0].includes('chat 1'),
      ),
    ).toBe(true);
  });

  it('settles every notification promise exactly once, even when dropped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = () => res();
    });
    const send = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          gate.then(() => resolve('done'));
        }),
    );
    const queue = new OutboundQueue({
      maxPerChat: 1,
      maxConcurrency: 1,
      send: send as unknown as (c: number, t: string) => Promise<unknown>,
      log: silentLog,
    });

    const accept1 = queue.enqueue({ chatId: 1, text: 'a', kind: 'notification' });
    const accept2 = queue.enqueue({ chatId: 1, text: 'b', kind: 'notification' });
    // The third notification overflows → oldest (a) gets dropped.
    const accept3 = queue.enqueue({ chatId: 1, text: 'c', kind: 'notification' });

    await expect(accept1).resolves.toBeUndefined();
    await expect(accept2).resolves.toBeUndefined();
    await expect(accept3).resolves.toBeUndefined();

    release();
    await flush();
    await queue.stop();

    // No leaked pending resolvers.
    expect(queue.stats().pending).toBe(0);
  });

  it('rejects a manual entry instead of silently dropping on overflow', async () => {
    const debug = vi.fn();
    const log: Logger = {
      level: 'debug',
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug,
      trace: vi.fn(),
      child() {
        return this;
      },
    };
    const gate = new Promise<void>(() => {});
    const send = vi.fn(() => gate);
    const queue = new OutboundQueue({
      maxPerChat: 1,
      maxConcurrency: 1,
      send: send as unknown as (c: number, t: string) => Promise<unknown>,
      log,
    });

    const manual1 = queue.enqueue({ chatId: 1, text: 'first', kind: 'manual' });
    // The second manual entry for the same chat must surface the overflow as
    // a real error rather than be silently dropped.
    const manual2 = queue.enqueue({ chatId: 1, text: 'second', kind: 'manual' });

    await expect(manual2).rejects.toThrow(/per-chat limit/);
    expect(manual1).toBeDefined();
  });

  it('dispatches independent chats in parallel up to maxConcurrency', async () => {
    let active = 0;
    let peak = 0;
    const send = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 25));
      active -= 1;
      return 'ok';
    });
    const queue = new OutboundQueue({
      maxPerChat: 4,
      maxConcurrency: 2,
      send: send as unknown as (c: number, t: string) => Promise<unknown>,
      log: silentLog,
    });

    const promises = [
      queue.enqueue({ chatId: 1, text: 'a', kind: 'manual' }),
      queue.enqueue({ chatId: 2, text: 'b', kind: 'manual' }),
      queue.enqueue({ chatId: 3, text: 'c', kind: 'manual' }),
      queue.enqueue({ chatId: 4, text: 'd', kind: 'manual' }),
    ];

    await Promise.all(promises);
    await flush();

    expect(peak).toBeLessThanOrEqual(2);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('preserves caller-to-result correlation for two interleaved manual sends to the same chat', async () => {
    // Regression for the original `#keyOf` resolver-key bug: two manual
    // sends enqueued before either is dispatched must each settle with
    // their own send-result, not with the other caller's.
    let releaseFirst!: () => void;
    const first = new Promise<string>((resolve) => {
      releaseFirst = () => resolve('first-result');
    });
    const send = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => 'second-result');
    const queue = new OutboundQueue({
      maxPerChat: 4,
      maxConcurrency: 4,
      send: send as unknown as (c: number, t: string) => Promise<unknown>,
      log: silentLog,
    });

    const p1 = queue.enqueue({ chatId: 7, text: 'first', kind: 'manual' });
    const p2 = queue.enqueue({ chatId: 7, text: 'second', kind: 'manual' });

    // Release the first send; the second's promise must still settle with
    // its own result (not hang and not resolve with 'first-result').
    releaseFirst();
    await expect(p1).resolves.toBe('first-result');
    await expect(p2).resolves.toBe('second-result');

    await queue.stop();
  });

  it('rejects manual entries after stop()', async () => {
    const queue = new OutboundQueue({
      maxPerChat: 4,
      send: vi.fn(async () => 'ok') as unknown as (c: number, t: string) => Promise<unknown>,
      log: silentLog,
    });
    await queue.stop();

    await expect(queue.enqueue({ chatId: 1, text: 'after-stop', kind: 'manual' })).rejects.toThrow(
      /stopped/,
    );
  });
});
