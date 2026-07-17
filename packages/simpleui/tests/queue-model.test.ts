import { describe, expect, it } from 'vitest';
import {
  dequeueItem,
  enqueueFront,
  enqueueItem,
  type QueuedItem,
  removeQueuedAt,
  resolveSendPlan,
  sortQueueForDisplay,
} from '../src/lib/queue-model.js';

function item(id: string, addedAt: number, overrides: Partial<QueuedItem> = {}): QueuedItem {
  return { id, text: `msg-${id}`, mode: 'btw', addedAt, ...overrides };
}

describe('resolveSendPlan', () => {
  it('always enqueues queue mode, even while idle', () => {
    expect(resolveSendPlan('queue', false)).toBe('enqueue');
    expect(resolveSendPlan('queue', true)).toBe('enqueue');
  });

  it('sends btw straight through while idle and holds it while running', () => {
    expect(resolveSendPlan('btw', false)).toBe('send');
    expect(resolveSendPlan('btw', true)).toBe('enqueue');
  });

  it('collapses steer to a plain send while idle', () => {
    // Nothing is in flight, so there is no run to abort.
    expect(resolveSendPlan('steer', false)).toBe('send');
  });

  it('aborts and parks at the queue head when steering a live run', () => {
    // Not an inline send: the abort makes the server emit run.result, and a
    // send here would race the drain that fires from it.
    expect(resolveSendPlan('steer', true)).toBe('abort-then-enqueue-front');
  });
});

describe('enqueueFront', () => {
  it('parks the item at the head so the next drain takes it first', () => {
    const queue = [item('a', 1), item('b', 2)];
    const next = enqueueFront(queue, item('steer', 3, { mode: 'steer' }));
    expect(next.map((entry) => entry.id)).toEqual(['steer', 'a', 'b']);
    expect(dequeueItem(next).item?.id).toBe('steer');
    expect(queue).toHaveLength(2);
  });
});

describe('enqueueItem', () => {
  it('appends in arrival order without mutating the input', () => {
    const queue = [item('a', 1)];
    const next = enqueueItem(queue, item('b', 2));
    expect(next.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(queue).toHaveLength(1);
  });
});

describe('dequeueItem', () => {
  it('pops the oldest item and returns the rest', () => {
    const { item: first, rest } = dequeueItem([item('a', 1), item('b', 2)]);
    expect(first?.id).toBe('a');
    expect(rest.map((entry) => entry.id)).toEqual(['b']);
  });

  it('returns null on an empty queue', () => {
    expect(dequeueItem([]).item).toBeNull();
  });

  it('drains in arrival order regardless of mode', () => {
    const queue = [item('a', 1, { mode: 'queue' }), item('b', 2, { mode: 'btw' })];
    expect(dequeueItem(queue).item?.id).toBe('a');
  });
});

describe('removeQueuedAt', () => {
  it('removes the item at the index', () => {
    const next = removeQueuedAt([item('a', 1), item('b', 2), item('c', 3)], 1);
    expect(next.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('leaves the queue intact for an out-of-range index', () => {
    // A -1 arrives when a lookup by id misses; it must not drop an item.
    expect(removeQueuedAt([item('a', 1)], -1).map((entry) => entry.id)).toEqual(['a']);
    expect(removeQueuedAt([item('a', 1)], 5).map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('sortQueueForDisplay', () => {
  it('sorts a copy and never disturbs the stored drain order', () => {
    const queue = [item('a', 1), item('b', 2)];
    const newest = sortQueueForDisplay(queue, 'newest');
    expect(newest.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(sortQueueForDisplay(queue, 'oldest').map((entry) => entry.id)).toEqual(['a', 'b']);
    // The source array keeps arrival order — the drain reads this, not the view.
    expect(queue.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});
