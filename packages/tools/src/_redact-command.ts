import { expectDefined } from '@wrongstack/core';

// Sensitive CLI flag patterns that may appear in process command lines.
// Redacted to [REDACTED] so crash dumps /ps output cannot leak secrets.
// Split out of process-registry.ts so entries that only need the registry
// (e.g. ps-slash) don't carry this module's dependencies.
const SENSITIVE_FLAG_PATTERNS: RegExp[] = [
  // --flag=value  or  --flag "value"  (value captured up to next space or comma)
  /--(?:token|password|passwd|pwd|secret|api[-_]?key|api[-_]?secret|auth|credential|private[-_]?key|access[-_]?key|github[-_]?token|gh[-_]?token|bearer|jwt|oauth|pin|pincode|passphrase|access[-_]?token)(?:[=\s,][^\s]*)?/gi,
  // -f "value" style short flags
  /(?<!\w)-t(?:\s+|\s*=\s*)[^\s,]+/,
  /(?<!\w)-(?:p|password)(?:\s+|\s*=\s*)[^\s,]+/gi,
  // env var–style secrets: TOKEN=x, API_KEY=y, etc.
  /(?:TOKEN|API_KEY|API_SECRET|AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN|BEARER|JWT|OAUTH|CREDENTIAL|SECRET|PRIVATE_KEY|PASSWORD|PASSWD)\s*[=:]\s*[^\s,]+/gi,
  // Generic high-entropy look: base64 strings >32 chars or hex strings >32 digits — but only
  // when preceded by a flag name (e.g. --github-token=EyJ...).
  /--\w*(?:token|key|secret|password|passwd|auth|credential)\w*[=\s,][A-Za-z0-9+/=]{32,}/,
];

/**
 * Returns a display-safe copy of `cmd` with sensitive flag values replaced by [REDACTED].
 * The original string is unchanged; this is pure and has no side effects.
 */
export function redactCommand(cmd: string): string {
  let result = cmd;
  for (const pattern of SENSITIVE_FLAG_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // Preserve the flag name portion; redact only the value part.
      // e.g. "--token=sekrit_abc"  →  "--token=[REDACTED]"
      const eq = match.indexOf('=');
      const sp = match.search(/\s/);
      const delim = eq !== -1 ? '=' : sp !== -1 ? match[sp] : null;
      if (delim !== null) {
        const flag = match.slice(0, match.indexOf(expectDefined(delim)) + 1);
        return `${flag}[REDACTED]`;
      }
      // Nothing delimitable found; replace the whole token silently.
      // Short flags like -tVALUE are replaced entirely to avoid edge cases.
      const flagEnd = match.match(/^--?[a-zA-Z][a-zA-Z0-9_-]*/)?.[0] ?? match;
      return `${flagEnd}=**redacted**`;
    });
  }
  return result;
}
