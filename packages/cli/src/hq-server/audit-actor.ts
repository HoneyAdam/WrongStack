import * as os from 'node:os';

/** Build the non-secret actor label used by HQ authentication audit entries. */
export function resolveAuditActor(): string {
  const user = (process.env.USERNAME ?? process.env.USER ?? '').toString();
  try {
    const host = os.hostname();
    return user ? `${user}@${host}` : `cli@${host}`;
  } catch {
    return user ? `${user}@unknown` : 'cli';
  }
}
