/**
 * Bounded store for inline attachment previews (`[pasted #N]`, `[file:x]`,
 * `[image]` tokens → their full content).
 *
 * Replaces the previous append-only `Map<string, string>` in app.tsx, which
 * grew for the lifetime of the session. Values can be large — a paste is
 * capped at 50K chars but a picked file is stored whole — so the store is
 * bounded by BOTH an entry count and a total character budget, mirroring
 * the dual-budget retention in history-retention.ts.
 *
 * Eviction is LRU: `get()` and `set()` refresh the entry's recency, and the
 * oldest entries are dropped first when either budget is exceeded. Like
 * retainTuiHistory, the newest entry is always kept even when it alone
 * exceeds the character budget — evicting it would break slash-command
 * resolution (`/fix` needs the content) for the attachment the user just
 * added.
 *
 * This module is pure TypeScript — no React, no Ink — so it can be unit
 * tested without mounting components.
 */

/** Default maximum number of retained preview entries. */
export const TOKEN_PREVIEWS_MAX_ENTRIES = 64;

/**
 * Default maximum total characters across all retained previews (~512 KiB
 * of UTF-16 text). Sized so several max-size pastes (50K chars each) plus
 * a handful of source files fit comfortably.
 */
export const TOKEN_PREVIEWS_MAX_CHARS = 512 * 1024;

export interface TokenPreviewBudget {
  maxEntries?: number | undefined;
  maxChars?: number | undefined;
}

/**
 * LRU map of attachment token → content with dual (count + chars) budgets.
 * API-compatible with the `Map<string, string>` usage of its predecessor
 * (`get`/`set`/`has`/`delete`/`clear`/`size`).
 */
export class TokenPreviewStore {
  private readonly map = new Map<string, string>();
  private totalChars = 0;
  private readonly maxEntries: number;
  private readonly maxChars: number;

  constructor(budget: TokenPreviewBudget = {}) {
    this.maxEntries = Math.max(1, Math.floor(budget.maxEntries ?? TOKEN_PREVIEWS_MAX_ENTRIES));
    this.maxChars = Math.max(1, Math.floor(budget.maxChars ?? TOKEN_PREVIEWS_MAX_CHARS));
  }

  /** Number of entries currently retained. */
  get size(): number {
    return this.map.size;
  }

  /** Total characters across all retained values. */
  get chars(): number {
    return this.totalChars;
  }

  /** Look up a preview and refresh its LRU recency. */
  get(token: string): string | undefined {
    const value = this.map.get(token);
    if (value === undefined) return undefined;
    // Refresh recency: delete + re-insert moves the key to the newest slot.
    this.map.delete(token);
    this.map.set(token, value);
    return value;
  }

  has(token: string): boolean {
    return this.map.has(token);
  }

  /** Insert or replace a preview, then evict oldest entries over budget. */
  set(token: string, value: string): void {
    const prev = this.map.get(token);
    if (prev !== undefined) {
      this.totalChars -= prev.length;
      this.map.delete(token);
    }
    this.map.set(token, value);
    this.totalChars += value.length;
    this.evict();
  }

  delete(token: string): boolean {
    const prev = this.map.get(token);
    if (prev === undefined) return false;
    this.totalChars -= prev.length;
    return this.map.delete(token);
  }

  clear(): void {
    this.map.clear();
    this.totalChars = 0;
  }

  /** Oldest entry keys first — exposed for tests and diagnostics. */
  keysOldestFirst(): string[] {
    return [...this.map.keys()];
  }

  /**
   * Drop oldest-first until within both budgets, always keeping the newest
   * entry (the one just inserted, last in iteration order).
   */
  private evict(): void {
    for (const [key, value] of this.map) {
      if (this.map.size <= 1) break;
      if (this.map.size <= this.maxEntries && this.totalChars <= this.maxChars) break;
      this.map.delete(key);
      this.totalChars -= value.length;
    }
  }
}
