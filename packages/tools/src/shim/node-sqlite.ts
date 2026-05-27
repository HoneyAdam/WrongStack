/**
 * Re-export from the bare specifier used by the bundled code.
 * `writer.ts` imports from 'node-sqlite-shim' so esbuild does NOT
 * apply its `node:*` → bare-specifier rewrite. This file stays
 * external (not bundled) and the `node:` protocol is preserved at
 * runtime via the re-export.
 */
export { DatabaseSync } from 'node:sqlite';
export { StatementSync, Session, constants, backup } from 'node:sqlite';