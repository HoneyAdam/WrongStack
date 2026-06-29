/**
 * shell-check plugin — Runs shellcheck analysis on bash/shell scripts.
 *
 * Tools registered:
 * - shellcheck: Run shellcheck on specific files OR recursively scan a directory.
 *
 * Note: The former `shellcheck (scan mode)` tool has been merged into `shellcheck`
 * via the `directory` + `pattern` parameters. Pass `files` for specific
 * files, or `directory` (optionally with `pattern`) for recursive scanning.
 */
import type { Plugin } from '@wrongstack/core';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API_VERSION = '^0.1.10';

interface ShellCheckIssue {
  file: string;
  line: number;
  column: number;
  level: 'error' | 'warning' | 'info' | 'style';
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// ShellCheck runner
// ---------------------------------------------------------------------------

function runShellCheck(
  files: string[],
  severity: 'error' | 'warning' | 'info' | 'style',
  cwd?: string | undefined,
): ShellCheckIssue[] {
  if (!existsSync('shellcheck')) {
    // Try to find shellcheck in PATH
    try {
      execSync('shellcheck --version', { encoding: 'utf-8', stdio: 'ignore', windowsHide: true });
    } catch {
      throw new Error('shellcheck is not installed. Install via: apt install shellcheck / brew install shellcheck');
    }
  }

  const levelMap: Record<string, string> = {
    error: 'error',
    warning: 'warning',
    info: 'info',
    style: 'style',
  };

  /* v8 ignore next -- severity is constrained to levelMap keys by the schema enum; the ?? fallback is defensive. */
  const severityFlag = levelMap[severity] ?? 'warning';
  const args = ['-f', 'json', '-S', severityFlag, ...files];

  let raw: string;
  try {
    // Use execFileSync to avoid shell injection — filenames could contain
    // shell metacharacters like `; rm -rf /` if the LLM is tricked.
    raw = execFileSync('shellcheck', args, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
      windowsHide: true,
    });
  } catch (err: unknown) {
    // shellcheck returns non-zero when issues are found, which is not an error
    const e = err as { stderr?: string | undefined };
    if (e.stderr && !e.stderr.includes('shellcheck')) {
      raw = e.stderr;
    } else {
      return [];
    }
  }

  if (!raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw) as Array<{
      file: string;
      line: number;
      column: number;
      level: string;
      code: string;
      message: string;
    }>;
    return parsed.map((item) => ({
      file: item.file,
      line: item.line,
      column: item.column,
      level: item.level as ShellCheckIssue['level'],
      code: item.code,
      message: item.message,
    }));
  } catch {
    return [];
  }
}

function findShellFiles(dir: string, pattern: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
        results.push(...findShellFiles(full, pattern));
      } else if (entry.isFile() && (entry.name.endsWith('.sh') || entry.name === 'Dockerfile')) {
        if (!pattern || entry.name.includes(pattern)) {
          results.push(full);
        }
      }
    }
  } catch {
    // ignore access errors
  }
  return results;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: Plugin = {
  name: 'shell-check',
  version: '0.2.0',
  description: 'Runs shellcheck analysis on bash/shell scripts and surfaces issues with severity levels',
  apiVersion: API_VERSION,
  capabilities: { tools: true, pipelines: ['toolCall'] },
  defaultConfig: {
    severity: 'warning',
    severityThreshold: 'warning',
    ignoredCodes: [],
    autoScanOnBash: false,
  },
  configSchema: {
    type: 'object',
    properties: {
      severity: { type: 'string', enum: ['error', 'warning', 'info', 'style'], default: 'warning' },
      severityThreshold: { type: 'string', enum: ['error', 'warning', 'info', 'style'], default: 'warning' },
      ignoredCodes: { type: 'array', items: { type: 'string' }, default: [] },
      autoScanOnBash: { type: 'boolean', default: false },
    },
  },

  setup(api) {
    // --- shellcheck tool (merged: specific files OR recursive directory scan) ---
    api.tools.register({
      name: 'shellcheck',
      description:
        'Run shellcheck analysis on shell script files. Pass `files` for specific files, ' +
        'or `directory` (optionally with `pattern`) to recursively scan for .sh files. ' +
        'Returns issues with file, line, column, severity, code, and message.',
      inputSchema: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Shell script files to check. Mutually exclusive with `directory`.',
          },
          directory: {
            type: 'string',
            default: '.',
            description: 'Directory to recursively scan for .sh files. Used when `files` is omitted.',
          },
          pattern: {
            type: 'string',
            default: '',
            description: 'Filename pattern to match when scanning a directory (default: all .sh files).',
          },
          severity: {
            type: 'string',
            enum: ['error', 'warning', 'info', 'style'],
            default: 'warning',
            description: 'Minimum severity level to report',
          },
          fix: {
            type: 'boolean',
            default: false,
            description: 'Apply safe automatic fixes where possible',
          },
        },
      },
      permission: 'auto',
      category: 'Code Quality',
      mutating: true,
      async execute(input: Record<string, unknown>) {
        const files = input['files'] as string[] | undefined;
        const directory = (input['directory'] as string) ?? '.';
        const pattern = (input['pattern'] as string) ?? '';
        const severity = (input['severity'] as ShellCheckIssue['level']) ?? 'warning';

        // Resolve the file list: explicit files, or recursive directory scan.
        let checkFiles: string[];
        let scannedDirectories = false;

        if (files && files.length > 0) {
          checkFiles = files;
        } else {
          checkFiles = findShellFiles(directory, pattern);
          scannedDirectories = true;
        }

        if (checkFiles.length === 0) {
          return {
            ok: true,
            filesScanned: 0,
            issues: [],
            summary: { total: 0 },
            mode: scannedDirectories ? 'directory' : 'files',
          };
        }

        let issues: ShellCheckIssue[];
        try {
          issues = runShellCheck(checkFiles, severity);
        } catch (err: unknown) {
          /* v8 ignore next -- runShellCheck only throws Error; the String(err) branch is defensive. */
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, error: msg, issues: [], filesScanned: 0 };
        }

        const byFile: Record<string, ShellCheckIssue[]> = {};
        for (const issue of issues) {
          if (byFile[issue.file] === undefined) {
            byFile[issue.file] = [];
          }
          byFile[issue.file]?.push(issue);
        }

        const errorCount = issues.filter((i) => i.level === 'error').length;
        const warningCount = issues.filter((i) => i.level === 'warning').length;
        const infoCount = issues.filter((i) => i.level === 'info').length;
        const styleCount = issues.filter((i) => i.level === 'style').length;

        api.metrics.counter('issues_found', issues.length, { severity });
        api.metrics.histogram('issues_per_file', issues.length / Math.max(checkFiles.length, 1));

        return {
          ok: true,
          mode: scannedDirectories ? 'directory' : 'files',
          filesScanned: checkFiles.length,
          filesWithIssues: Object.keys(byFile).length,
          issues,
          summary: {
            total: issues.length,
            errors: errorCount,
            warnings: warningCount,
            info: infoCount,
            style: styleCount,
          },
          byFile,
          recommendation: errorCount > 0
            ? 'Fix errors before deploying.'
            : warningCount > 0
              ? 'Review and fix warnings for better script quality.'
              : 'No issues found.',
        };
      },
    });

    api.log.info('shell-check plugin loaded', { version: '0.2.0' });
  },
};

export default plugin;
