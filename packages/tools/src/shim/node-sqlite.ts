// Re-export from node:sqlite so the bundled code (which imports from 'node-sqlite-shim'
// to avoid esbuild rewriting node:sqlite → sqlite) can use the shim at runtime.
export type { DatabaseSync, StatementSync, Session } from 'node:sqlite';
export { constants, backup } from 'node:sqlite';