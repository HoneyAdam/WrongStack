// Polyfill requestAnimationFrame for jsdom — flush immediately so the
// post-submit focus/selection side-effects in ChatInput don't queue up
// against the next render.
const rafCallbacks: FrameRequestCallback[] = [];
(globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = (
  cb: FrameRequestCallback,
) => {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
};
(globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame = (
  handle: number,
) => {
  rafCallbacks[handle - 1] = undefined as never as FrameRequestCallback;
};
function flushRaf() {
  const cbs = rafCallbacks.splice(0, rafCallbacks.length);
  for (const cb of cbs) if (cb) cb(performance.now());
}

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── WS hook mock ──────────────────────────────────────────────────────
// We don't care about the wire protocol here; we just need to verify
// that the three send-mode buttons call the right client methods in the
// right order. Capture every imperative call so each test can assert.
const wsCalls: Array<{ name: string; args: unknown[] }> = [];
const wsMock = {
  sendMessage: vi.fn((_content: string, _imageBase64?: string) => 'msg_id'),
  sendAbort: vi.fn(),
  refineModel: vi.fn(),
  client: {
    isConnected: true,
    send: vi.fn(),
    onStatus: () => () => {},
  },
};
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => wsMock,
}));
vi.mock('@/hooks/useProviderModels', () => ({ useProviderModels: () => [] }));

// Stub heavy presentational children so the ChatInput test stays focused
// on the send-mode buttons + Stop button.
vi.mock('@/components/RefinePanel', () => ({ RefinePanel: () => null }));
vi.mock('@/components/ChatInput/file-mention-picker', () => ({
  FileMentionPicker: () => null,
  detectAtMention: () => null,
}));

import { ChatInput } from '../../src/components/ChatInput.js';
import { useChatStore } from '../../src/stores/chat-store.js';
import { useUIStore } from '../../src/stores/ui-store.js';

beforeEach(() => {
  wsCalls.length = 0;
  wsMock.sendMessage.mockClear();
  wsMock.sendAbort.mockClear();
  wsMock.refineModel.mockClear();
  // Reset the chat store between tests so the queue / loading state
  // from one test doesn't bleed into the next.
  useChatStore.setState({
    messages: [],
    queue: [],
    isLoading: false,
  });
  // Refinement defaults to enabled in the persisted UI store, but
  // these tests focus on the plain send path. Force it off so the
  // refine branch doesn't swallow our assertions.
  useUIStore.setState({
    refineEnabled: false,
    refinePanel: null,
  });
});

afterEach(() => {
  flushRaf();
});

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

describe('ChatInput — send-mode buttons', () => {
  it('renders the three new send-mode buttons beside the input', () => {
    render(<ChatInput />);
    expect(screen.getByTestId('send-btw')).toBeDefined();
    expect(screen.getByTestId('send-steer')).toBeDefined();
    expect(screen.getByTestId('send-queue')).toBeDefined();
  });

  it('keeps the Stop button visible while the agent is running', () => {
    useChatStore.setState({ isLoading: true });
    render(<ChatInput />);

    expect(screen.getByTestId('stop')).toBeDefined();
    expect(screen.getByTestId('stop-and-edit')).toBeDefined();
    // The three send-mode buttons stay visible while running so the
    // user can still btw/steer/queue follow-ups.
    expect(screen.getByTestId('send-btw')).toBeDefined();
    expect(screen.getByTestId('send-steer')).toBeDefined();
    expect(screen.getByTestId('send-queue')).toBeDefined();
  });

  it('hides the Stop button while idle (no run to interrupt)', () => {
    render(<ChatInput />);
    expect(screen.queryByTestId('stop')).toBeNull();
    expect(screen.queryByTestId('stop-and-edit')).toBeNull();
  });

  it('btw while idle sends the message directly', () => {
    render(<ChatInput />);

    const textarea = screen.getByPlaceholderText(/Message the agent/) as HTMLTextAreaElement;
    typeInto(textarea, 'hello agent');
    fireEvent.click(screen.getByTestId('send-btw'));

    expect(wsMock.sendAbort).not.toHaveBeenCalled();
    expect(wsMock.sendMessage).toHaveBeenCalledTimes(1);
    expect(wsMock.sendMessage).toHaveBeenCalledWith('hello agent', undefined);
  });

  it('steer while idle collapses to a plain send (no abort target)', () => {
    render(<ChatInput />);

    const textarea = screen.getByPlaceholderText(/Message the agent/) as HTMLTextAreaElement;
    typeInto(textarea, 'hi');
    fireEvent.click(screen.getByTestId('send-steer'));

    expect(wsMock.sendAbort).not.toHaveBeenCalled();
    expect(wsMock.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('addQueue while idle always enqueues (does not send)', () => {
    render(<ChatInput />);

    const textarea = screen.getByPlaceholderText(/Message the agent/) as HTMLTextAreaElement;
    typeInto(textarea, 'for later');
    fireEvent.click(screen.getByTestId('send-queue'));

    expect(wsMock.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().queue).toEqual([
      { text: 'for later', mode: 'queue', addedAt: expect.any(Number) },
    ]);
  });

  it('btw while running enqueues with mode "btw" (no interrupt)', () => {
    useChatStore.setState({ isLoading: true });
    render(<ChatInput />);

    const textarea = screen.getByPlaceholderText(/Type a btw/) as HTMLTextAreaElement;
    typeInto(textarea, 'btw consider edge case');
    fireEvent.click(screen.getByTestId('send-btw'));

    expect(wsMock.sendAbort).not.toHaveBeenCalled();
    expect(wsMock.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().queue).toEqual([
      { text: 'btw consider edge case', mode: 'btw', addedAt: expect.any(Number) },
    ]);
  });

  it('steer while running aborts first, then sends', () => {
    useChatStore.setState({ isLoading: true });
    render(<ChatInput />);

    const textarea = screen.getByPlaceholderText(/Type a btw/) as HTMLTextAreaElement;
    typeInto(textarea, 'redirect please');
    fireEvent.click(screen.getByTestId('send-steer'));

    expect(wsMock.sendAbort).toHaveBeenCalledTimes(1);
    expect(wsMock.sendMessage).toHaveBeenCalledTimes(1);
    expect(wsMock.sendMessage).toHaveBeenCalledWith('redirect please', undefined);
    expect(useChatStore.getState().queue).toEqual([]);
  });

  it('addQueue while running enqueues with mode "queue"', () => {
    useChatStore.setState({ isLoading: true });
    render(<ChatInput />);

    const textarea = screen.getByPlaceholderText(/Type a btw/) as HTMLTextAreaElement;
    typeInto(textarea, 'hold this');
    fireEvent.click(screen.getByTestId('send-queue'));

    expect(wsMock.sendAbort).not.toHaveBeenCalled();
    expect(wsMock.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().queue).toEqual([
      { text: 'hold this', mode: 'queue', addedAt: expect.any(Number) },
    ]);
  });

  it('Stop button still aborts the in-flight run', () => {
    useChatStore.setState({ isLoading: true });
    render(<ChatInput />);

    fireEvent.click(screen.getByTestId('stop'));

    expect(wsMock.sendAbort).toHaveBeenCalledTimes(1);
  });

  it('Enter (form submit) defaults to btw mode', () => {
    render(<ChatInput />);

    const textarea = screen.getByPlaceholderText(/Message the agent/) as HTMLTextAreaElement;
    typeInto(textarea, 'enter key test');
    fireEvent.submit(textarea.closest('form')!);

    expect(wsMock.sendAbort).not.toHaveBeenCalled();
    expect(wsMock.sendMessage).toHaveBeenCalledTimes(1);
    expect(wsMock.sendMessage).toHaveBeenCalledWith('enter key test', undefined);
  });
});
