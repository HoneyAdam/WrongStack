import type { Logger } from '@wrongstack/core';
import { describe, expect, it, vi } from 'vitest';
import { TelegramBotOutbound } from '../../src/bot-queue.js';
import type { TelegramBot } from '../../src/bot.js';

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

const makeBot = (sendImpl: ReturnType<typeof vi.fn>) =>
  ({
    sendMessage: sendImpl,
  }) as unknown as TelegramBot;

describe('TelegramBotOutbound', () => {
  it('routes manual sends through the queue and resolves with the bot result', async () => {
    const send = vi.fn(async () => ({
      ok: true as const,
      result: { message_id: 1, chat: { id: 99, type: 'private' as const } },
    }));
    const queue = new TelegramBotOutbound({
      bot: makeBot(send),
      log: silentLog,
      maxPerChat: 4,
      maxConcurrency: 2,
    });

    const result = await queue.sendManual(99, 'hello');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(99, 'hello');
    expect(result.ok).toBe(true);
    await queue.stop();
  });

  it('routes notifications through the queue fire-and-forget', async () => {
    const send = vi.fn(async () => ({
      ok: true as const,
      result: { message_id: 2, chat: { id: 99, type: 'private' as const } },
    }));
    const queue = new TelegramBotOutbound({
      bot: makeBot(send),
      log: silentLog,
      maxPerChat: 4,
      maxConcurrency: 1,
    });

    queue.enqueueNotification(99, 'one');
    queue.enqueueNotification(99, 'two');

    // Drain.
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((c) => c[1])).toEqual(['one', 'two']);
    await queue.stop();
  });

  it('surfaces a manual overflow as an error rather than silently dropping', async () => {
    const gate = new Promise<void>(() => {});
    const send = vi.fn(() => gate);
    const queue = new TelegramBotOutbound({
      bot: makeBot(send),
      log: silentLog,
      maxPerChat: 1,
      maxConcurrency: 1,
    });

    const first = queue.sendManual(99, 'first');
    await expect(queue.sendManual(99, 'second')).rejects.toThrow(/per-chat limit|stopped/);
    // The first manual is still in flight; stop() must drain and reject cleanly.
    await queue.stop();
    await expect(first).rejects.toThrow(/stopped/);
  });
});
