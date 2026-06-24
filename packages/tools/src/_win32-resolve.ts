import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * On Windows, Node.js `spawn()` without a shell does NOT resolve .cmd/.bat
 * extensions through PATHEXT — it only auto-resolves .exe. Most Node.js CLI
 * tools (npx, pnpm, biome, tsc, vitest, etc.) ship as .cmd wrappers on
 * Windows. This function resolves the command name to its full path so spawn
 * can find it without relying on shell-mode argument concatenation.
 *
 * On non-Windows, returns the command unchanged.
 */
export function resolveWin32Command(cmd: string): string {
  if (process.platform !== 'win32') return cmd;

  // Already has a path or extension — use as-is
  // Normalize forward slashes so path.extname correctly detects extensions
  // even when a Unix-style path is passed on Windows.
  if (cmd.includes('/') || cmd.includes('\\') || path.extname(cmd.replace(/\//g, '\\'))) {
    return cmd;
  }

  const pathext = (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC')
    .toLowerCase()
    .split(';');

  const pathDirs = (process.env['PATH'] ?? '').split(path.delimiter);

  for (const dir of pathDirs) {
    const base = path.join(dir, cmd);
    // Check extensions in PATHEXT order. .EXE should win first because
    // it's typically listed first, and .exe doesn't need shell: true.
    for (const ext of pathext) {
      const full = `${base}${ext}`;
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // Not found with this extension — try next
      }
    }
  }

  // Not found — return original; let spawn report ENOENT with the
  // expected error message so tools can surface it properly.
  return cmd;
}

/**
 * cmd.exe metacharacters that chain a new command or redirect I/O. When a
 * `.cmd`/`.bat` wrapper is spawned with `shell: true` + `windowsVerbatimArguments:
 * true`, Node passes argv through to `cmd.exe /c` UNQUOTED — so an argument
 * carrying one of these can break out of the intended command line and run an
 * attacker-chosen command (the CVE-2024-27980 / "BatBadBut" argument-injection
 * class). We deliberately opt out of Node's auto-quoting (verbatim) for correct
 * path handling, so this guard restores the protection.
 *
 * The set is limited to the unambiguous command-separator / redirection chars
 * plus newlines and NUL. Legitimate package-manager / test-runner flags and
 * Windows file paths (which use `:` `\` `/` `.` `-` `_` space `(` `)`) never
 * contain these, so the guard is false-positive-free. `^ % !` are intentionally
 * excluded: alone they only escape or expand — they cannot start a new command
 * without one of the separators below, all of which are rejected.
 */
const WIN32_SHELL_META = /[&|<>\r\n\0]/;

/**
 * Throw if any argument contains a cmd.exe command-injection metacharacter.
 * Call this ONLY on the Windows `.cmd`/`.bat` + verbatim spawn path (where the
 * args reach the shell unquoted). A no-op for safe args.
 */
export function assertSafeWin32ShellArgs(args: readonly unknown[]): void {
  for (const a of args) {
    if (typeof a === 'string' && WIN32_SHELL_META.test(a)) {
      throw new Error(
        'win32 shell spawn: argument contains a shell metacharacter ' +
          '(one of & | < > or a newline) that could enable command injection ' +
          'through the .cmd/.bat wrapper — refusing to run. Offending argument: ' +
          JSON.stringify(a),
      );
    }
  }
}
