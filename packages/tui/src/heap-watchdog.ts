/**
 * heap-watchdog — periodic V8 heap sampling for long-running TUI sessions.
 *
 * Long autonomous sessions (10h+) have hit `FATAL ERROR: Ineffective
 * mark-compacts near heap limit` with nothing attributing WHAT grew. This
 * watchdog makes the next occurrence diagnosable and warns the user before
 * the hard crash:
 *
 *   - samples `process.memoryUsage()` + `v8.getHeapStatistics()` on an
 *     interval (no React/Ink deps — pure timer, wired from app.tsx)
 *   - appends a JSONL diagnostic line to `~/.wrongstack/logs/heap.jsonl`
 *     every `logEveryMs`, including caller-supplied structure sizes
 *     (history entries, conversation messages, …)
 *   - fires `onWarn` when heap usage crosses WARN (60%) / CRITICAL (85%)
 *     of the V8 heap limit, once per crossing (re-arms with hysteresis)
 *
 * The log line is intentionally flat JSON so `jq`/spreadsheets can plot it.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as v8 from 'node:v8';
import { wstackGlobalRoot } from '@wrongstack/core';

export interface HeapSample {
  ts: string;
  /** Resident set size, bytes. */
  rss: number;
  heapUsed: number;
  heapTotal: number;
  /** Off-heap (buffers, etc.), bytes. */
  external: number;
  /** V8 hard heap limit, bytes — the OOM ceiling. */
  heapLimit: number;
  /** heapUsed / heapLimit, 0–1. */
  load: number;
}

export interface HeapWatchdogOptions {
  /** Sampling cadence. Default 60s. */
  sampleEveryMs?: number | undefined;
  /** Diagnostic-file append cadence. Default 5min. */
  logEveryMs?: number | undefined;
  /** Diagnostics file. Default ~/.wrongstack/logs/heap.jsonl */
  logPath?: string | undefined;
  /** Fraction of the heap limit that triggers a 'warn' callback. Default 0.6. */
  warnAt?: number | undefined;
  /** Fraction of the heap limit that triggers a 'critical' callback. Default 0.85. */
  criticalAt?: number | undefined;
  /**
   * Extra structure sizes merged into every diagnostic line — supply cheap
   * counters (array lengths, approximate char totals). Must not throw.
   */
  collectStats?: (() => Record<string, number>) | undefined;
  /** Called on threshold crossings with a human-readable message. */
  onWarn?: ((level: 'warn' | 'critical', message: string, sample: HeapSample) => void) | undefined;
}

const MB = 1024 * 1024;

export function defaultHeapLogPath(): string {
  return path.join(wstackGlobalRoot(), 'logs', 'heap.jsonl');
}

export function takeHeapSample(): HeapSample {
  const m = process.memoryUsage();
  const limit = v8.getHeapStatistics().heap_size_limit || 0;
  return {
    ts: new Date().toISOString(),
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
    heapLimit: limit,
    load: limit > 0 ? m.heapUsed / limit : 0,
  };
}

/**
 * Start the watchdog. Returns a stop function — call it on unmount/exit.
 * All I/O is best-effort and serialized; a failed append never throws into
 * the caller.
 */
export function startHeapWatchdog(opts: HeapWatchdogOptions = {}): () => void {
  const sampleEveryMs = opts.sampleEveryMs ?? 60_000;
  const logEveryMs = opts.logEveryMs ?? 300_000;
  const logPath = opts.logPath ?? defaultHeapLogPath();
  const warnAt = opts.warnAt ?? 0.6;
  const criticalAt = opts.criticalAt ?? 0.85;
  // Hysteresis: once fired, a level re-arms only after load falls this far
  // below its threshold — prevents a flapping boundary from spamming chat.
  const REARM_MARGIN = 0.05;

  let warnArmed = true;
  let criticalArmed = true;
  let lastLogAt = 0;
  let writeChain: Promise<unknown> = Promise.resolve();
  let dirReady = false;

  const append = (line: string): void => {
    writeChain = writeChain
      .then(async () => {
        if (!dirReady) {
          await fsp.mkdir(path.dirname(logPath), { recursive: true });
          dirReady = true;
        }
        await fsp.appendFile(logPath, `${line}\n`, 'utf8');
      })
      .catch(() => undefined);
  };

  const tick = (): void => {
    // User-timing hygiene. Node keeps every performance.mark()/measure()
    // entry in the global timeline until explicitly cleared — there is no
    // browser DevTools consuming them. React's development build (Component
    // Performance Track) measures every component render, which leaked
    // ~3 GB of PerformanceMeasure objects over a long TUI session before
    // NODE_ENV defaulted to production. Clearing here is belt-and-braces
    // against ANY dependency that emits user timings; the per-interval
    // count is logged so a regression is visible in heap.jsonl.
    let userTimings = 0;
    try {
      userTimings =
        performance.getEntriesByType('mark').length +
        performance.getEntriesByType('measure').length;
      if (userTimings > 0) {
        performance.clearMarks();
        performance.clearMeasures();
      }
    } catch {
      // performance API unavailable — nothing to clean
    }

    const s = takeHeapSample();

    // Threshold callbacks — critical first so a single giant jump surfaces
    // the stronger message, not both.
    if (s.load >= criticalAt && criticalArmed) {
      criticalArmed = false;
      warnArmed = false;
      opts.onWarn?.(
        'critical',
        `Heap critical: ${Math.round(s.heapUsed / MB)} MB of ~${Math.round(s.heapLimit / MB)} MB V8 limit (${Math.round(s.load * 100)}%). ` +
          `An out-of-memory crash is likely soon — finish/checkpoint work and restart the session. Diagnostics: ${logPath}`,
        s,
      );
    } else if (s.load >= warnAt && warnArmed) {
      warnArmed = false;
      opts.onWarn?.(
        'warn',
        `Heap high: ${Math.round(s.heapUsed / MB)} MB of ~${Math.round(s.heapLimit / MB)} MB V8 limit (${Math.round(s.load * 100)}%). ` +
          `Memory diagnostics are being recorded to ${logPath}`,
        s,
      );
    }
    // Re-arm with hysteresis.
    if (!warnArmed && s.load < warnAt - REARM_MARGIN) warnArmed = true;
    if (!criticalArmed && s.load < criticalAt - REARM_MARGIN) criticalArmed = true;

    // Periodic diagnostic line; also force one on every fired threshold so
    // the crossing itself is always on disk even between log intervals.
    const due = Date.now() - lastLogAt >= logEveryMs;
    const crossed = s.load >= warnAt;
    if (due || crossed) {
      lastLogAt = Date.now();
      let extras: Record<string, number> = {};
      try {
        extras = opts.collectStats?.() ?? {};
      } catch {
        // collectStats must not break sampling
      }
      append(JSON.stringify({ pid: process.pid, ...s, userTimings, ...extras }));
    }
  };

  const timer = setInterval(tick, sampleEveryMs);
  timer.unref?.();
  // Immediate first sample so a session that OOMs early still leaves a trace.
  tick();

  return () => {
    clearInterval(timer);
  };
}
