import { describe, expect, it } from 'vitest';
import { RunController } from '../../src/kernel/run-controller.js';

describe('RunController', () => {
  it('signal aborts when abort() is called', () => {
    const c = new RunController();
    expect(c.aborted).toBe(false);
    c.abort('test');
    expect(c.aborted).toBe(true);
    expect(c.signal.aborted).toBe(true);
  });

  it('fires hooks in LIFO order on abort', async () => {
    const c = new RunController();
    const order: number[] = [];
    c.onAbort(() => void order.push(1));
    c.onAbort(() => void order.push(2));
    c.onAbort(() => void order.push(3));
    c.abort();
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual([3, 2, 1]);
  });

  it('fires hooks on dispose() when run ends normally', async () => {
    const c = new RunController();
    const fired: string[] = [];
    c.onAbort(() => void fired.push('a'));
    c.onAbort(() => void fired.push('b'));
    await c.dispose();
    expect(fired).toEqual(['b', 'a']);
    expect(c.aborted).toBe(false);
  });

  it('hooks fire exactly once across abort + dispose', async () => {
    const c = new RunController();
    let count = 0;
    c.onAbort(() => {
      count++;
    });
    c.abort();
    await new Promise((r) => setImmediate(r));
    await c.dispose();
    expect(count).toBe(1);
  });

  it('unsubscribe stops a hook from firing', async () => {
    const c = new RunController();
    let fired = false;
    const off = c.onAbort(() => {
      fired = true;
    });
    off();
    c.abort();
    await new Promise((r) => setImmediate(r));
    expect(fired).toBe(false);
  });

  it('propagates abort from a parent signal', () => {
    const parent = new AbortController();
    const c = new RunController({ parentSignal: parent.signal });
    expect(c.aborted).toBe(false);
    parent.abort('upstream');
    expect(c.aborted).toBe(true);
  });

  it('inherits an already-aborted parent signal', () => {
    const parent = new AbortController();
    parent.abort('pre');
    const c = new RunController({ parentSignal: parent.signal });
    expect(c.aborted).toBe(true);
  });

  it('routes hook errors through errorSink instead of throwing', async () => {
    const errs: string[] = [];
    const c = new RunController({
      errorSink: (err) => errs.push(err instanceof Error ? err.message : String(err)),
    });
    c.onAbort(() => {
      throw new Error('boom');
    });
    c.onAbort(() => undefined);
    c.abort();
    await new Promise((r) => setImmediate(r));
    expect(errs).toEqual(['boom']);
  });

  it('awaits async hooks before dispose resolves', async () => {
    const c = new RunController();
    let done = false;
    c.onAbort(async () => {
      await new Promise((r) => setTimeout(r, 5));
      done = true;
    });
    await c.dispose();
    expect(done).toBe(true);
  });
});
