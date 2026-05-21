/**
 * Build a sanitized child-process environment.
 *
 * The bash/exec tools and MCP stdio transports execute LLM-generated or
 * configured commands. The parent process carries provider API keys
 * (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...), VCS tokens (GITHUB_TOKEN),
 * and cloud credentials. Forwarding those to a child is an exfiltration
 * vector even with `permission: 'confirm'` — a compromised MCP server
 * or a cleverly composed shell pipeline can leak secrets.
 *
 * Strategy: copy a small, explicit allowlist of variables that real builds
 * need, then copy anything else that does NOT look secret-bearing. This
 * preserves user-friendly behavior (locale, terminal, npm config) while
 * blocking the obvious leak channels.
 *
 * Override with `WRONGSTACK_CHILD_ENV_PASSTHROUGH=1` to forward the full
 * parent environment unchanged (opt-in for advanced users who understand
 * the risk).
 */

const ALLOWED_KEYS = new Set<string>([
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PWD',
  'OLDPWD',
  'COMSPEC',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'PUBLIC',
  'PATHEXT',
]);

// Substring match against env-var names (case-insensitive). Bias toward
// false-positives — a missing var is recoverable, an exfiltrated key is not.
// Only consulted for vars NOT on the curated allowlist; PWD/PASSWD-style
// false positives there are avoided by checking allowlist first.
const SECRET_NAME_PARTS = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'AUTH',
  'CRED',
  'BEARER',
  'COOKIE',
  'PRIVATE',
];

function looksSecret(name: string): boolean {
  const upper = name.toUpperCase();
  for (const p of SECRET_NAME_PARTS) {
    if (upper.includes(p)) return true;
  }
  // KEY is tricky — PUBLIC_KEY is fine to forward but most _KEY vars are
  // secrets. Require word boundary so KEYBOARD_LAYOUT etc. are not flagged.
  if (/(?:^|_)KEY(?:$|_|S$)/i.test(upper)) return true;
  if (/API[_-]?KEY/i.test(upper)) return true;
  if (/ACCESS[_-]?KEY/i.test(upper)) return true;
  if (/SESSION[_-]?ID/i.test(upper) === false && /SESSION/i.test(upper)) {
    // SESSION_ID is metadata (we set our own); other SESSION_* often holds
    // session cookies. Be conservative.
    return true;
  }
  return false;
}

export interface BuildChildEnvOptions {
  /** Session ID to inject as WRONGSTACK_SESSION_ID. */
  sessionId?: string;
  /** Additional env vars to merge (takes priority over filtered parent env). */
  extra?: NodeJS.ProcessEnv;
}

/**
 * Build a filtered child-process environment suitable for bash, exec, and
 * MCP server subprocesses. Strips API keys, tokens, and other credentials
 * while preserving system/tooling variables.
 */
export function buildChildEnv(optsOrSessionId?: BuildChildEnvOptions | string): NodeJS.ProcessEnv {
  const opts: BuildChildEnvOptions =
    typeof optsOrSessionId === 'string'
      ? { sessionId: optsOrSessionId }
      : (optsOrSessionId ?? {});

  const passthrough = process.env['WRONGSTACK_CHILD_ENV_PASSTHROUGH'] === '1'
    || process.env['WRONGSTACK_BASH_ENV_PASSTHROUGH'] === '1' // legacy alias
  ;
  if (passthrough && !process.env['CI']) {
    console.warn(
      '[WrongStack] WARNING: WRONGSTACK_*_ENV_PASSTHROUGH=1 is active —\n' +
      '  all parent env vars (including API keys) forwarded to child processes.\n' +
      '  Do not use on shared or multi-tenant systems.'
    );
  }
  const out: NodeJS.ProcessEnv = {};

  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (passthrough) {
      out[k] = v;
      continue;
    }
    const upper = k.toUpperCase();
    // 1. Forward names on the explicit allowlist — these are well-known
    //    non-secret system variables (PATH, HOME, LANG, ...).
    if (ALLOWED_KEYS.has(upper)) {
      out[k] = v;
      continue;
    }
    // 2. Strip anything that looks like a secret.
    if (looksSecret(upper)) continue;
    // 3. Forward tooling-prefixed vars that builds commonly need, unless
    //    they already failed the secret check above.
    if (
      upper.startsWith('NODE_') ||
      upper.startsWith('NPM_') ||
      upper.startsWith('PNPM_') ||
      upper.startsWith('YARN_') ||
      upper.startsWith('GIT_') ||
      upper.startsWith('CI') ||
      upper.startsWith('XDG_') ||
      upper === 'EDITOR' ||
      upper === 'VISUAL' ||
      upper === 'PAGER'
    ) {
      out[k] = v;
    }
  }

  // Merge explicit extras after filtering (these are intentionally passed,
  // e.g. MCP server-specific tokens the user accepted in config).
  if (opts.extra) {
    Object.assign(out, opts.extra);
  }

  if (opts.sessionId) out['WRONGSTACK_SESSION_ID'] = opts.sessionId;
  return out;
}
