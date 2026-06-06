import type { ContentBlock } from './blocks.js';

export type AttachmentKind = 'text' | 'image' | 'file';

export interface AttachmentMeta {
  /** Display label for the placeholder e.g. "123 lines" or "PNG 412 KB". */
  label?: string | undefined;
  /** Original filename if known. */
  filename?: string | undefined;
  /** MIME type if known. Required for images. */
  mediaType?: string | undefined;
}

export interface Attachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly meta: AttachmentMeta;
  /** In-memory payload. For images this is base64; for text/file it's the raw text. */
  readonly data?: string | undefined;
  /** Disk location if spooled. Mutually exclusive with `data` for large payloads. */
  readonly path?: string | undefined;
  readonly bytes: number;
  readonly createdAt: string;
}

export interface AttachmentRef {
  readonly id: string;
  readonly kind: AttachmentKind;
  /** Index for display, e.g. `#1`. Stable for the lifetime of a session. */
  readonly seq: number;
  readonly meta: AttachmentMeta;
}

export interface AddAttachmentInput {
  kind: AttachmentKind;
  data: string;
  meta?: AttachmentMeta | undefined;
}

/**
 * Session-scoped store for content that is too big to inline in display
 * but must be sent to the model as a real ContentBlock. The input layer
 * (CLI/TUI) puts pasted text, dropped files, and pasted images here, gets
 * back a stable AttachmentRef, and shows a placeholder like `[pasted #1]`
 * to the user. At submit time, `expand()` swaps placeholders for the real
 * payload as ContentBlock[].
 */
export interface AttachmentStore {
  add(input: AddAttachmentInput): Promise<AttachmentRef>;
  get(id: string): Promise<Attachment | undefined>;
  list(): AttachmentRef[];
  /**
   * Replace all known placeholder tokens in `text` (e.g. `[pasted #1]`,
   * `[image #2]`) with the corresponding ContentBlock(s) and return the
   * mixed array. Unknown placeholders are left as plain text.
   */
  expand(text: string): Promise<ContentBlock[]>;
  clear(): Promise<void>;
}
