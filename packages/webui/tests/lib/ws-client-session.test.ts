import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamCoalescer } from '../../src/lib/stream-coalescer';
import { WrongStackWebSocketClient } from '../../src/lib/ws-client';

describe('WrongStackWebSocketClient session transitions', () => {
  beforeEach(() => {
    streamCoalescer.dropAll();
  });

  it('drops pending streams before requesting a new session', () => {
    const flush = vi.fn();
    const client = new WrongStackWebSocketClient('ws://127.0.0.1:3457');
    streamCoalescer.push('__thinking__', 'stale thinking', flush);

    client.newSession();
    streamCoalescer.flushAll();

    expect(flush).not.toHaveBeenCalled();
  });

  it('drops pending streams before resuming a session', () => {
    const flush = vi.fn();
    const client = new WrongStackWebSocketClient('ws://127.0.0.1:3457');
    streamCoalescer.push('assistant_1', 'stale assistant text', flush);

    client.resumeSessionById('sess_1');
    streamCoalescer.flushAll();

    expect(flush).not.toHaveBeenCalled();
  });

  it('drops pending streams for direct context clear messages', () => {
    const flush = vi.fn();
    const client = new WrongStackWebSocketClient('ws://127.0.0.1:3457');
    streamCoalescer.push('__thinking__', 'stale thinking', flush);

    client.send({ type: 'context.clear' });
    streamCoalescer.flushAll();

    expect(flush).not.toHaveBeenCalled();
  });

  it('drops pending streams for project switches', () => {
    const flush = vi.fn();
    const client = new WrongStackWebSocketClient('ws://127.0.0.1:3457');
    streamCoalescer.push('assistant_1', 'stale assistant text', flush);

    client.send({ type: 'projects.select', payload: { root: '/tmp/other' } });
    streamCoalescer.flushAll();

    expect(flush).not.toHaveBeenCalled();
  });
});
