import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePasteDrop } from '../../src/components/ChatInput/use-paste-drop.js';
import { useFileReferenceStore } from '../../src/stores/file-reference-store.js';

// Mock autoFenceCode so we can control when code-fencing triggers
vi.mock('../../src/components/ChatInput/code-detect.js', () => ({
  autoFenceCode: vi.fn(),
}));

// Mock the image pipeline — jsdom has no real image decoding/canvas, so
// processImageFile is replaced with a deterministic fake. Every export the
// hook consumes must be present in the factory (missing ones throw at access).
vi.mock('../../src/components/ChatInput/image-attachments.js', () => {
  class ImageAttachmentError extends Error {
    constructor(
      message: string,
      readonly reason: string,
    ) {
      super(message);
    }
  }
  let seq = 0;
  return {
    ImageAttachmentError,
    MAX_ATTACHED_IMAGES: 8,
    processImageFile: vi.fn(async (file: File) => {
      seq += 1;
      return {
        id: `img_${seq}`,
        dataUrl: 'data:image/png;base64,AAAA',
        mediaType: file.type || 'image/png',
        bytes: 4,
        name: file.name,
      };
    }),
  };
});

// Mock toast so attachment errors don't need a mounted Toaster.
vi.mock('../../src/components/Toaster.js', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

function mockTextarea(selectionStart = 0, selectionEnd = 0): HTMLTextAreaElement {
  const ta = {
    selectionStart,
    selectionEnd,
    focus: vi.fn(),
    setSelectionRange: vi.fn(),
    style: { height: '' },
    scrollHeight: 100,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return ta as never as HTMLTextAreaElement;
}

function makeHookOptions(overrides: { input?: string; selectionStart?: number } = {}) {
  const textarea = mockTextarea(overrides.selectionStart ?? 0, overrides.selectionStart ?? 0);
  const textareaRef = { current: textarea };
  const setInput = vi.fn();
  const setAtMention = vi.fn();

  return {
    textarea,
    textareaRef,
    setInput,
    setAtMention,
    options: {
      input: overrides.input ?? '',
      textareaRef: textareaRef as React.RefObject<HTMLTextAreaElement | null>,
      setInput,
      errorText: {
        tooManyImages: (max: number) => `too many (${max})`,
        imageProcessFailed: (name: string) => `failed ${name}`,
        imageTooLarge: (name: string) => `too large ${name}`,
      },
    },
  };
}

describe('usePasteDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileReferenceStore.setState({ refs: [] });
  });

  describe('initial state', () => {
    it('returns null pasteHint and false draggingOver initially', () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      expect(result.current.pasteHint).toBeNull();
      expect(result.current.draggingOver).toBe(false);
      expect(result.current.pendingImagesRef.current).toEqual([]);
      expect(result.current.pendingImages).toEqual([]);
    });
  });

  describe('drag/drop handlers', () => {
    it('onDragEnter sets draggingOver true for file drags', () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      const event = {
        dataTransfer: { types: ['Files'] },
        preventDefault: vi.fn(),
      } as never as React.DragEvent<HTMLFormElement>;

      act(() => result.current.onDragEnter(event));

      expect(result.current.draggingOver).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('onDragEnter ignores non-file drags', () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      const event = {
        dataTransfer: { types: ['text/plain'] },
        preventDefault: vi.fn(),
      } as never as React.DragEvent<HTMLFormElement>;

      act(() => result.current.onDragEnter(event));

      expect(result.current.draggingOver).toBe(false);
    });

    it('onDragOver prevents default for file drags and sets dropEffect', () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      const event = {
        dataTransfer: { types: ['Files'], dropEffect: '' },
        preventDefault: vi.fn(),
      } as never as React.DragEvent<HTMLFormElement>;

      act(() => result.current.onDragOver(event));

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.dataTransfer.dropEffect).toBe('copy');
    });

    it('onDragLeave clears draggingOver when cursor leaves form', () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      act(() => result.current.onDragEnter({
        dataTransfer: { types: ['Files'] },
        preventDefault: vi.fn(),
      } as never as React.DragEvent<HTMLFormElement>));

      expect(result.current.draggingOver).toBe(true);

      act(() => result.current.onDragLeave({
        currentTarget: { contains: () => false },
        relatedTarget: null,
      } as never as React.DragEvent<HTMLFormElement>));

      expect(result.current.draggingOver).toBe(false);
    });

    it('onDrop shows a toast for non-image files (browser strips paths)', () => {
      const { options, setInput } = makeHookOptions({ input: 'hello', selectionStart: 5 });

      const { result } = renderHook(() => usePasteDrop(options));

      const file = { name: 'test.ts' } as File;
      const event = {
        dataTransfer: { files: [file] },
        preventDefault: vi.fn(),
      } as never as React.DragEvent<HTMLFormElement>;

      act(() => result.current.onDrop(event));

      expect(event.preventDefault).toHaveBeenCalled();
      // Non-image drops no longer create ref chips (browser strips the path).
      expect(setInput).not.toHaveBeenCalled();
      const refs = useFileReferenceStore.getState().refs;
      expect(refs).toHaveLength(0);
    });

    it('onDrop with an image file attaches it instead of inserting an @mention', async () => {
      const { options, setInput } = makeHookOptions({ input: 'hi', selectionStart: 2 });
      const { result } = renderHook(() => usePasteDrop(options));

      const imageFile = new File(['fake-bytes'], 'shot.png', { type: 'image/png' });
      const event = {
        dataTransfer: { files: [imageFile] },
        preventDefault: vi.fn(),
      } as never as React.DragEvent<HTMLFormElement>;

      act(() => {
        result.current.onDrop(event);
      });

      // No @mention insertion for a pure-image drop (synchronous decision).
      expect(setInput).not.toHaveBeenCalled();
      // Image processing resolves asynchronously — poll until the chip lands.
      await waitFor(() => {
        expect(result.current.pendingImages).toHaveLength(1);
        expect(result.current.pendingImages[0]?.dataUrl).toMatch(/^data:image\/png/);
        expect(result.current.pendingImages[0]?.name).toBe('shot.png');
      });
    });

    it('onDrop attaches multiple images in order', async () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));
      const files = [
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      ];

      act(() => {
        result.current.onDrop({
          dataTransfer: { files },
          preventDefault: vi.fn(),
        } as never as React.DragEvent<HTMLFormElement>);
      });

      await waitFor(() => {
        expect(result.current.pendingImages.map((i) => i.name)).toEqual(['a.png', 'b.jpg']);
      });
    });

    it('removeImage removes one chip; clearPendingImages resets all', async () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));
      const files = [
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.png', { type: 'image/png' }),
      ];

      await act(async () => {
        await result.current.addImageFiles(files);
      });
      expect(result.current.pendingImages).toHaveLength(2);

      const firstId = result.current.pendingImages[0]?.id as string;
      act(() => result.current.removeImage(firstId));
      expect(result.current.pendingImages).toHaveLength(1);
      expect(result.current.pendingImages[0]?.name).toBe('b.png');

      act(() => result.current.clearPendingImages());
      expect(result.current.pendingImages).toEqual([]);
      expect(result.current.pendingImagesRef.current).toEqual([]);
    });

    it('onDrop with empty files clears draggingOver and returns', () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      const event = {
        dataTransfer: { files: [] },
        preventDefault: vi.fn(),
      } as never as React.DragEvent<HTMLFormElement>;

      act(() => result.current.onDrop(event));

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(result.current.draggingOver).toBe(false);
    });
  });

  describe('onTextPaste', () => {
    it('ignores empty paste text', () => {
      const { options, setInput } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      const event = {
        clipboardData: { getData: () => '' },
        preventDefault: vi.fn(),
      } as never as React.ClipboardEvent<HTMLTextAreaElement>;

      act(() => result.current.onTextPaste(event));

      expect(setInput).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('auto-fences code paste and sets pasteHint with undo', async () => {
      const { autoFenceCode } = await import('../../src/components/ChatInput/code-detect.js');
      vi.mocked(autoFenceCode).mockReturnValue({
        lang: 'typescript',
        fenced: '```typescript\nconst x = 1;\n```',
      });

      const { options, setInput, _textarea } = makeHookOptions({ input: 'before ', selectionStart: 7 });
      const { result } = renderHook(() => usePasteDrop(options));

      const event = {
        clipboardData: { getData: () => 'const x = 1;' },
        preventDefault: vi.fn(),
      } as never as React.ClipboardEvent<HTMLTextAreaElement>;

      act(() => result.current.onTextPaste(event));

      expect(event.preventDefault).toHaveBeenCalled();
      expect(setInput).toHaveBeenCalledTimes(1);
      const inserted = setInput.mock.calls[0][0] as string;
      expect(inserted).toContain('```typescript');
      expect(result.current.pasteHint).not.toBeNull();
      expect(result.current.pasteHint?.lang).toBe('typescript');
      expect(result.current.pasteHint?.undoFence).toBeDefined();
    });

    it('shows hint for large non-code paste (>800 chars)', async () => {
      const { autoFenceCode } = await import('../../src/components/ChatInput/code-detect.js');
      vi.mocked(autoFenceCode).mockReturnValue(null);

      const largeText = 'x'.repeat(900);
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      const event = {
        clipboardData: { getData: () => largeText },
        preventDefault: vi.fn(),
      } as never as React.ClipboardEvent<HTMLTextAreaElement>;

      act(() => result.current.onTextPaste(event));

      expect(result.current.pasteHint).not.toBeNull();
      expect(result.current.pasteHint?.chars).toBe(900);
      expect(result.current.pasteHint?.lang).toBeUndefined();
    });

    it('does nothing for small non-code paste', async () => {
      const { autoFenceCode } = await import('../../src/components/ChatInput/code-detect.js');
      vi.mocked(autoFenceCode).mockReturnValue(null);

      const { options, setInput } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      const event = {
        clipboardData: { getData: () => 'short' },
        preventDefault: vi.fn(),
      } as never as React.ClipboardEvent<HTMLTextAreaElement>;

      act(() => result.current.onTextPaste(event));

      expect(setInput).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(result.current.pasteHint).toBeNull();
    });
  });

  describe('setPasteHint', () => {
    it('exposes setPasteHint for external dismissal', () => {
      const { options } = makeHookOptions();
      const { result } = renderHook(() => usePasteDrop(options));

      expect(result.current.setPasteHint).toBeDefined();
      expect(typeof result.current.setPasteHint).toBe('function');
    });
  });
});
