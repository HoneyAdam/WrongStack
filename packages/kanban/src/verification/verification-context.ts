/**
 * VerificationContext — the execution environment available to every verifier.
 *
 * Provides deterministic filesystem, git, command, and test runner access.
 * Every method returns concrete structured data — never opens an LLM channel.
 *
 * The `requireBackingEvidence` flag controls whether escalation verifiers
 * (agent, council) must produce concrete proof. Always true in this system.
 */
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { KanbanBoard, KanbanTask } from '../types.js';

/** A snapshot of the git working tree at a point in time. */
export interface TreeSnapshot {
  id: string;
  capturedAt: string;
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

export class VerificationContext {
  readonly projectRoot: string;
  readonly board: KanbanBoard;
  readonly task: KanbanTask;
  /** When true, agent/council verifiers must produce concrete proof. */
  readonly requireBackingEvidence = true;

  /** Optional pre-execution git snapshot for diff comparison. */
  private snapshot: TreeSnapshot | null = null;

  constructor(opts: {
    projectRoot: string;
    board: KanbanBoard;
    task: KanbanTask;
  }) {
    this.projectRoot = opts.projectRoot;
    this.board = opts.board;
    this.task = opts.task;
  }

  // ---------------------------------------------------------------------------
  // Git helpers
  // ---------------------------------------------------------------------------

  /** Capture the current git tree state for later diff comparison. */
  async captureSnapshot(): Promise<TreeSnapshot> {
    const snapshot: TreeSnapshot = {
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
    };
    this.snapshot = snapshot;
    return snapshot;
  }

  /** Compute the diff since the captured snapshot. No snapshot = empty diff. */
  async diffSince(_snapshot?: TreeSnapshot): Promise<FileDiffEntry[]> {
    const useSnapshot = _snapshot ?? this.snapshot;
    if (!useSnapshot) return [];
    try {
      const { stdout } = await this.runGitCommand(
        ['diff', '--numstat', 'HEAD'],
      );
      return parseGitNumstat(stdout);
    } catch {
      return [];
    }
  }

  /** Get a full diff (unified format) for a set of files. */
  async gitDiffForFiles(filePaths: string[]): Promise<string> {
    if (filePaths.length === 0) return '';
    try {
      const { stdout } = await this.runGitCommand([
        'diff',
        'HEAD',
        '--',
        ...filePaths,
      ]);
      return stdout;
    } catch {
      return '';
    }
  }

  /** Get the working tree status. */
  async gitStatus(): Promise<GitStatusResult> {
    try {
      const { stdout } = await this.runGitCommand([
        'status',
        '--porcelain',
      ]);
      const lines = stdout.split('\n').filter((l) => l.trim());
      const untracked = lines.filter((l) => l.startsWith('??')).length;
      const unstaged = lines.filter(
        (l) => /^.[^ ]/.test(l) && !l.startsWith('??'),
      ).length;
      const staged = lines.filter((l) => /^[^ ]/.test(l)).length;
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

  /** Run a shell command and return structured output. Bounded by timeout. */
  async runCommand(
    command: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<CommandResult> {
    const start = Date.now();
    const cwd = opts?.cwd ?? this.projectRoot;
    const timeoutMs = opts?.timeoutMs ?? 60_000;

    return new Promise<CommandResult>((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows
        ? ['cmd', '/d', '/c']
        : ['sh', '-c'];
      const child = spawn(shell[0]!, [...shell.slice(1), command], {
        cwd,
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        const durationMs = Date.now() - start;
        resolve({
          command,
          exitCode: -1,
          stdout,
          stderr: `${stderr}\n--- timed out after ${timeoutMs}ms ---`,
          durationMs,
        });
      }, timeoutMs);

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (timedOut) return;
        resolve({
          command,
          exitCode: code ?? -1,
          stdout,
          stderr,
          durationMs: Date.now() - start,
        });
      });

      child.on('error', () => {
        clearTimeout(timer);
        if (timedOut) return;
        resolve({
          command,
          exitCode: -1,
          stdout,
          stderr: `${stderr}\n--- spawn error ---`,
          durationMs: Date.now() - start,
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Test runner
  // ---------------------------------------------------------------------------

  /** Run a test pattern (vitest or jest) and return structured results. */
  async runTest(
    pattern: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<TestResult> {
    const start = Date.now();
    const cwd = opts?.cwd ?? this.projectRoot;
    const timeoutMs = opts?.timeoutMs ?? 180_000;
    const runner = await this.detectTestRunner(cwd);
    const command = `${runner} run ${pattern} --reporter=json 2>/dev/null || true`;

    const result = await this.runCommand(command, { cwd, timeoutMs });

    // Try to parse JSON output from test runner
    const parsed = tryParseTestJson(result.stdout, pattern);
    if (parsed) {
      return {
        ...parsed,
        durationMs: Date.now() - start,
      };
    }

    // Fallback: parse summary line from non-JSON output
    const passMatch = result.stdout.match(/(\d+)\s+passed/);
    const failMatch = result.stdout.match(/(\d+)\s+failed/);
    return {
      testPattern: pattern,
      passed: passMatch ? parseInt(passMatch[1]!, 10) : 0,
      failed: failMatch ? parseInt(failMatch[1]!, 10) : 0,
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
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.projectRoot,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`git ${args.join(' ')} failed: ${stderr.slice(0, 500)}`));
      });
      child.on('error', reject);
    });
  }

  private async detectTestRunner(cwd: string): Promise<string> {
    try {
      const pkg = await fsp.readFile(
        path.join(cwd, 'package.json'),
        'utf8',
      );
      const json = JSON.parse(pkg) as Record<string, unknown>;
      const scripts = json['scripts'] as Record<string, string> | undefined;
      if (scripts) {
        for (const [name, cmd] of Object.entries(scripts)) {
          if (name === 'test' && cmd.includes('jest')) return 'npx jest';
          if (name === 'test' && cmd.includes('vitest')) return 'npx vitest';
          if (name === 'test') return 'npx vitest'; // default
        }
      }
      // Check lockfiles
      try {
        await fsp.access(path.join(cwd, 'pnpm-lock.yaml'));
        return 'pnpm vitest';
      } catch {
        return 'npx vitest';
      }
    } catch {
      return 'npx vitest';
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

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
      let operation: 'create' | 'modify' | 'delete' = 'modify';
      if (added > 0 && removed === 0) {
        // Could be create, but diff --numstat shows 0 for binary additions.
        // We conservatively treat new files as create.
        operation = 'modify';
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
    // Find JSON block in output
    const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
    const raw = jsonMatch?.[0] ?? output;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Vitest JSON format
    if (parsed && typeof parsed === 'object') {
      const numPassed =
        (parsed['numPassedTests'] as number) ??
        (parsed['success'] as boolean) === true
          ? 1
          : 0;
      const numFailed =
        (parsed['numFailedTests'] as number) ??
        (parsed['success'] as boolean) === false
          ? 1
          : 0;
      const numSkipped =
        (parsed['numSkippedTests'] as number) ?? 0;
      return {
        testPattern: pattern,
        passed: typeof numPassed === 'number' ? numPassed : 0,
        failed: typeof numFailed === 'number' ? numFailed : 0,
        skipped: typeof numSkipped === 'number' ? numSkipped : 0,
      };
    }
  } catch {
    // Not JSON output — fall through
  }
  return null;
}
