import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWrite, ensureDir, withFileLock } from '../utils/atomic-write.js';
import {
  CHRONICLE_SCHEMA_VERSION,
  type ChronicleEvent,
  type ChronicleEventInput,
  type ChronicleVerifyResult,
} from './types.js';

const GENESIS_HASH = '0'.repeat(64);
const DEFAULT_MAX_PARTITION_BYTES = 100 * 1024 * 1024;
const DEFAULT_ROTATION_WINDOW_MS = 60 * 60 * 1000;
const RETENTION_CHECKPOINT_VERSION = 1;

interface ChronicleRetentionCheckpoint {
  version: typeof RETENTION_CHECKPOINT_VERSION;
  sequence: number;
  hash: string;
}

export interface ChronicleJournalOptions {
  filePath: string;
  now?: (() => Date) | undefined;
  monotonicNow?: (() => bigint) | undefined;
  idFactory?: (() => string) | undefined;
  maxPending?: number | undefined;
  batchWindowMs?: number | undefined;
  maxPartitionSizeBytes?: number | undefined;
  rotationWindowMs?: number | undefined;
  retentionDays?: number | undefined;
  autoPurgeIntervalMs?: number | undefined;
}
export interface ChronicleJournalStats {
  acceptedEvents: number; persistedEvents: number; rejectedEvents: number; failedEvents: number;
  batches: number; pendingEvents: number; maxObservedPending: number; largestBatch: number;
  lastBatchDurationMs?: number | undefined;
  partitionRolls: number;
}
export interface ChroniclePurgeOptions {
  retentionDays: number;
  dryRun?: boolean | undefined;
  files?: string[] | undefined;
}
export interface ChroniclePurgeResult {
  deletedCount: number;
  deletedBytes: number;
  skippedCount: number;
  errors: Array<{ file: string; reason: string }>;
  candidates?: string[] | undefined;
}

export class ChronicleJournal {
  private readonly basePath: string;
  private readonly now: () => Date;
  private readonly monotonicNow: () => bigint;
  private readonly idFactory: () => string;
  private readonly maxPending: number;
  private readonly batchWindowMs: number;
  private readonly maxPartitionSizeBytes: number;
  private readonly rotationWindowMs: number;
  private readonly retentionDays: number;
  private readonly autoPurgeIntervalMs: number;
  private pending: Array<{ input: ChronicleEventInput; resolve: (event: ChronicleEvent) => void; reject: (error: unknown) => void; }> = [];
  private drainPromise: Promise<void> | undefined;
  private drainScheduled = false;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly counters = { acceptedEvents: 0, persistedEvents: 0, rejectedEvents: 0, failedEvents: 0, batches: 0, maxObservedPending: 0, largestBatch: 0, partitionRolls: 0 };
  private lastBatchDurationMs: number | undefined;
  private partitionIndex = 0;
  private partitionStartedAt: number;
  private lastSequence = 0;
  private lastHash: string = GENESIS_HASH;
  private lastAutoPurgeAt = 0;

  constructor(options: ChronicleJournalOptions) {
    this.basePath = path.resolve(options.filePath);
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => process.hrtime.bigint());
    this.idFactory = options.idFactory ?? randomUUID;
    this.maxPending = Math.max(1, options.maxPending ?? 100_000);
    this.batchWindowMs = Math.max(0, options.batchWindowMs ?? 5);
    this.maxPartitionSizeBytes = options.maxPartitionSizeBytes ?? DEFAULT_MAX_PARTITION_BYTES;
    this.rotationWindowMs = options.rotationWindowMs ?? DEFAULT_ROTATION_WINDOW_MS;
    this.retentionDays = options.retentionDays && Number.isFinite(options.retentionDays) && options.retentionDays > 0 ? options.retentionDays : 0;
    this.autoPurgeIntervalMs = Math.max(0, options.autoPurgeIntervalMs ?? 3_600_000);
    this.partitionStartedAt = Date.now();
  }

  get path(): string { return this.partitionIndex === 0 ? this.basePath : rotatedPath(this.basePath, this.partitionIndex); }

  stats(): ChronicleJournalStats {
    return { ...this.counters, pendingEvents: this.pending.length, ...(this.lastBatchDurationMs !== undefined ? { lastBatchDurationMs: this.lastBatchDurationMs } : {}) };
  }

  append(input: ChronicleEventInput): Promise<ChronicleEvent> {
    if (this.pending.length >= this.maxPending) { this.counters.rejectedEvents++; return Promise.reject(new Error(`Chronicle backpressure limit reached (${this.maxPending} pending events)`)); }
    const promise = new Promise<ChronicleEvent>((resolve, reject) => { this.pending.push({ input, resolve, reject }); });
    this.counters.acceptedEvents++;
    this.counters.maxObservedPending = Math.max(this.counters.maxObservedPending, this.pending.length);
    this.scheduleDrain();
    return promise;
  }

  async readAll(): Promise<ChronicleEvent[]> {
    await this.flush();
    const files = await collectPartitions(this.basePath);
    const entries: ChronicleEvent[] = [];
    for (const file of files) entries.push(...(await readEntriesStrict(file)));
    return entries;
  }

  async flush(): Promise<void> {
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = undefined; this.drainScheduled = false; }
    while (this.pending.length > 0 || this.drainPromise) {
      if (this.pending.length > 0 && !this.drainPromise) this.startDrain();
      await this.drainPromise;
    }
  }

  async verify(): Promise<ChronicleVerifyResult> {
    await this.flush();
    const files = await collectPartitions(this.basePath);
    const checkpointResult = await readRetentionCheckpoint(this.basePath);
    if (checkpointResult.error) return { ok: false, entries: 0, brokenAt: 0, reason: checkpointResult.error };
    return verifyPartitionFiles(files, checkpointResult.checkpoint);
  }

  async purge(options: ChroniclePurgeOptions): Promise<ChroniclePurgeResult> {
    await this.flush();
    if (!Number.isFinite(options.retentionDays) || options.retentionDays <= 0) {
      throw new TypeError('Chronicle retentionDays must be a positive finite number');
    }
    await this.refreshStateFromDisk();
    const cutoff = Date.now() - options.retentionDays * 86400000;
    const activePath = path.resolve(this.path);
    const errors: ChroniclePurgeResult['errors'] = [];
    let dc = 0, db = 0, sc = 0;
    const suppliedFiles = options.files === undefined
      ? await collectJournalPartitions(this.basePath)
      : [...options.files];
    const eligible = new Set<string>();
    for (const suppliedPath of new Set(suppliedFiles)) {
      const file = path.resolve(suppliedPath);
      if (!isJournalPartition(file, path.dirname(this.basePath), this.basePath)) {
        errors.push({ file: suppliedPath, reason: 'not a Chronicle journal partition in this journal directory' });
        sc++;
        continue;
      }
      if (file === activePath) { sc++; continue; }
      let mtimeMs: number;
      try {
        const fileStat = await fs.lstat(file);
        if (!fileStat.isFile()) { sc++; continue; }
        mtimeMs = fileStat.mtimeMs;
      } catch (error) { if (isNotFound(error)) continue; errors.push({ file, reason: errorMessage(error) }); sc++; continue; }
      if (mtimeMs > cutoff) { sc++; continue; }
      eligible.add(file);
    }

    const candidates: string[] = [];
    const allPartitions = await collectJournalPartitions(this.basePath);
    for (const family of groupPartitionsByFamily(allPartitions).values()) {
      for (const file of family) {
        if (file === activePath || !eligible.has(file)) break;
        candidates.push(file);
        eligible.delete(file);
      }
    }
    sc += eligible.size;

    if (!options.dryRun) {
      for (const file of candidates) {
        try {
          const familyBase = partitionFamilyBase(file);
          let deletedBytes: number | undefined;
          await withFileLock(familyBase, async () => {
            const fileStat = await fs.lstat(file);
            if (!fileStat.isFile() || fileStat.mtimeMs > cutoff) return;
            const entries = await readEntriesStrict(file);
            const checkpointResult = await readRetentionCheckpoint(familyBase);
            if (checkpointResult.error) throw new Error(checkpointResult.error);
            const checkpoint = checkpointResult.checkpoint;
            const nextCheckpoint = verifyRetainedPrefix(entries, checkpoint);
            if (!nextCheckpoint) throw new Error('partition does not extend the trusted Chronicle chain');
            if (nextCheckpoint.sequence > (checkpoint?.sequence ?? 0)) {
              await writeRetentionCheckpoint(familyBase, nextCheckpoint);
            }
            deletedBytes = fileStat.size;
            await fs.unlink(file);
          });
          if (deletedBytes === undefined) { sc++; break; }
          db += deletedBytes;
          dc++;
        } catch (error) {
          errors.push({ file, reason: errorMessage(error) });
          sc++;
          // Candidates form an oldest-first prefix. Do not advance the
          // checkpoint beyond a partition that could not be removed: if its
          // checkpoint-covered bytes remain on disk, verify() must still be
          // able to anchor and validate them against that checkpoint.
          break;
        }
      }
    }
    return { deletedCount: dc, deletedBytes: db, skippedCount: sc, errors, ...(options.dryRun ? { candidates } : {}) };
  }

  private async maybeAutoPurge(): Promise<void> {
    if (this.retentionDays <= 0) return;
    const n = Date.now();
    if (n - this.lastAutoPurgeAt < this.autoPurgeIntervalMs) return;
    this.lastAutoPurgeAt = n;
    try { await this.purge({ retentionDays: this.retentionDays }); } catch { /* best-effort */ }
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.drainPromise) return;
    this.drainScheduled = true;
    this.drainTimer = setTimeout(() => { this.drainTimer = undefined; this.drainScheduled = false; this.startDrain(); }, this.batchWindowMs);
  }

  private startDrain(): void {
    if (this.drainPromise || this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    const drain = this.persistBatch(batch);
    this.drainPromise = drain.finally(() => { this.drainPromise = undefined; if (this.pending.length > 0) this.scheduleDrain(); });
  }

  private async refreshStateFromDisk(): Promise<void> {
    const files = await collectPartitions(this.basePath);
    const latest = files[files.length - 1] ?? this.basePath;
    this.partitionIndex = partitionIndex(latest, this.basePath);
    const entry = await readLastEntry(latest);
    const checkpointResult = await readRetentionCheckpoint(this.basePath);
    if (checkpointResult.error) throw new Error(checkpointResult.error);
    const checkpoint = checkpointResult.checkpoint;
    this.lastSequence = entry?.sequence ?? checkpoint?.sequence ?? 0;
    this.lastHash = entry?.hash ?? checkpoint?.hash ?? GENESIS_HASH;
    try { this.partitionStartedAt = (await fs.stat(latest)).birthtimeMs; } catch { this.partitionStartedAt = Date.now(); }
  }

  private async checkRotation(): Promise<void> {
    if (this.partitionIndex === 0 && this.lastSequence === 0) return;
    if (Number.isFinite(this.rotationWindowMs) && Date.now() - this.partitionStartedAt >= this.rotationWindowMs) { this.rotate(); return; }
    if (Number.isFinite(this.maxPartitionSizeBytes)) { try { if ((await fs.stat(this.path)).size >= this.maxPartitionSizeBytes) this.rotate(); } catch { /* ok */ } }
  }

  private rotate(): void { this.partitionIndex++; this.partitionStartedAt = Date.now(); this.counters.partitionRolls++; }

  private async persistBatch(batch: typeof this.pending): Promise<void> {
    const started = performance.now();
    this.counters.batches++;
    this.counters.largestBatch = Math.max(this.counters.largestBatch, batch.length);
    try {
      await ensureDir(path.dirname(this.basePath));
      let recorded: ChronicleEvent[] = [];
      await withFileLock(this.basePath, async () => {
        await this.refreshStateFromDisk();
        await this.checkRotation();
        const cp = this.path;
        let prev: { sequence: number; hash: string } | undefined = this.lastSequence > 0 ? { sequence: this.lastSequence, hash: this.lastHash } : undefined;
        recorded = batch.map(({ input }) => {
          const instant = this.now().toISOString();
          const ni = removeUndefined(input) as unknown as ChronicleEventInput;
          const uh = { ...ni, occurredAt: input.occurredAt ?? instant, monotonicNs: input.monotonicNs ?? this.monotonicNow().toString(), schemaVersion: CHRONICLE_SCHEMA_VERSION, eventId: this.idFactory(), observedAt: instant, persistedAt: instant, sequence: (prev?.sequence ?? 0) + 1, previousHash: prev?.hash ?? GENESIS_HASH };
          const event: ChronicleEvent = { ...uh, hash: hashValue(uh) };
          prev = event;
          return event;
        });
        await fs.appendFile(cp, recorded.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      });
      const last = recorded[recorded.length - 1]!;
      this.lastSequence = last.sequence;
      this.lastHash = last.hash;
      batch.forEach((item, i) => item.resolve(recorded[i]!));
      this.counters.persistedEvents += batch.length;
      void this.maybeAutoPurge();
    } catch (error) {
      this.counters.failedEvents += batch.length;
      batch.forEach((item) => item.reject(error));
    } finally { this.lastBatchDurationMs = performance.now() - started; }
  }
}

function rotatedPath(basePath: string, index: number): string {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const base = path.basename(basePath, ext);
  return path.join(dir, `${base}.${String(index).padStart(5, '0')}${ext}`);
}

async function collectPartitions(basePath: string): Promise<string[]> {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const base = path.basename(basePath, ext);
  const pattern = new RegExp(`^${escapeRegex(base)}(?:\\.\\d{5})?${escapeRegex(ext)}$`);
  const result: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) if (entry.isFile() && pattern.test(entry.name)) result.push(path.join(dir, entry.name));
  } catch { /* ok */ }
  const baseFile = path.join(dir, base + ext);
  const rotated = result.filter((file) => file !== baseFile).sort((left, right) => parseIndex(left, base, ext) - parseIndex(right, base, ext));
  return [baseFile, ...rotated];
}

async function collectJournalPartitions(basePath: string): Promise<string[]> {
  const directory = path.dirname(basePath);
  const result: string[] = [];
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isFile() && isJournalPartition(file, directory, basePath)) result.push(file);
    }
  } catch { /* ok */ }
  return result.sort(compareJournalPartitions);
}

function isJournalPartition(filePath: string, directory: string, basePath?: string): boolean {
  if (path.dirname(path.resolve(filePath)) !== path.resolve(directory)) return false;
  const fileName = path.basename(filePath);
  if (!basePath) return false;
  const baseName = path.basename(basePath);
  const dailyFamily = /^\d{4}-\d{2}-\d{2}\.events(?:\.\d{5})?\.jsonl$/;
  if (/^\d{4}-\d{2}-\d{2}\.events\.jsonl$/.test(baseName)) return dailyFamily.test(fileName);
  return partitionFamilyBase(path.resolve(filePath)) === partitionFamilyBase(path.resolve(basePath));
}

function compareJournalPartitions(left: string, right: string): number {
  const pattern = /^(.*\.events)(?:\.(\d{5}))?\.jsonl$/;
  const leftMatch = pattern.exec(path.basename(left));
  const rightMatch = pattern.exec(path.basename(right));
  const familyOrder = (leftMatch?.[1] ?? left).localeCompare(rightMatch?.[1] ?? right);
  return familyOrder || Number(leftMatch?.[2] ?? 0) - Number(rightMatch?.[2] ?? 0);
}

function groupPartitionsByFamily(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const family = partitionFamilyBase(file);
    const group = groups.get(family) ?? [];
    group.push(file);
    groups.set(family, group);
  }
  return groups;
}

function partitionFamilyBase(filePath: string): string {
  return filePath.replace(/\.\d{5}(?=\.jsonl$)/, '');
}

function retentionCheckpointPath(basePath: string): string {
  return `${partitionFamilyBase(basePath)}.retention.json`;
}

function verifyRetainedPrefix(
  entries: ChronicleEvent[],
  checkpoint: ChronicleRetentionCheckpoint | undefined,
): ChronicleRetentionCheckpoint | undefined {
  if (entries.length === 0) return undefined;
  let sequence = checkpoint?.sequence ?? 0;
  let hash = checkpoint?.hash ?? GENESIS_HASH;
  let advanced = false;
  for (const entry of entries) {
    if (entry.sequence <= sequence) continue;
    if (entry.sequence !== sequence + 1 || entry.previousHash !== hash) return undefined;
    const { hash: recordedHash, ...content } = entry;
    if (hashValue(content) !== recordedHash) return undefined;
    sequence = entry.sequence;
    hash = recordedHash;
    advanced = true;
  }
  if (!advanced) return checkpoint;
  return { version: RETENTION_CHECKPOINT_VERSION, sequence, hash };
}

async function verifyPartitionFiles(
  files: string[],
  checkpoint: ChronicleRetentionCheckpoint | undefined,
): Promise<ChronicleVerifyResult> {
  const checkpointSequence = checkpoint?.sequence ?? 0;
  let previousHash = checkpoint?.hash ?? GENESIS_HASH;
  let entries = 0;
  let lastSequence = checkpointSequence;
  let coveredPrevious: ChronicleEvent | undefined;
  for (const file of files) {
    let chunk: ChronicleEvent[];
    try { chunk = await readEntriesStrict(file); } catch (error) { return { ok: false, entries, brokenAt: entries, reason: errorMessage(error) }; }
    for (const entry of chunk) {
      const { hash: recordedHash, ...content } = entry;
      if (entry.sequence <= checkpointSequence) {
        // A checkpoint can be durably renamed just before its source
        // partition fails to unlink. Such retained bytes are still evidence:
        // validate them rather than treating every covered sequence as absent.
        if (hashValue(content) !== recordedHash) return { ok: false, entries, brokenAt: entries, reason: 'entry hash mismatch' };
        if (coveredPrevious && entry.sequence !== coveredPrevious.sequence + 1) {
          return { ok: false, entries, brokenAt: entries, reason: `sequence ${entry.sequence} is not ${coveredPrevious.sequence + 1}` };
        }
        if (coveredPrevious && entry.previousHash !== coveredPrevious.hash) {
          return { ok: false, entries, brokenAt: entries, reason: 'previous hash mismatch' };
        }
        if (entry.sequence === checkpointSequence && recordedHash !== checkpoint?.hash) {
          return { ok: false, entries, brokenAt: entries, reason: 'retention checkpoint hash mismatch' };
        }
        coveredPrevious = entry;
        continue;
      }
      const index = entries++;
      if (entry.sequence !== lastSequence + 1) return { ok: false, entries, brokenAt: index, reason: `sequence ${entry.sequence} is not ${lastSequence + 1}` };
      if (entry.previousHash !== previousHash) return { ok: false, entries, brokenAt: index, reason: 'previous hash mismatch' };
      if (hashValue(content) !== recordedHash) return { ok: false, entries, brokenAt: index, reason: 'entry hash mismatch' };
      previousHash = recordedHash;
      lastSequence = entry.sequence;
    }
  }
  if (
    coveredPrevious &&
    (coveredPrevious.sequence !== checkpointSequence || coveredPrevious.hash !== checkpoint?.hash)
  ) {
    return { ok: false, entries, brokenAt: entries, reason: 'retention checkpoint hash mismatch' };
  }
  return { ok: true, entries, lastSequence, lastHash: previousHash };
}

async function readRetentionCheckpoint(basePath: string): Promise<{
  checkpoint?: ChronicleRetentionCheckpoint | undefined;
  error?: string | undefined;
}> {
  const checkpointPath = retentionCheckpointPath(basePath);
  let raw: string;
  try { raw = await fs.readFile(checkpointPath, 'utf8'); } catch (error) {
    return isNotFound(error) ? {} : { error: `cannot read retention checkpoint: ${errorMessage(error)}` };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ChronicleRetentionCheckpoint>;
    if (parsed.version !== RETENTION_CHECKPOINT_VERSION || !Number.isSafeInteger(parsed.sequence) || (parsed.sequence ?? -1) < 0 || !isHash(parsed.hash)) {
      return { error: 'invalid Chronicle retention checkpoint' };
    }
    return { checkpoint: parsed as ChronicleRetentionCheckpoint };
  } catch { return { error: 'invalid Chronicle retention checkpoint JSON' }; }
}

async function writeRetentionCheckpoint(basePath: string, checkpoint: ChronicleRetentionCheckpoint): Promise<void> {
  await atomicWrite(retentionCheckpointPath(basePath), `${JSON.stringify(checkpoint)}\n`, { mode: 0o600 });
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function parseIndex(filePath: string, base: string, ext: string): number {
  const suffix = path.basename(filePath).slice(base.length + 1, -ext.length);
  return suffix ? parseInt(suffix, 10) : 0;
}

function partitionIndex(filePath: string, basePath: string): number {
  const ext = path.extname(basePath);
  return parseIndex(filePath, path.basename(basePath, ext), ext);
}

function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function readLastEntry(filePath: string): Promise<ChronicleEvent | undefined> {
  let handle: fs.FileHandle;
  try { handle = await fs.open(filePath, 'r'); } catch (error) { if (isNotFound(error)) return undefined; throw error; }
  try {
    const size = (await handle.stat()).size;
    let position = size, suffix = '';
    while (position > 0) {
      const length = Math.min(65536, position);
      position -= length;
      const buf = Buffer.allocUnsafe(length);
      await handle.read(buf, 0, length, position);
      suffix = buf.toString('utf8') + suffix;
      const lines = suffix.split('\n');
      const start = position === 0 ? 0 : 1;
      for (let i = lines.length - 1; i >= start; i--) {
        const trimmed = lines[i]!.trim();
        if (!trimmed) continue;
        try { return JSON.parse(trimmed) as ChronicleEvent; } catch { /* scan earlier */ }
      }
      suffix = lines[0] ?? '';
    }
    return undefined;
  } finally { await handle.close(); }
}

async function readEntriesStrict(filePath: string): Promise<ChronicleEvent[]> {
  let raw: string;
  try { raw = await fs.readFile(filePath, 'utf8'); } catch (error) { if (isNotFound(error)) return []; throw error; }
  const entries: ChronicleEvent[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    try { entries.push(JSON.parse(trimmed) as ChronicleEvent); } catch { throw new Error(`invalid JSON at line ${i + 1} in ${path.basename(filePath)}`); }
  }
  return entries;
}

function hashValue(value: unknown): string { return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex'); }
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : removeUndefined(item));
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (item !== undefined) result[key] = removeUndefined(item);
  return result;
}
function isNotFound(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export { GENESIS_HASH };
