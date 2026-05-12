import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/kernel/events.js';

describe('EventBus', () => {
  it('emits to subscribers', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('session.started', fn);
    bus.emit('session.started', { id: 'abc' });
    expect(fn).toHaveBeenCalledWith({ id: 'abc' });
  });

  it('multiple subscribers each receive', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('session.started', a);
    bus.on('session.started', b);
    bus.emit('session.started', { id: '1' });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('off unsubscribes', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('session.started', fn);
    bus.off('session.started', fn);
    bus.emit('session.started', { id: '1' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('listener errors are isolated', () => {
    const bus = new EventBus();
    bus.setLogger({ error: () => undefined });
    const good = vi.fn();
    bus.on('session.started', () => {
      throw new Error('bad');
    });
    bus.on('session.started', good);
    bus.emit('session.started', { id: '1' });
    expect(good).toHaveBeenCalled();
  });

  it('unsubscribe returned from on()', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('session.started', fn);
    off();
    bus.emit('session.started', { id: '1' });
    expect(fn).not.toHaveBeenCalled();
  });
});
