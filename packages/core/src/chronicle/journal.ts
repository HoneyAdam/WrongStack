import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureDir, withFileLock } from '../utils/atomic-write.js';
import {
  CHRONICLE_SCHEMA_VERSION,
  type ChronicleEvent,
  type ChronicleEventInput,
  type ChronicleVerifyResult,
} from './types.js';

const GENESIS_HASH = '0'.repeat(64);

export interface ChronicleJournalOptions {
  filePath: string;
  now?: (() => Date) | undefined;
  monotonicNow?: (() => bigint) | undefined;
  idFactory?: (() => string) | undefined;
  maxPending?: number | undefined;
  batchWindowMs?: number | undefined;
}

export interface ChronicleJournalStats {
  acceptedEvents: number; persistedEvents: number; rejectedEvents: number; failedEvents: number;
  batches: number; pendingEvents: number; maxObservedPending: number; largestBatch: number;
  lastBatchDurationMs?: number | undefined;
}

/** Durable, cross-process-safe, hash-chained JSONL source of truth. */
export class ChronicleJournal {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly monotonicNow: () => bigint;
  private readonly idFactory: () => string;
  private readonly maxPending: number;
  private readonly batchWindowMs: number;
  private pending: Array<{
    input: ChronicleEventInput;
    resolve: (event: ChronicleEvent) => void;
    reject: (error: unknown) => void;
  }> = [];
  private drainPromise: Promise<void> | undefined;
  private drainScheduled = false;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly counters = { acceptedEvents: 0, persistedEvents: 0, rejectedEvents: 0,
    failedEvents: 0, batches: 0, maxObservedPending: 0, largestBatch: 0 };
  private lastBatchDurationMs: number | undefined;

  constructor(options: ChronicleJournalOptions) {
    this.filePath = path.resolve(options.filePath);
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => process.hrtime.bigint());
    this.idFactory = options.idFactory ?? randomUUID;
    this.maxPending = Math.max(1, options.maxPending ?? 100_000);
    this.batchWindowMs = Math.max(0, options.batchWindowMs ?? 5);
  }

  get path(): string {
    return this.filePath;
  }

  stats(): ChronicleJournalStats {
    return { ...this.counters, pendingEvents: this.pending.length,
      ...(this.lastBatchDurationMs !== undefined ? { lastBatchDurationMs: this.lastBatchDurationMs } : {}) };
  }

  append(input: ChronicleEventInput): Promise<ChronicleEvent> {
    if (this.pending.length >= this.maxPending) {
      this.counters.rejectedEvents++;
      return Promise.reject(new Error(`Chronicle backpressure limit reached (${this.maxPending} pending events)`));
    }
    const promise = new Promise<ChronicleEvent>((resolve, reject) => {
      this.pending.push({ input, resolve, reject });
    });
    this.counters.acceptedEvents++;
    this.counters.maxObservedPending = Math.max(this.counters.maxObservedPending, this.pending.length);
    this.scheduleDrain();
    return promise;
  }

  async readAll(): Promise<ChronicleEvent[]> {
    await this.flush();
    return readEntries(this.filePath);
  }

  /** Wait until every append accepted by this process has settled. */
  async flush(): Promise<void> {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = undefined;
      this.drainScheduled = false;
    }
    while (this.pending.length > 0 || this.drainPromise) {
      if (this.pending.length > 0 && !this.drainPromise) this.startDrain();
      await this.drainPromise;
    }
  }

  async verify(): Promise<ChronicleVerifyResult> {
    await this.flush();
    let entries: ChronicleEvent[];
    try {
      entries = await readEntries(this.filePath, true);
    } catch (error) {
      return { ok: false, entries: 0, brokenAt: 0, reason: errorMessage(error) };
    }

    let expectedPrevious = GENESIS_HASH;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      if (entry.sequence !== index + 1) {
        return { ok: false, entries: entries.length, brokenAt: index, reason: `sequence ${entry.sequence} is not ${index + 1}` };
      }
      if (entry.previousHash !== expectedPrevious) {
        return { ok: false, entries: entries.length, brokenAt: index, reason: 'previous hash mismatch' };
      }
      const { hash: recordedHash, ...content } = entry;
      if (hashValue(content) !== recordedHash) {
        return { ok: false, entries: entries.length, brokenAt: index, reason: 'entry hash mismatch' };
      }
      expectedPrevious = recordedHash;
    }
    return {
      ok: true,
      entries: entries.length,
      lastSequence: entries.at(-1)?.sequence ?? 0,
      lastHash: entries.at(-1)?.hash ?? GENESIS_HASH,
    };
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.drainPromise) return;
    this.drainScheduled = true;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = undefined;
      this.drainScheduled = false;
      this.startDrain();
    }, this.batchWindowMs);
  }

  private startDrain(): void {
    if (this.drainPromise || this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    const drain = this.persistBatch(batch);
    this.drainPromise = drain.finally(() => {
      this.drainPromise = undefined;
      if (this.pending.length > 0) this.scheduleDrain();
    });
  }

  private async persistBatch(batch: typeof this.pending): Promise<void> {
    const started = performance.now();
    this.counters.batches++;
    this.counters.largestBatch = Math.max(this.counters.largestBatch, batch.length);
    try {
      await ensureDir(path.dirname(this.filePath));
      let recorded: ChronicleEvent[] = [];
      await withFileLock(this.filePath, async () => {
        let previous = await readLastEntry(this.filePath);
        recorded = batch.map(({ input }) => {
          const instant = this.now().toISOString();
          const normalizedInput = removeUndefined(input) as unknown as ChronicleEventInput;
          const unhashed = {
            ...normalizedInput,
            occurredAt: input.occurredAt ?? instant,
            monotonicNs: input.monotonicNs ?? this.monotonicNow().toString(),
            schemaVersion: CHRONICLE_SCHEMA_VERSION,
            eventId: this.idFactory(), observedAt: instant, persistedAt: instant,
            sequence: (previous?.sequence ?? 0) + 1,
            previousHash: previous?.hash ?? GENESIS_HASH,
          };
          const event: ChronicleEvent = { ...unhashed, hash: hashValue(unhashed) };
          previous = event;
          return event;
        });
        await fs.appendFile(this.filePath, recorded.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
      });
      batch.forEach((item, index) => item.resolve(recorded[index]!));
      this.counters.persistedEvents += batch.length;
    } catch (error) {
      this.counters.failedEvents += batch.length;
      batch.forEach((item) => item.reject(error));
    } finally {
      this.lastBatchDurationMs = performance.now() - started;
    }
  }
}

/** Read only the last complete valid event instead of re-parsing the whole daily partition. */
async function readLastEntry(filePath: string): Promise<ChronicleEvent | undefined> {
  let handle: fs.FileHandle;
  try { handle = await fs.open(filePath, 'r'); } catch (error) { if (isNotFound(error)) return undefined; throw error; }
  try {
    const size = (await handle.stat()).size;
    const chunkSize = 64 * 1024;
    let position = size;
    let suffix = '';
    while (position > 0) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, position);
      suffix = buffer.toString('utf8') + suffix;
      const lines = suffix.split('\n');
      const first = position === 0 ? 0 : 1;
      for (let index = lines.length - 1; index >= first; index--) {
        const line = lines[index]!.trim();
        if (!line) continue;
        try { return JSON.parse(line) as ChronicleEvent; } catch { /* scan an earlier valid record */ }
      }
      suffix = lines[0] ?? '';
    }
    return undefined;
  } finally { await handle.close(); }
}

async function readEntries(filePath: string, strict = false): Promise<ChronicleEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const entries: ChronicleEvent[] = [];
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as ChronicleEvent);
    } catch (error) {
      if (strict) throw new Error(`invalid JSON at line ${index + 1}: ${errorMessage(error)}`);
    }
  }
  return entries;
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

/** Mirror JSON object semantics before hashing so optional undefined fields
 * cannot produce a hash for bytes that JSON.stringify later omits. */
function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : removeUndefined(item));
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== undefined) result[key] = removeUndefined(item);
  }
  return result;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { GENESIS_HASH };
