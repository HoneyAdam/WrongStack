/**
 * VerificationContext — the execution environment available to every verifier.
 *
 * Provides deterministic filesystem, git, command, and test runner access.
 * Every method returns concrete structured data — never opens an LLM channel.
 *
 * The `requireBackingEvidence` flag controls whether escalation verifiers
 * (agent, council) must produce concrete proof. Always true in this system.
 *
 * ── Command Security ─────────────────────────────────────────────────────────
 * All shell commands are validated against a base-command allowlist and a
 * shell-operator regex before execution. The allowlist permits only read-only
 * inspection commands by default. Shell operators (&&, ||, ;,
 * |, &, >, <, backticks, $(), newline, carriage return) are rejected entirely
 * in `runCommand` to prevent chaining additional operations past the intended
 * command.
 *
 * NOTE: The allowlist is a **base-command gate** — it checks only the first
 * token. Package managers, shells, interpreters, compilers, and git are absent
 * because each can execute arbitrary code even without a shell operator.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { KanbanBoard, KanbanTask } from '../types.js';

// ─── Command Allowlist ──────────────────────────────────────────────────────

/**
 * Regex that detects shell metacharacters used to chain multiple commands.
 *
 * Blocked operators:
 *   `&&`, `||` — command chaining
 *   `;`, `|`, `` ` `` — separator, pipe, command substitution
 *   `>`, `<`, `&` — redirections and backgrounding
 *   `$(` — command substitution
 *   `\n`, `\r` — newline / carriage return as command separators
 *
 * NOTE: No preceding-character escape guard is used. Shell backslash handling
 * inside `sh -c` is platform-dependent, and a guard creates a clean bypass
 * with even backslash runs. A false positive (rejecting a safe command) is
 * safer than a false negative.
 */
export const SHELL_OPERATOR_RE = /(?:&&|\|\||[;&<>|`\n\r]|\$[({])/;

/**
 * Commands permitted by default — read-only inspection only.
 *
 * `git` is intentionally absent — the verifier uses `runGitCommand()` which
 * spawns git directly with an argument array (not through the shell allowlist).
 * Test runners resolve a locally installed package's declared bin entry and
 * invoke it through Node; package managers never use this generic surface.
 */
export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  'ls', 'dir', 'cat', 'type',
  'echo', 'printf', 'test', '[',
  'which', 'where',
  'pwd', 'cd',
  'head', 'tail', 'more', 'less',
  'wc', 'grep', 'findstr', 'rg', 'ripgrep',
  'sort', 'uniq',
  'diff', 'fc',
  'true', 'false',
];

/** Commands explicitly blocked even when they would otherwise pass the allowlist. */
export const DEFAULT_BLOCKED_COMMANDS: readonly string[] = [
  'rm', 'del', 'erase', 'rmdir', 'rd', 'rmtree',
  'mk', 'mkdir', 'md', 'mv', 'move', 'cp', 'copy', 'xcopy', 'robocopy',
  'ren', 'rename', 'ln', 'link', 'mklink', 'install', 'touch',
  'kill', 'taskkill', 'pkill',
  'shutdown', 'reboot', 'halt', 'poweroff', 'init',
  'chmod', 'chown', 'chgrp', 'attrib', 'cacls', 'icacls',
  'format', 'fdisk', 'dd', 'mkfs', 'mount', 'umount', 'diskpart',
  'wget', 'curl', 'fetch', 'nc', 'netcat', 'telnet', 'ssh', 'scp', 'rsync',
  'ftp', 'sftp',
  'sudo', 'su', 'runas', 'doas',
  'sh', 'bash', 'zsh', 'ksh', 'dash', 'ash',
  'cmd', 'powershell', 'pwsh',
  'apt', 'apt-get', 'dpkg', 'rpm', 'yum', 'dnf', 'pacman', 'zypper',
  'brew', 'port', 'choco', 'scoop', 'winget',
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'node',
  'make', 'cmake', 'gcc', 'g++', 'clang', 'rustc',
  'tar', 'gzip', 'gunzip', 'zip', 'unzip', '7z', 'rar',
  'base64', 'base32', 'openssl', 'gpg',
  'reg', 'regedit', 'sc', 'net', 'netsh', 'vssadmin', 'bcdedit',
  'invoke-webrequest', 'iwr',
  'perl', 'python', 'python3', 'ruby', 'php', 'lua', 'tclsh',
  'find',
];

export interface CommandAllowlistConfig {
  /**
   * Additional base commands to permit, or existing ones to add/remove.
   *
   * Prefix semantics:
   *   `"cmd"`    — add `cmd` to the allowlist
   *   `"+cmd"`   — add `cmd` to the allowlist (explicit)
   *   `"-cmd"`   — remove `cmd` from the default allowlist
   */
  allowedCommands?: readonly string[] | undefined;
  /** Base commands explicitly blocked, merged with the built-in blocklist. */
  blockedCommands?: readonly string[] | undefined;
  /** When true, allow any base command not in the blocked list (default: false).
   *  Shell-operator detection still applies. */
  allowAll?: boolean | undefined;
}

export function normalizeBaseCommand(token: string): string {
  return token.replace(/^.*[/\\]/, '').toLowerCase();
}

function buildAllowlist(
  config: CommandAllowlistConfig | undefined,
): { allow: Set<string>; block: Set<string> } {
  const allow = new Set(DEFAULT_ALLOWED_COMMANDS.map((c) => normalizeBaseCommand(c)));
  const block = new Set(DEFAULT_BLOCKED_COMMANDS.map((c) => normalizeBaseCommand(c)));
  if (config?.allowedCommands) {
    for (const cmd of config.allowedCommands) {
      if (cmd.startsWith('+')) {
        allow.add(normalizeBaseCommand(cmd.slice(1)));
      } else if (cmd.startsWith('-')) {
        allow.delete(normalizeBaseCommand(cmd.slice(1)));
      } else {
        allow.add(normalizeBaseCommand(cmd));
      }
    }
  }
  if (config?.blockedCommands) {
    for (const cmd of config.blockedCommands) {
      if (cmd.startsWith('+')) {
        block.delete(normalizeBaseCommand(cmd.slice(1)));
      } else {
        block.add(normalizeBaseCommand(cmd));
      }
    }
  }
  return { allow, block };
}

/** Extract the base command name from a shell command string. */
export function extractBaseCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  const firstToken = trimmed.split(/\s+/)[0] ?? '';
  return normalizeBaseCommand(firstToken);
}

/** Validate a command string. Returns null if allowed, or an error message. */
export function validateCommand(
  command: string,
  config: {
    allow: Set<string>;
    block: Set<string>;
    allowAll: boolean;
    allowShellOperators?: boolean;
  },
): string | null {
  const base = extractBaseCommand(command);
  if (!base) return 'Empty command.';
  if (command.includes('\n') || command.includes('\r')) {
    return 'Command contains newline or carriage return characters which are not permitted.';
  }
  const testTarget = process.platform === 'win32' ? command.replaceAll('^', '') : command;
  if (!config.allowShellOperators && SHELL_OPERATOR_RE.test(testTarget)) {
    return 'Command contains shell operators (&&, ||, ;, |, &, >, <, backticks, $()) which are not permitted in the verifier.';
  }
  if (config.block.has(base)) {
    return `Command "${base}" is blocked by the verifier security policy.`;
  }
  if (!config.allowAll && !config.allow.has(base)) {
    return `Command "${base}" is not in the verifier allowlist.`;
  }
  return null;
}

// ─── Tree / Diff / Result Types ────────────────────────────────────────────

/** A snapshot of the git working tree at a point in time. */
export interface TreeSnapshot {
  id: string;
  capturedAt: string;
  /** The `git rev-parse HEAD` hash at capture time. */
  commitHash: string;
}

/** A single file diff entry. */
export interface FileDiffEntry {
  path: string;
  operation: 'create' | 'modify' | 'delete';
  linesAdded: number;
  linesRemoved: number;
  hunks: number;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** When true, the command was rejected by the security gate before execution. */
  rejected?: boolean | undefined;
}

export interface TestResult {
  testPattern: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  /** Truncated failure output when tests fail. */
  failureOutput?: string | undefined;
}

export interface GitStatusResult {
  clean: boolean;
  untracked: number;
  unstaged: number;
  staged: number;
  files: string[];
}

interface TestRunnerInvocation {
  command: string;
  args: string[];
  kind: 'vitest' | 'jest';
}

// ─── VerificationContext ───────────────────────────────────────────────────

export class VerificationContext {
  readonly projectRoot: string;
  readonly board: KanbanBoard;
  readonly task: KanbanTask;
  /** When true, agent/council verifiers must produce concrete proof. */
  readonly requireBackingEvidence = true;

  /** Resolved command allowlist/blocklist sets. */
  private readonly cmdAllow: Set<string>;
  private readonly cmdBlock: Set<string>;
  private readonly cmdAllowAll: boolean;

  /** Optional pre-execution git snapshot for diff comparison. */
  private snapshot: TreeSnapshot | null = null;

  constructor(opts: {
    projectRoot: string;
    board: KanbanBoard;
    task: KanbanTask;
    /** Optional command allowlist configuration. Extends the defaults. */
    commandAllowlist?: CommandAllowlistConfig | undefined;
  }) {
    this.projectRoot = opts.projectRoot;
    this.board = opts.board;
    this.task = opts.task;

    const allowlist = buildAllowlist(opts.commandAllowlist);
    this.cmdAllow = allowlist.allow;
    this.cmdBlock = allowlist.block;
    this.cmdAllowAll = opts.commandAllowlist?.allowAll ?? false;
  }

  // ---------------------------------------------------------------------------
  // Git helpers
  // ---------------------------------------------------------------------------

  /** Capture the current git tree state for later diff comparison.
   *  Stores `git rev-parse HEAD` so `diffSince()` can diff against the stored
   *  commit, not the current HEAD — this prevents pre-existing uncommitted
   *  changes from polluting the verification diff.
   *
   *  If `git rev-parse HEAD` fails (no repo, no commits yet, detached HEAD
   *  with no commits), the snapshot is still returned but with an empty
   *  `commitHash`. Callers should treat this as "snapshot unreliable";
   *  `diffSince()` will return `[]` rather than running `git diff --numstat
   *  HEAD` against a non-existent HEAD (which would silently swallow the
   *  failure and produce an empty diff even when staged files exist). */
  async captureSnapshot(): Promise<TreeSnapshot> {
    let commitHash = '';
    try {
      const { stdout } = await this.runGitCommand(['rev-parse', 'HEAD']);
      commitHash = stdout.trim();
    } catch (err) {
      // Surface the failure: `diffSince()` skips empty commitHashes, so a
      // missing commit hash reliably means "snapshot unreliable" instead of
      // silently diffing against an absent HEAD.
      console.warn(
        `[verification-context] captureSnapshot: git rev-parse HEAD failed; ` +
          `snapshot stored with empty commitHash. diffSince() will return []. ` +
          `Cause: ${(err as Error).message}`,
      );
    }
    const snapshot: TreeSnapshot = {
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
      commitHash,
    };
    this.snapshot = snapshot;
    return snapshot;
  }

  /** Compute the diff since the captured snapshot. No snapshot = empty diff.
   *  Uses the stored `commitHash` instead of always diffing against the current
   *  HEAD, so pre-existing uncommitted changes do not pollute verification.
   *
   *  If the snapshot's `commitHash` is empty (captureSnapshot failed), this
   *  returns `[]` rather than running `git diff --numstat HEAD` against an
   *  absent HEAD — which would silently miss staged files. */
  async diffSince(_snapshot?: TreeSnapshot): Promise<FileDiffEntry[]> {
    const useSnapshot = _snapshot ?? this.snapshot;
    if (!useSnapshot) return [];
    // Empty commitHash means captureSnapshot failed; skip the diff rather than
    // running `git diff --numstat HEAD` against a non-existent HEAD.
    if (!useSnapshot.commitHash) return [];
    // Validate commitHash to prevent argv injection
    if (!/^(?:[0-9a-f]{7,64}|HEAD)$/.test(useSnapshot.commitHash)) return [];
    try {
      const { stdout } = await this.runGitCommand(['diff', '--numstat', useSnapshot.commitHash]);
      return parseGitNumstat(stdout);
    } catch {
      return [];
    }
  }

  /** Get a full diff (unified format) for a set of files. */
  async gitDiffForFiles(filePaths: string[]): Promise<string> {
    if (filePaths.length === 0) return '';
    try {
      const { stdout } = await this.runGitCommand(['diff', 'HEAD', '--', ...filePaths]);
      return stdout;
    } catch {
      return '';
    }
  }

  /** Get the working tree status. */
  async gitStatus(): Promise<GitStatusResult> {
    try {
      const { stdout } = await this.runGitCommand(['status', '--porcelain']);
      const lines = stdout.split('\n').filter((l) => l.trim());
      const untracked = lines.filter((l) => l.startsWith('??')).length;
      const unstaged = lines.filter(
        (l) => /^.[^ ]/.test(l) && !l.startsWith('??'),
      ).length;
      const staged = lines.filter((l) => /^[^ ]/.test(l) && !l.startsWith('??')).length;
      const files = lines.map((l) => l.slice(3).trim()).filter(Boolean);
      return {
        clean: lines.length === 0,
        untracked,
        unstaged,
        staged,
        files,
      };
    } catch {
      return { clean: true, untracked: 0, unstaged: 0, staged: 0, files: [] };
    }
  }

  // ---------------------------------------------------------------------------
  // Filesystem helpers
  // ---------------------------------------------------------------------------

  /** Read a file relative to project root. */
  async readFile(filePath: string): Promise<string> {
    const resolved = path.resolve(this.projectRoot, filePath);
    return fsp.readFile(resolved, 'utf8');
  }

  /** Check if a file exists relative to project root. */
  async fileExists(filePath: string): Promise<boolean> {
    const resolved = path.resolve(this.projectRoot, filePath);
    try {
      await fsp.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  /** Stat a file (size, mtime). */
  async fileStat(
    filePath: string,
  ): Promise<{ exists: boolean; size: number; mtime: string } | null> {
    const resolved = path.resolve(this.projectRoot, filePath);
    try {
      const stat = await fsp.stat(resolved);
      return {
        exists: true,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      };
    } catch {
      return { exists: false, size: 0, mtime: '' };
    }
  }

  // ---------------------------------------------------------------------------
  // Command runner
  // ---------------------------------------------------------------------------

  /** Run a shell command and return structured output. Bounded by timeout.
   *
   * The command is gated by the base-command allowlist and the shell-operator
   * regex, which rejects `&&`, `||`, `;`, `|`, `&`, `>`, `<`, backticks, and
   * `$()` by default. Callers that explicitly set `allowShellOperators` assume
   * responsibility for validating the complete command string. `runTest()`
   * does not use this escape hatch; it spawns a locally installed runner with
   * an argument array and `shell: false`. */
  async runCommand(
    command: string,
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      allowShellOperators?: boolean;
    },
  ): Promise<CommandResult> {
    const start = Date.now();

    // ── Command Security Gate ──────────────────────────────────────────────
    const validationError = validateCommand(command, {
      allow: this.cmdAllow,
      block: this.cmdBlock,
      allowAll: this.cmdAllowAll,
      allowShellOperators: opts?.allowShellOperators ?? false,
    });
    if (validationError !== null) {
      return {
        command,
        exitCode: -1,
        stdout: '',
        stderr: validationError,
        durationMs: Date.now() - start,
        rejected: true,
      };
    }

    const cwd = opts?.cwd ?? this.projectRoot;
    const timeoutMs = opts?.timeoutMs ?? 60_000;

    return new Promise<CommandResult>((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? ['cmd', '/d', '/c'] : ['sh', '-c'];
      const child = spawn(shell[0]!, [...shell.slice(1), command], {
        cwd,
        shell: false,
        windowsHide: true,
        detached: !isWindows,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      let timer: NodeJS.Timeout | undefined;
      const finish = (exitCode: number, suffix = ''): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          command,
          exitCode,
          stdout,
          stderr: `${stderr}${suffix}`,
          durationMs: Date.now() - start,
        });
      };

      timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child, !isWindows);
        finish(-1, `\n--- timed out after ${timeoutMs}ms ---`);
      }, timeoutMs);

      child.on('close', (code) => {
        finish(
          timedOut ? -1 : (code ?? -1),
          timedOut ? `\n--- timed out after ${timeoutMs}ms ---` : '',
        );
      });

      child.on('error', () => {
        finish(-1, timedOut ? `\n--- timed out after ${timeoutMs}ms ---` : '\n--- spawn error ---');
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Test runner
  // ---------------------------------------------------------------------------

  /** Run a test pattern (vitest or jest) and return structured results. */
  async runTest(pattern: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<TestResult> {
    const start = Date.now();

    if (pattern.includes('\0') || pattern.trimStart().startsWith('-')) {
      return {
        testPattern: pattern,
        passed: 0,
        failed: 1,
        skipped: 0,
        durationMs: Date.now() - start,
        failureOutput: pattern.includes('\0')
          ? 'Test pattern contains a null byte and was rejected.'
          : 'Test pattern must not start with an option prefix.',
      };
    }

    const cwd = opts?.cwd ?? this.projectRoot;
    const timeoutMs = opts?.timeoutMs ?? 180_000;
    const runner = await this.detectTestRunner(cwd);
    if (!runner) {
      return {
        testPattern: pattern,
        passed: 0,
        failed: 1,
        skipped: 0,
        durationMs: Date.now() - start,
        failureOutput: 'No local Vitest or Jest executable was found.',
      };
    }

    const runnerArgs =
      runner.kind === 'vitest'
        ? [...runner.args, 'run', pattern, '--reporter=json']
        : [...runner.args, pattern, '--json'];
    const result = await this.runProcess(runner.command, runnerArgs, { cwd, timeoutMs });

    const parsed = tryParseTestJson(result.stdout, pattern);
    if (parsed) {
      const failed = result.exitCode !== 0 && parsed.failed === 0 ? 1 : parsed.failed;
      return {
        ...parsed,
        failed,
        durationMs: Date.now() - start,
        failureOutput:
          result.exitCode !== 0
            ? result.stderr.slice(0, 2000) || result.stdout.slice(0, 2000)
            : undefined,
      };
    }

    const passMatch = result.stdout.match(/(\d+)\s+passed/);
    const failMatch = result.stdout.match(/(\d+)\s+failed/);
    return {
      testPattern: pattern,
      passed: passMatch ? parseInt(passMatch[1]!, 10) : 0,
      failed: failMatch ? parseInt(failMatch[1]!, 10) : result.exitCode === 0 ? 0 : 1,
      skipped: 0,
      durationMs: Date.now() - start,
      failureOutput:
        result.exitCode !== 0
          ? result.stderr.slice(0, 2000) || result.stdout.slice(0, 2000)
          : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async runGitCommand(
    args: string[],
    timeoutMs = 30_000,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const detachedProcessGroup = process.platform !== 'win32';
      const child = spawn('git', args, {
        cwd: this.projectRoot,
        windowsHide: true,
        detached: detachedProcessGroup,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        terminateProcessTree(child, detachedProcessGroup);
        reject(new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`git ${args.join(' ')} failed: ${stderr.slice(0, 500)}`));
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  /**
   * Spawn a trusted local test runner with an argument array. This private
   * helper is never exposed as a model-selected executable surface.
   */
  private async runProcess(
    command: string,
    args: string[],
    opts: { cwd: string; timeoutMs: number },
  ): Promise<CommandResult> {
    const start = Date.now();
    const displayCommand = [command, ...args].join(' ');
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      let timer: NodeJS.Timeout | undefined;
      const finish = (exitCode: number, suffix = ''): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          command: displayCommand,
          exitCode,
          stdout,
          stderr: `${stderr}${suffix}`,
          durationMs: Date.now() - start,
        });
      };

      timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child, process.platform !== 'win32');
        finish(-1, `\n--- timed out after ${opts.timeoutMs}ms ---`);
      }, opts.timeoutMs);

      child.on('close', (code) => {
        finish(
          timedOut ? -1 : (code ?? -1),
          timedOut ? `\n--- timed out after ${opts.timeoutMs}ms ---` : '',
        );
      });
      child.on('error', () => {
        finish(
          -1,
          timedOut ? `\n--- timed out after ${opts.timeoutMs}ms ---` : '\n--- spawn error ---',
        );
      });
    });
  }

  private async detectTestRunner(cwd: string): Promise<TestRunnerInvocation | null> {
    let preferred: 'vitest' | 'jest' = 'vitest';
    try {
      const pkg = await fsp.readFile(path.join(cwd, 'package.json'), 'utf8');
      const json = JSON.parse(pkg) as Record<string, unknown>;
      const scripts = json['scripts'];
      const testScript =
        typeof scripts === 'object' && scripts !== null
          ? (scripts as Record<string, unknown>)['test']
          : undefined;
      if (typeof testScript === 'string' && testScript.includes('jest')) preferred = 'jest';
    } catch {
      // Fall back to Vitest discovery below.
    }

    const candidates: Array<'vitest' | 'jest'> =
      preferred === 'jest' ? ['jest', 'vitest'] : ['vitest', 'jest'];
    let requireFromProject: ReturnType<typeof createRequire>;
    try {
      requireFromProject = createRequire(path.resolve(cwd, 'package.json'));
    } catch {
      return null;
    }
    for (const runner of candidates) {
      try {
        const packageJsonPath = requireFromProject.resolve(`${runner}/package.json`);
        const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, 'utf8')) as {
          bin?: string | Record<string, string>;
        };
        const relativeBin =
          typeof packageJson.bin === 'string'
            ? packageJson.bin
            : packageJson.bin?.[runner];
        if (!relativeBin || path.isAbsolute(relativeBin)) continue;
        const packageDir = path.dirname(packageJsonPath);
        const entry = path.resolve(packageDir, relativeBin);
        if (path.relative(packageDir, entry).startsWith('..')) continue;
        await fsp.access(entry);
        return { command: process.execPath, args: [entry], kind: runner };
      } catch {
        // Try the next locally installed runner. Never download one during verification.
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

/** Best-effort process-tree termination that never delays timeout settlement. */
function terminateProcessTree(child: ChildProcess, detachedProcessGroup: boolean): void {
  const pid = child.pid;
  if (typeof pid === 'number' && process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      const forceKillChild = (): void => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process already exited.
        }
      };
      killer.once('error', forceKillChild);
      killer.once('close', (code) => {
        if (code !== 0) forceKillChild();
      });
      killer.unref();
      return;
    } catch {
      // Fall through to direct termination.
    }
  }
  try {
    if (typeof pid === 'number' && detachedProcessGroup) {
      process.kill(-pid, 'SIGKILL');
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

/** Parse `git diff --numstat` output into structured entries. */
export function parseGitNumstat(output: string): FileDiffEntry[] {
  return output
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split('\t');
      if (parts.length < 3) return null;
      const added = parseInt(parts[0]!, 10) || 0;
      const removed = parseInt(parts[1]!, 10) || 0;
      const filePath = parts[2] ?? '';
      // `git diff --numstat` shows `added\tremoved\tpath`. From numstat alone
      // we cannot distinguish create from modify — a pure-additive modification
      // has the same signature as a new file. Default to 'modify'.
      let operation: 'create' | 'modify' | 'delete' = 'modify';
      if (added === 0 && removed > 0) {
        operation = 'delete';
      }
      return {
        path: filePath,
        operation,
        linesAdded: added,
        linesRemoved: removed,
        hunks: Math.max(1, Math.ceil((added + removed) / 10)),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

/** Try to parse JSON test runner output. */
function tryParseTestJson(
  output: string,
  pattern: string,
): Omit<TestResult, 'durationMs'> | null {
  try {
    // Find JSON block in output — non-greedy to stop at the first complete
    // JSON object containing "testResults", rather than spanning from the
    // first `{` to the last `}` across multiple test runs.
    const jsonMatch = output.match(/\{[\s\S]*?"testResults"[\s\S]*?\}/);
    const raw = jsonMatch?.[0] ?? output;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      const numPassedTestsValue = parsed['numPassedTests'];
      const numFailedTestsValue = parsed['numFailedTests'];
      const numSkippedTestsValue = parsed['numSkippedTests'];
      const successValue = parsed['success'];
      const numPassed =
        typeof numPassedTestsValue === 'number'
          ? numPassedTestsValue
          : typeof successValue === 'boolean'
            ? (successValue ? 1 : 0)
            : 0;
      const numFailed =
        typeof numFailedTestsValue === 'number'
          ? numFailedTestsValue
          : typeof successValue === 'boolean'
            ? (successValue ? 0 : 1)
            : 0;
      const numSkipped =
        typeof numSkippedTestsValue === 'number' ? numSkippedTestsValue : 0;
      return {
        testPattern: pattern,
        passed: numPassed,
        failed: numFailed,
        skipped: numSkipped,
      };
    }
  } catch {
    // Not JSON output — fall through
  }
  return null;
}
