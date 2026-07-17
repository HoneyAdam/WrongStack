import { normalizeTextKey, overlapCoefficient, tokenize } from './turn-memory.js';

export interface InjectionTrackerOptions {
  /** How long an injection stays matchable. Default: 2 hours. */
  ttlMs?: number | undefined;
  /** Maximum tracked injections; oldest are evicted beyond this. Default: 500. */
  maxEntries?: number | undefined;
  /**
   * Minimum distinct tokens a memory text needs to be trackable. Shorter
   * memories match ordinary prose too easily to be a trustworthy signal.
   * Default: 4.
   */
  minTokens?: number | undefined;
  /**
   * Overlap coefficient (memory tokens ∩ assistant tokens / memory tokens)
   * required to count a reference as a use. Default: 0.5.
   */
  matchThreshold?: number | undefined;
}

interface TrackedInjection {
  textKey: string;
  tokens: number;
  at: number;
}

/**
 * Process-local registry of memories recently injected into context, used to
 * close the usefulness feedback loop: when a later assistant message references
 * an injected memory, the store's `recordUse` counter is credited.
 *
 * Deliberately NOT session-keyed: the turn middleware has no session id on the
 * request object, and a cross-session attribution error only shifts an
 * approximate counter between sessions of the same project. Consume-once
 * semantics (each injection yields at most one use) bound the error.
 */
export class InjectionTracker {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly minTokens: number;
  private readonly matchThreshold: number;
  private readonly entries = new Map<string, TrackedInjection>();

  constructor(opts: InjectionTrackerOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 2 * 60 * 60_000;
    this.maxEntries = opts.maxEntries ?? 500;
    this.minTokens = opts.minTokens ?? 4;
    this.matchThreshold = opts.matchThreshold ?? 0.5;
  }

  /** Register an injected memory as matchable. Text is normalized once here. */
  record(memoryId: string, text: string, now = Date.now()): void {
    const textKey = normalizeTextKey(text);
    const tokens = tokenize(textKey).length;
    if (tokens < this.minTokens) return;
    this.prune(now);
    this.entries.set(memoryId, { textKey, tokens, at: now });
  }

  /**
   * Return the memory ids whose registered text is referenced by
   * `assistantText`, consuming them so each injection counts at most one use.
   */
  consumeMatches(assistantText: string, now = Date.now()): string[] {
    if (this.entries.size === 0) return [];
    const textKey = normalizeTextKey(assistantText);
    if (!textKey) return [];
    this.prune(now);
    const matched: string[] = [];
    for (const [memoryId, entry] of this.entries) {
      if (overlapCoefficient(entry.textKey, textKey) >= this.matchThreshold) {
        matched.push(memoryId);
        this.entries.delete(memoryId);
      }
    }
    return matched;
  }

  /** Current number of tracked injections (after pruning). */
  get size(): number {
    this.prune(Date.now());
    return this.entries.size;
  }

  private prune(now: number): void {
    if (this.entries.size === 0) return;
    if (this.entries.size > this.maxEntries) {
      const overflow = this.entries.size - this.maxEntries;
      let dropped = 0;
      for (const key of this.entries.keys()) {
        if (dropped >= overflow) break;
        this.entries.delete(key);
        dropped++;
      }
    }
    const cutoff = now - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.at < cutoff) this.entries.delete(key);
    }
  }
}
