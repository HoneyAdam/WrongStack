/**
 * TerminalServer — answers `terminal/*` methods from an ACP agent.
 *
 * The spec lets agents spawn shell commands inside the client's
 * environment and observe their output. We honour the protocol, but
 * every command runs under a per-process timeout and a byte limit on
 * retained output, both to keep runaway agents from filling memory
 * and to give the runner a clean signal when something is stuck.
 *
 * Scoping: commands run with `cwd` set to the agent's requested cwd
 * if its canonical path is inside `projectRoot`, else `projectRoot`.
 * Agent env entries are overlaid on a credential-scrubbed base, except
 * for variables that enable preload injection or path hijacking.
 */
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import * as path from 'node:path';
import { buildChildEnv } from '@wrongstack/core/utils';

export interface TerminalServerOptions {
  projectRoot: string;
  /** Hard cap on per-command wall-clock. Default 5 minutes. */
  commandTimeoutMs?: number;
  /** Bytes of output to retain per terminal. Default 1 MiB. */
  outputByteLimit?: number;
  /**
   * Hard maximum cap on the per-call `outputByteLimit`. The agent can request
   * a lower limit per terminal/create, but it can never raise it above this
   * host-configured ceiling. Protects against memory exhaustion from a
   * malicious agent requesting `outputByteLimit: Infinity`. Default 16 MiB.
   */
  maxOutputByteLimit?: number;
  /** Optional abort signal that kills ALL active terminals. */
  signal?: AbortSignal;
}

interface TerminalState {
  proc: ReturnType<typeof spawn>;
  cwd: string;
  command: string;
  args: string[];
  /** Output buffer as a string; appended as bytes arrive. */
  output: string;
  /** Bytes currently retained (post-truncation). */
  retainedBytes: number;
  /** True once we've dropped output to fit under the per-call byte limit. */
  truncated: boolean;
  exitStatus?: { exitCode: number | null; signal: string | null } | undefined;
  /** Resolves when the process exits. */
  exitPromise: Promise<{ exitCode: number | null; signal: string | null }>;
  /** Per-terminal timeout handle. */
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

export class TerminalServer {
  private readonly terminals = new Map<string, TerminalState>();
  private readonly projectRoot: string;
  private readonly commandTimeoutMs: number;
  private readonly outputByteLimit: number;
  private readonly maxOutputByteLimit: number;
  private nextId = 1;

  constructor(opts: TerminalServerOptions) {
    this.projectRoot = path.resolve(opts.projectRoot);
    this.commandTimeoutMs = opts.commandTimeoutMs ?? 5 * 60_000;
    this.outputByteLimit = opts.outputByteLimit ?? 1024 * 1024;
    this.maxOutputByteLimit = opts.maxOutputByteLimit ?? 16 * 1024 * 1024;
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => this.releaseAll());
    }
  }

  /** Spawn a new terminal. Returns the agent-facing id. */
  create(params: {
    sessionId: string;
    command: string;
    args?: string[];
    env?: { name: string; value: string }[];
    cwd?: string;
    outputByteLimit?: number;
  }): { terminalId: string } {
    const id = `term_${this.nextId++}`;
    const cwd = this.resolveCwd(params.cwd);
    const proc = spawn(params.command, params.args ?? [], {
      cwd,
      env: this.buildEnv(params.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // shell: false on purpose. The terminal server is invoked with
      // the agent's explicit argv; turning on shell-mode would make
      // the command a single shell-parsed string, which breaks
      // Windows cmd quoting for the common case of running node with
      // `-e "<script>"`. If a future feature needs shell features
      // (pipes, redirects), it should be opt-in per-call, not the
      // default.
    });

    const state: TerminalState = {
      proc,
      cwd,
      command: params.command,
      args: params.args ?? [],
      output: '',
      retainedBytes: 0,
      truncated: false,
      exitStatus: undefined,
      timeoutHandle: null,
      exitPromise: new Promise((resolve) => {
        proc.on('close', (code, signalName) => {
          if (state.timeoutHandle) {
            clearTimeout(state.timeoutHandle);
            state.timeoutHandle = null;
          }
          const exitStatus = {
            exitCode: typeof code === 'number' ? code : null,
            signal: typeof signalName === 'string' ? signalName : null,
          };
          state.exitStatus = exitStatus;
          resolve(exitStatus);
        });
        proc.on('error', (err) => {
          // Spawn-time errors (ENOENT etc.) — surface as a special
          // exit status with exitCode 127 (command not found).
          if (state.timeoutHandle) {
            clearTimeout(state.timeoutHandle);
            state.timeoutHandle = null;
          }
          const exitStatus = { exitCode: 127, signal: null };
          state.exitStatus = exitStatus;
          state.output += `[spawn error] ${err.message}\n`;
          state.retainedBytes = Buffer.byteLength(state.output, 'utf8');
          resolve(exitStatus);
        });
      }),
    };

    const perCallByteLimit = Math.min(
      Math.max(1, this.clampFiniteInt(params.outputByteLimit, this.outputByteLimit)),
      this.maxOutputByteLimit,
    );
    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    const onData = (chunk: string): void => {
      state.output += chunk;
      state.retainedBytes = Buffer.byteLength(state.output, 'utf8');
      // Truncate from the start if we exceed the limit. Per spec, the
      // truncation MUST happen at a character boundary. UTF-8 slicing
      // a string can land mid-codepoint; we trim back to the last
      // complete code point to honour that.
      while (state.retainedBytes > perCallByteLimit) {
        const trimmed = state.output.slice(1);
        // Cheap boundary check: if dropping the first char doesn't
        // shrink us by at least one byte, we're slicing inside a
        // multi-byte sequence; keep dropping.
        state.output = trimmed;
        const newBytes = Buffer.byteLength(state.output, 'utf8');
        if (newBytes >= state.retainedBytes) {
          // give up — would loop forever
          break;
        }
        state.retainedBytes = newBytes;
        state.truncated = true;
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    state.timeoutHandle = setTimeout(() => {
      // Best-effort kill; we don't have an exact "TIMEOUT" stop reason
      // so we just exit with -1.
      try {
        proc.kill('SIGTERM');
      } catch {
        // already dead
      }
    }, this.commandTimeoutMs);

    this.terminals.set(id, state);
    return { terminalId: id };
  }

  /** Return captured output and (if available) the exit status. */
  output(terminalId: string): { output: string; truncated: boolean; exitStatus?: { exitCode: number | null; signal: string | null } } {
    const state = this.terminals.get(terminalId);
    if (!state) throw new Error(`unknown terminal: ${terminalId}`);
    return {
      output: state.output,
      truncated: state.truncated,
      ...(state.exitStatus ? { exitStatus: state.exitStatus } : {}),
    };
  }

  /** Block until the process exits. Resolves with the exit status. */
  async waitForExit(terminalId: string): Promise<{ exitCode: number | null; signal: string | null }> {
    const state = this.terminals.get(terminalId);
    if (!state) throw new Error(`unknown terminal: ${terminalId}`);
    return state.exitPromise;
  }

  /** Kill the process but keep the terminal record (agent can still read output). */
  kill(terminalId: string): void {
    const state = this.terminals.get(terminalId);
    if (!state) throw new Error(`unknown terminal: ${terminalId}`);
    try {
      state.proc.kill('SIGTERM');
    } catch {
      // already dead
    }
  }

  /** Kill the process if alive and remove the record. */
  release(terminalId: string): void {
    const state = this.terminals.get(terminalId);
    if (!state) return;
    if (state.timeoutHandle) {
      clearTimeout(state.timeoutHandle);
      state.timeoutHandle = null;
    }
    try {
      state.proc.kill('SIGKILL');
    } catch {
      // already dead
    }
    this.terminals.delete(terminalId);
  }

  /** Kill all active terminals. Used on session close. */
  releaseAll(): void {
    for (const id of [...this.terminals.keys()]) {
      this.release(id);
    }
  }

  private resolveCwd(cwd: string | undefined): string {
    if (!cwd) return this.projectRoot;
    const resolved = path.resolve(cwd);
    const rootWithSep = this.projectRoot.endsWith(path.sep)
      ? this.projectRoot
      : this.projectRoot + path.sep;
    if (resolved !== this.projectRoot && !resolved.startsWith(rootWithSep)) {
      return this.projectRoot;
    }
    try {
      const realRoot = realpathSync(this.projectRoot);
      const realCwd = realpathSync(resolved);
      const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
      if (realCwd !== realRoot && !realCwd.startsWith(realRootWithSep)) {
        return realRoot;
      }
      return realCwd;
    } catch {
      // A process cannot start in a missing/unresolvable cwd. Fall back to the
      // configured root rather than allowing spawn to fail or follow a bad link.
      return this.projectRoot;
    }
  }

  private buildEnv(
    agentEnv?: { name: string; value: string }[],
  ): NodeJS.ProcessEnv {
    // Use the sanitized child env from @wrongstack/core instead of raw
    // process.env. This strips API keys, tokens, and other credentials from
    // the host environment so a compromised ACP agent cannot exfiltrate them
    // via `terminal/create`. buildChildEnv preserves system/tooling variables
    // (PATH, HOME, LANG, ...) and handles the Windows Path/PATH aliasing.
    const env: NodeJS.ProcessEnv = buildChildEnv();
    if (agentEnv) {
      for (const { name, value } of agentEnv) {
        // Deny agent overrides of environment variables that could re-introduce
        // code injection (NODE_OPTIONS --require/--import/--loader), shared-library
        // preloading (LD_PRELOAD, DYLD_*), or path hijacking (PATH). buildChildEnv
        // already stripped these from the host env; the agent must not be able to
        // add them back.
        const upper = name.toUpperCase();
        if (DENIED_AGENT_ENV_KEYS.has(upper)) continue;
        env[name] = value;
      }
    }
    return env;
  }

  /**
   * Clamp an agent-supplied numeric to a finite positive safe integer, falling
   * back to `defaultValue` for undefined/NaN/non-finite values. Prevents
   * negative, NaN, or Infinity values from disabling output caps or causing
   * unbounded memory growth.
   */
  private clampFiniteInt(
    value: number | undefined,
    defaultValue: number,
  ): number {
    if (value === undefined || !Number.isFinite(value) || value < 1) {
      return defaultValue;
    }
    return Math.trunc(value);
  }
}

/**
 * Environment variables an ACP agent must NOT be allowed to set, because they
 * can re-introduce code injection or path hijacking after `buildChildEnv`
 * already stripped them from the host env. Checked case-insensitively.
 */
const DENIED_AGENT_ENV_KEYS: ReadonlySet<string> = new Set([
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'PATH',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PERL5OPT',
  'PERLLIB',
  'RUBYOPT',
  'RUBYLIB',
]);
