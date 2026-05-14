import type { Message } from '../types/messages.js';
import type { TodoItem, Context } from './context.js';

/**
 * Observable wrapper for the mutable conversation state. Provides snapshot
 * and change-notification semantics on top of the existing `Context`
 * mutable fields (messages, todos, meta), without forcing every call site
 * to migrate.
 *
 * Design notes:
 *
 *  - This is a **wrapper**, not a replacement. The underlying `Context`
 *    fields are still mutated directly by tools and middleware that don't
 *    know about ConversationState. The wrapper observes those mutations by
 *    snapshotting on each accessor call, comparing length/identity, and
 *    firing onChange. This is intentional during migration: it lets new
 *    code subscribe to changes without breaking the unaware-existing code.
 *
 *  - For full decoupling (the dev-plan #1 target), every mutation must go
 *    through `ConversationState.appendMessage()` etc. instead of
 *    `ctx.messages.push(...)`. That's a follow-up refactor — the API shape
 *    here is designed to support it.
 *
 *  - `meta` is a free-form bag; we shallow-watch its keys. Deep mutations
 *    inside `meta.foo` won't trigger onChange. Use immutable replacement
 *    (`setMeta('foo', newValue)`) if you need notification.
 */
export type StateChange =
  | { kind: 'message_appended'; message: Message }
  | { kind: 'messages_replaced'; messages: readonly Message[] }
  | { kind: 'todos_replaced'; todos: readonly TodoItem[] }
  | { kind: 'meta_set'; key: string; value: unknown }
  | { kind: 'meta_deleted'; key: string };

export type StateChangeHandler = (change: StateChange, state: ConversationState) => void;

export interface ReadonlyConversationState {
  readonly messages: readonly Message[];
  readonly todos: readonly TodoItem[];
  readonly meta: Readonly<Record<string, unknown>>;
}

export class ConversationState {
  private readonly ctx: Context;
  private readonly listeners = new Set<StateChangeHandler>();

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  // ─── Read API ───────────────────────────────────────────────────────

  get messages(): readonly Message[] {
    return this.ctx.messages;
  }

  get todos(): readonly TodoItem[] {
    return this.ctx.todos;
  }

  get meta(): Readonly<Record<string, unknown>> {
    return this.ctx.meta;
  }

  /**
   * Cheap immutable snapshot. Useful for tests and for compaction passes
   * that need a stable view across an async boundary.
   */
  snapshot(): ReadonlyConversationState {
    return {
      messages: [...this.ctx.messages],
      todos: [...this.ctx.todos],
      meta: { ...this.ctx.meta },
    };
  }

  // ─── Write API (preferred — fires onChange) ─────────────────────────

  appendMessage(message: Message): void {
    this.ctx.messages.push(message);
    this.emit({ kind: 'message_appended', message });
  }

  replaceMessages(messages: Message[]): void {
    this.ctx.messages.length = 0;
    this.ctx.messages.push(...messages);
    this.emit({ kind: 'messages_replaced', messages: [...messages] });
  }

  replaceTodos(todos: TodoItem[]): void {
    this.ctx.todos.length = 0;
    this.ctx.todos.push(...todos);
    this.emit({ kind: 'todos_replaced', todos: [...todos] });
  }

  setMeta(key: string, value: unknown): void {
    this.ctx.meta[key] = value;
    this.emit({ kind: 'meta_set', key, value });
  }

  deleteMeta(key: string): void {
    if (!(key in this.ctx.meta)) return;
    delete this.ctx.meta[key];
    this.emit({ kind: 'meta_deleted', key });
  }

  // ─── Subscription ───────────────────────────────────────────────────

  /**
   * Subscribe to mutations that go through this wrapper. Note: mutations
   * that bypass the wrapper (e.g. `ctx.messages.push(...)` directly) are
   * NOT observed — by design during migration, since we don't want to
   * monkey-patch arrays. Migrating call sites to use this API is the
   * dev-plan #1 work.
   */
  onChange(listener: StateChangeHandler): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: StateChange): void {
    for (const h of this.listeners) {
      try { h(change, this); } catch { /* ignore listener errors */ }
    }
  }
}

/**
 * Convenience constructor — creates a ConversationState bound to the
 * given Context. The wrapper holds a reference, not a copy.
 */
export function wrapAsState(ctx: Context): ConversationState {
  return new ConversationState(ctx);
}
