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

interface ContextInjection {
  memoryId: string;
  contextTextKey: string;
  at: number;
  sessionId?: string | undefined;
}

export interface ContextMemorySnapshot {
  activeMemoryIds: string[];
  enteredMemoryIds: string[];
  exitedMemoryIds: string[];
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
  private readonly contextEntries = new Map<string, ContextInjection>();
  private readonly activeContextBySession = new Map<string, Set<string>>();

  constructor(opts: InjectionTrackerOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 2 * 60 * 60_000;
    this.maxEntries = opts.maxEntries ?? 500;
    this.minTokens = opts.minTokens ?? 4;
    this.matchThreshold = opts.matchThreshold ?? 0.5;
  }

  /** Register an injected memory as matchable. Text is normalized once here. */
  record(
    memoryId: string,
    text: string,
    now = Date.now(),
    sessionId?: string,
    renderedContextText?: string,
  ): void {
    const textKey = normalizeTextKey(text);
    const tokens = tokenize(textKey).length;
    if (tokens < this.minTokens) return;
    this.prune(now);
    this.entries.set(memoryId, { textKey, tokens, at: now });
    const contextKey = `${sessionId ?? '<no-session>'}\0${memoryId}`;
    this.contextEntries.set(contextKey, {
      memoryId,
      contextTextKey: contextNeedle(textKey, renderedContextText, this.minTokens),
      at: now,
      sessionId,
    });
  }

  /**
   * Compare tracked injections with the exact provider-bound request text.
   * This is the authoritative boundary for "in context" vs "left context":
   * compaction, clear, and session rewrites naturally disappear on the next
   * request without guessing from token counts.
   */
  snapshotContext(
    requestText: string,
    sessionId?: string,
    now = Date.now(),
  ): ContextMemorySnapshot {
    this.prune(now);
    const sessionKey = sessionId ?? '<no-session>';
    const normalizedRequest = normalizeTextKey(requestText);
    const active = new Set<string>();
    for (const entry of this.contextEntries.values()) {
      if ((entry.sessionId ?? '<no-session>') !== sessionKey) continue;
      if (normalizedRequest.includes(entry.contextTextKey)) active.add(entry.memoryId);
    }
    const previous = this.activeContextBySession.get(sessionKey) ?? new Set<string>();
    const enteredMemoryIds = [...active].filter((id) => !previous.has(id));
    const exitedMemoryIds = [...previous].filter((id) => !active.has(id));
    this.activeContextBySession.set(sessionKey, active);
    return {
      activeMemoryIds: [...active],
      enteredMemoryIds,
      exitedMemoryIds,
    };
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
    for (const [key, entry] of this.contextEntries) {
      if (entry.at < cutoff) this.contextEntries.delete(key);
    }
    if (this.contextEntries.size > this.maxEntries) {
      const overflow = this.contextEntries.size - this.maxEntries;
      let dropped = 0;
      for (const key of this.contextEntries.keys()) {
        if (dropped >= overflow) break;
        this.contextEntries.delete(key);
        dropped++;
      }
    }
  }
}

function contextNeedle(
  textKey: string,
  renderedContextText: string | undefined,
  minTokens: number,
): string {
  if (!renderedContextText) return textKey;
  const renderedKey = normalizeTextKey(renderedContextText);
  if (renderedKey.includes(textKey)) return textKey;
  const words = textKey.split(' ');
  while (words.length >= minTokens) {
    const prefix = words.join(' ');
    if (renderedKey.includes(prefix)) return prefix;
    words.pop();
  }
  return textKey;
}
