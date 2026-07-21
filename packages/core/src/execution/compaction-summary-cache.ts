import { createHash } from 'node:crypto';
import type { Message } from '../types/messages.js';
import { LruCache } from '../utils/lru-cache.js';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export interface CompactionSummaryCacheOptions {
  /** Maximum distinct summaries retained in memory (default: 32). */
  capacity?: number | undefined;
  /** Time a successful summary remains reusable (default: 1 hour). */
  ttlMs?: number | undefined;
}

/**
 * Small, process-local cache for isolated compaction summaries.
 *
 * Auto-compaction and overflow recovery can race or retry against the same
 * pre-compaction history. Without a shared cache each path pays for the same
 * secondary-model request. The cache is deliberately bounded and TTL-based:
 * long-running agents cannot accumulate one entry per compaction forever.
 */
export class CompactionSummaryCache {
  private readonly entries: LruCache<string, CacheEntry>;
  private readonly pending = new Map<string, Promise<string>>();
  private readonly ttlMs: number;

  constructor(opts: CompactionSummaryCacheOptions = {}) {
    this.entries = new LruCache(opts.capacity ?? 32);
    this.ttlMs = Math.max(1, opts.ttlMs ?? 60 * 60 * 1000);
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) return undefined;
    return entry.value;
  }

  set(key: string, value: string): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Reuse both completed results and an identical call already in flight. */
  async getOrCreate(key: string, create: () => Promise<string>): Promise<string> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const running = this.pending.get(key);
    if (running) return running;

    const promise = create().then((value) => {
      // Empty/error placeholders are intentionally not supplied by callers;
      // only successful semantic summaries should become durable cache hits.
      this.set(key, value);
      return value;
    });
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }
}

/** Stable key for a summary request; transient estimator fields are excluded. */
export function compactionSummaryKey(
  model: string,
  prompt: string,
  messages: readonly Message[],
): string {
  const hash = createHash('sha256');
  hash.update('wrongstack-compaction-summary-v1\0').update(model).update('\0').update(prompt);
  for (const message of messages) {
    hash.update('\0').update(message.role).update('\0');
    if (typeof message.content === 'string') {
      hash.update(message.content);
      continue;
    }
    hash.update(JSON.stringify(message.content));
  }
  return hash.digest('hex');
}
