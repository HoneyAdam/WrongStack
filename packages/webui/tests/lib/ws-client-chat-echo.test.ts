import { afterEach, describe, expect, it, vi } from 'vitest';
import { WrongStackWebSocketClient } from '../../src/lib/ws-client.js';

describe('WrongStackWebSocketClient chat echo suppression', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('suppresses exactly one matching response for a UI data request', () => {
    const client = new WrongStackWebSocketClient('ws://127.0.0.1:3457');

    client.listSkills({ echoToChat: false });

    expect(client.consumeSuppressedChatEcho('skills.list')).toBe(true);
    expect(client.consumeSuppressedChatEcho('skills.list')).toBe(false);
  });

  it('keeps normal inspect commands eligible for chat output', () => {
    const client = new WrongStackWebSocketClient('ws://127.0.0.1:3457');

    client.listSkills();
    client.getStats();

    expect(client.consumeSuppressedChatEcho('skills.list')).toBe(false);
    expect(client.consumeSuppressedChatEcho('stats.get')).toBe(false);
  });

  it('tracks concurrent UI requests independently by response type', () => {
    const client = new WrongStackWebSocketClient('ws://127.0.0.1:3457');

    client.listSageMemories({ echoToChat: false });
    client.listSageMemories({ echoToChat: false });
    client.debugContext({ echoToChat: false });

    expect(client.consumeSuppressedChatEcho('memory.sage.list')).toBe(true);
    expect(client.consumeSuppressedChatEcho('context.debug')).toBe(true);
    expect(client.consumeSuppressedChatEcho('memory.sage.list')).toBe(true);
    expect(client.consumeSuppressedChatEcho('memory.sage.list')).toBe(false);
  });

  it('expires a suppression when the UI request never receives a response', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    const client = new WrongStackWebSocketClient('ws://127.0.0.1:3457');
    client.listTools({ echoToChat: false });

    vi.advanceTimersByTime(30_001);

    expect(client.consumeSuppressedChatEcho('tools.list')).toBe(false);
  });
});
