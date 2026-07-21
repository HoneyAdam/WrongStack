import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function readPackageVersion(): string {
  try {
    const packageJson = require('../package.json') as { version?: unknown };
    if (typeof packageJson.version === 'string' && packageJson.version.length > 0) {
      return packageJson.version;
    }
  } catch {
    // Source-only or embedded builds may not ship package metadata.
  }
  return 'dev';
}

export const ACP_PACKAGE_VERSION = readPackageVersion();
