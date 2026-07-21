import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ws-client', () => ({
  getWSClient: () => ({ send: vi.fn() }),
}));

vi.mock('@/components/Toaster', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { toast } from '../../src/components/Toaster';
import { WS_HANDLERS } from '../../src/hooks/ws-handlers';
import { useChatStore } from '../../src/stores/chat-store';
import { wsToVizEvent } from '../../src/stores/viz-store';

function fire(payload: Record<string, unknown>) {
  WS_HANDLERS['tool.loop_detected']?.({ type: 'tool.loop_detected', payload } as never);
}

describe('loop-detection ws-handler', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    vi.clearAllMocks();
  });

  it('keeps a steer advisory out of the error transcript', () => {
    fire({ tools: 'read', repeatCount: 3, iteration: 2, action: 'steer' });

    expect(useChatStore.getState().messages).toEqual([]);
    expect(toast.info).toHaveBeenCalledWith(
      'Possible repetition noticed for read; changing approach.',
    );
    expect(toast.warn).not.toHaveBeenCalled();
  });

  it('shows a real cut as an error using a one-based iteration number', () => {
    fire({ tools: 'read', repeatCount: 5, iteration: 4, action: 'cut' });

    expect(useChatStore.getState().messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Loop guard stopped the turn: read made no progress 5 time(s) (iteration 5).',
      isError: true,
    });
    expect(toast.warn).toHaveBeenCalledWith('Loop guard stopped the turn');
  });

  it('renders steer as status and cut as error in the visualization', () => {
    expect(
      wsToVizEvent('tool.loop_detected', {
        tools: 'read',
        repeatCount: 3,
        action: 'steer',
      })?.kind,
    ).toBe('agent:status');
    expect(
      wsToVizEvent('tool.loop_detected', {
        tools: 'read',
        repeatCount: 5,
        action: 'cut',
      })?.kind,
    ).toBe('error');
  });
});
