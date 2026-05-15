import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);

function readOwnVersion(): string {
  const candidates = ['../package.json', '../../package.json'];
  for (const rel of candidates) {
    try {
      const pkg = req(rel) as { version?: unknown };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
    } catch {
      // try next
    }
  }
  return 'dev';
}

export const CLI_VERSION = readOwnVersion();

let API_VERSION = '0.0.0';
try {
  const corePkg = req('@wrongstack/core/package.json') as { wrongstackApiVersion?: string };
  if (corePkg.wrongstackApiVersion) API_VERSION = corePkg.wrongstackApiVersion;
} catch {
  /* fallback */
}

export { API_VERSION };
