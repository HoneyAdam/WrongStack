import * as path from 'node:path';

// Best-effort heuristic detection of *catastrophic* shell commands — NOT a
// security boundary. Static analysis of shell strings is inherently defeatable
// by obfuscation: env-variable indirection (`$RM -rf /`), quote-splitting
// (`r''m`), base64/eval pipes, command substitution, and aliases all evade
// these patterns. This is one defense-in-depth layer behind the permission
// policy; treat a miss here as expected, not a hole to be plugged with
// ever-more-clever regexes.
//
// CALIBRATION: this gate fires only for *genuinely catastrophic*, effectively
// irreversible, system-/disk-/home-wide destruction — the kind that bricks the
// machine or wipes everything. Ordinary destructive-but-recoverable dev work is
// NOT gated and runs frictionlessly under YOLO: deleting a few files (even
// outside the project), `git reset --hard`, `git clean -xdf`, `DROP TABLE`,
// `chmod -R`, writing a single file outside the project, `shutdown`/`reboot`,
// `curl … | sh`. Only whole-filesystem / whole-disk / whole-home destruction
// stops to ask.
const CATASTROPHIC_PATTERNS: RegExp[] = [
  /\b(?:mkfs(?:\.[a-z0-9]+)?|mke2fs|newfs)\b/i, // make a filesystem — wipes a partition
  /\bformat\s+[A-Za-z]:/i, // format C: — wipes a Windows volume
  /\bdiskpart\b/i, // Windows partition editor
  /\bdd\b[^|]*\bof=(?:\/dev\/|\\\\[.?]\\)/i, // dd writing straight to a raw device
  />\s*\/dev\/(?:sd|hd|nvme|disk|mapper|vd)/i, // redirect into a raw block device
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, // classic fork bomb
];

// Top-level locations whose *recursive* deletion is catastrophic (the whole
// filesystem, a system directory, or the user's home). Deleting a file or a
// nested subdirectory *inside* one of these is NOT catastrophic — only the root
// directory itself.
const CATASTROPHIC_POSIX_ROOTS = new Set([
  '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/var', '/boot', '/dev',
  '/sys', '/proc', '/opt', '/root', '/home', '/srv', '/run',
  '/system', '/library', '/applications', '/users',
]);
const CATASTROPHIC_WIN_SUBDIRS = new Set([
  'windows', 'system32', 'winnt', 'program files', 'program files (x86)',
  'programdata', 'users',
]);

const SHELL_OPERATORS = new Set(['&&', '||', '|', ';', '>', '>>', '<', '2>', '2>>']);

export function getInputString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export function pathLooksInsideProject(rawPath: string, projectRoot: string | undefined): boolean {
  if (!projectRoot) return false;
  // A leading ~ is the home directory, never the project root. Without this,
  // path.resolve() treats "~/cache" as a relative path *inside* the project
  // (there is no shell tilde-expansion here), masking an escape like `rm -rf ~/cache`.
  if (rawPath === '~' || rawPath.startsWith('~/') || rawPath.startsWith('~\\')) return false;
  const resolved = path.resolve(projectRoot, rawPath);
  const relative = path.relative(projectRoot, resolved);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function tokenizeShell(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, '')) ?? [];
}

/**
 * True only when a delete TARGET is a whole-filesystem / whole-disk / whole-home
 * / system-directory wipe — the catastrophic case. A few files, a nested
 * subdirectory, or an arbitrary sibling directory outside the project are all
 * recoverable-scale and return false (frictionless under YOLO).
 */
function isCatastrophicDeleteTarget(rawTarget: string): boolean {
  const t = rawTarget.replace(/^['"]|['"]$/g, '').trim();
  if (!t) return false;
  // Wipe the current directory wholesale.
  if (t === '*' || t === '.' || t === './' || t === '.\\' || t === './*' || t === '.\\*') return true;
  // Strip a trailing `/*` / `\*` glob and any trailing separators so `/etc/`,
  // `/etc/*`, `~/`, `C:\*` collapse onto their root form. An all-separators
  // target ("/", "/*") collapses to '' → the filesystem root.
  const s = t.replace(/[\\/]\*+$/, '').replace(/[\\/]+$/, '');
  if (s === '') return true; // "/", "/*" → filesystem root
  if (s === '~' || /^\$HOME$/i.test(s) || /^%USERPROFILE%$/i.test(s)) return true; // home
  if (/^[A-Za-z]:$/.test(s)) return true; // Windows drive root: C:, C:\, C:\*
  const norm = s.toLowerCase().replace(/\\/g, '/');
  if (CATASTROPHIC_POSIX_ROOTS.has(norm)) return true; // /etc, /usr, /home, …
  const win = norm.match(/^[a-z]:\/([^/]+)$/); // C:\Windows, C:\Users, … (top level only)
  if (win?.[1] && CATASTROPHIC_WIN_SUBDIRS.has(win[1])) return true;
  return false;
}

function hasCatastrophicDelete(command: string): boolean {
  const tokens = tokenizeShell(command);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]?.toLowerCase();
    if (!token) continue;

    // POSIX rm -rf / Remove-Item -Recurse-style recursive force delete.
    if (token === 'rm') {
      const args = tokens.slice(i + 1);
      const recursiveOrForce = args.some(
        (arg) => /^-[^-]*[rf]/i.test(arg) || arg === '--recursive' || arg === '--force' || arg === '--no-preserve-root',
      );
      if (!recursiveOrForce) continue;
      const targets = args.filter((arg) => !arg.startsWith('-') && !SHELL_OPERATORS.has(arg));
      // `rm -rf` with no operand is a whole-cwd wipe intent.
      if (targets.length === 0) return true;
      if (targets.some(isCatastrophicDeleteTarget)) return true;
    }

    if (token === 'remove-item' || token === 'ri') {
      const args = tokens.slice(i + 1);
      const recursive = args.some((arg) => {
        const a = arg.toLowerCase();
        return a === '-recurse' || a === '-force';
      });
      if (!recursive) continue;
      const targets = args.filter((arg) => !arg.startsWith('-') && !SHELL_OPERATORS.has(arg));
      if (targets.some(isCatastrophicDeleteTarget)) return true;
    }

    // Windows rmdir /s and del/erase — flags use a leading slash, so a path is
    // any non-flag token (and on Windows paths use backslashes/drive letters,
    // never a leading slash).
    if (token === 'rmdir' || token === 'rd') {
      const args = tokens.slice(i + 1);
      const recursive = args.some((arg) => arg.toLowerCase() === '/s');
      if (!recursive) continue;
      const targets = args.filter((arg) => !arg.startsWith('-') && !arg.startsWith('/') && !SHELL_OPERATORS.has(arg));
      if (targets.some(isCatastrophicDeleteTarget)) return true;
    }

    if (token === 'del' || token === 'erase') {
      const args = tokens.slice(i + 1);
      const targets = args.filter((arg) => !arg.startsWith('-') && !arg.startsWith('/') && !SHELL_OPERATORS.has(arg));
      if (targets.some(isCatastrophicDeleteTarget)) return true;
    }
  }
  return false;
}

/**
 * Best-effort detection of a *catastrophic* shell command — system-/disk-/
 * home-wide, effectively irreversible destruction. `projectRoot` is accepted
 * for signature stability but is intentionally unused: catastrophic targets are
 * absolute (filesystem root, a drive root, the home directory, a system
 * directory) and so are independent of where the project lives.
 */
export function isClearlyDestructiveBashCommand(
  command: string,
  _projectRoot: string | undefined,
): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (hasCatastrophicDelete(trimmed)) return true;
  if (CATASTROPHIC_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  return false;
}
