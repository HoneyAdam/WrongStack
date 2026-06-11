import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LogLevel, Logger } from '../types/logger.js';
import { color } from '../utils/color.js';
import { writeErr } from '../utils/term.js';

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const COLORS: Record<LogLevel, (s: string) => string> = {
  error: color.red,
  warn: color.yellow,
  info: color.cyan,
  debug: color.gray,
  trace: color.dim,
};

const LOG_LEVELS = new Set<LogLevel>(['error', 'warn', 'info', 'debug', 'trace']);
const LOG_FORMATS = new Set<string>(['pretty', 'json']);

export type LogFormat = 'pretty' | 'json';

export interface DefaultLoggerOptions {
  level?: LogLevel | undefined;
  file?: string | undefined;
  /**
   * @deprecated Use `format: 'json'` instead. Kept for backward compat
   * with existing callers but has no effect on output — the `format`
   * option controls whether stderr receives pretty-printed or JSON lines.
   */
  pretty?: boolean | undefined;
  /** Output format for stderr. `pretty` (colored, human-readable) or `json` (machine-parseable). Defaults to `WRONGSTACK_LOG_FORMAT` env var, falling back to `pretty`. */
  format?: LogFormat | undefined;
  bindings?: Record<string, unknown>;
  /**
   * When false, suppress stderr output entirely — only write to the log
   * file (if configured). Use this in TUI mode so plugin/library log
   * messages don't interleave with Ink's terminal rendering.
   * Default: true (stderr output is enabled).
   */
  stderr?: boolean | undefined;
  /**
   * Rotate the log file once it exceeds this many bytes: the current file is
   * renamed to `<file>.1` (replacing any previous one) and a fresh file
   * starts. Bounds total disk to ~2× this value. Default 10 MB.
   */
  maxFileBytes?: number | undefined;
}

export class DefaultLogger implements Logger {
  /** How many file writes between rotation size checks (statSync is not free). */
  private static readonly ROTATE_CHECK_EVERY = 100;

  level: LogLevel;
  private readonly file?: string | undefined;
  private readonly bindings: Record<string, unknown>;
  private readonly format: LogFormat;
  private readonly stderr: boolean;
  private readonly maxFileBytes: number;
  private writesSinceRotateCheck = 0;

  constructor(opts: DefaultLoggerOptions = {}) {
    this.level = opts.level ?? parseLogLevel(process.env.WRONGSTACK_LOG_LEVEL);
    this.file = opts.file;
    this.bindings = opts.bindings ?? {};
    this.format = opts.format ?? parseLogFormat(process.env.WRONGSTACK_LOG_FORMAT);
    this.stderr = opts.stderr !== false; // default true
    this.maxFileBytes = opts.maxFileBytes ?? 10 * 1024 * 1024;
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
      } catch {
        // best-effort
      }
    }
  }

  error(msg: string, ctx?: unknown): void {
    this.log('error', msg, ctx);
  }
  warn(msg: string, ctx?: unknown): void {
    this.log('warn', msg, ctx);
  }
  info(msg: string, ctx?: unknown): void {
    this.log('info', msg, ctx);
  }
  debug(msg: string, ctx?: unknown): void {
    this.log('debug', msg, ctx);
  }
  trace(msg: string, ctx?: unknown): void {
    this.log('trace', msg, ctx);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new DefaultLogger({
      level: this.level,
      file: this.file,
      format: this.format,
      stderr: this.stderr,
      maxFileBytes: this.maxFileBytes,
      bindings: { ...this.bindings, ...bindings },
    });
  }

  /**
   * Size-based rotation: when the file outgrows `maxFileBytes`, rename it to
   * `<file>.1` (dropping the previous `.1`) so the live file restarts empty.
   * Checked on the first write and every ROTATE_CHECK_EVERY writes after.
   * Best-effort: a rename can fail on Windows while another process holds
   * the file — the next check retries. Multiple processes appending to the
   * same log all run this check; whoever crosses the threshold first wins.
   */
  private maybeRotate(file: string): void {
    if (this.writesSinceRotateCheck++ % DefaultLogger.ROTATE_CHECK_EVERY !== 0) return;
    try {
      const st = fs.statSync(file);
      if (st.size < this.maxFileBytes) return;
      fs.rmSync(`${file}.1`, { force: true });
      fs.renameSync(file, `${file}.1`);
    } catch {
      // file missing, locked, or raced by another process — ignore
    }
  }

  private log(level: LogLevel, msg: string, ctx?: unknown): void {
    const r = LEVEL_RANK[level];
    const allowed = LEVEL_RANK[this.level];
    if (r > allowed) return;
    const ts = new Date().toISOString();
    const entry: Record<string, unknown> = { ts, level, msg, ...this.bindings };
    if (ctx !== undefined) {
      entry.ctx = ctx instanceof Error ? { message: ctx.message, stack: ctx.stack } : ctx;
    }
    // Disk: JSON line
    if (this.file) {
      try {
        this.maybeRotate(this.file);
        fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
      } catch {
        // ignore
      }
    }
    // Stderr: pretty or json. Suppressed when this.stderr is false (TUI mode)
    // so plugin/library log messages don't interleave with Ink's rendering.
    if (!this.stderr) return;
    if (this.format === 'json') {
      writeErr(`${JSON.stringify(entry)}\n`);
    } else {
      const head = `${color.dim(ts)} ${COLORS[level](level.toUpperCase().padEnd(5))} ${msg}`;
      if (ctx !== undefined) {
        writeErr(`${head} ${formatCtx(ctx)}\n`);
      } else {
        writeErr(`${head}\n`);
      }
    }
  }
}

function parseLogLevel(raw: string | undefined): LogLevel {
  return raw && LOG_LEVELS.has(raw as LogLevel) ? (raw as LogLevel) : 'info';
}

function parseLogFormat(raw: string | undefined): LogFormat {
  return raw && LOG_FORMATS.has(raw) ? (raw as LogFormat) : 'pretty';
}

function formatCtx(ctx: unknown): string {
  if (ctx instanceof Error) return color.dim(ctx.message);
  if (typeof ctx === 'string') return color.dim(ctx);
  try {
    return color.dim(JSON.stringify(ctx));
  } catch {
    return color.dim(String(ctx));
  }
}

/**
 * A logger that silently discards all messages. Used during boot before
 * the real logger is configured, and in test contexts where logging
 * would be noise.
 */
export const noOpLogger: Logger = {
  // 'error' is the quietest level the Logger contract offers; the methods
  // discard everything regardless, this only matters to level checks.
  level: 'error',
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => noOpLogger,
};
