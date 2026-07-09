/**
 * @wrongstack/webui/server — back-compat shim.
 *
 * The actual implementation moved to @wrongstack/webui-server in PR #018b
 * (see docs/backlog/2026-07-architecture-review/018-modularity-audit-and-plan.md
 * §3.1.1, option A). This file re-exports the new public surface so that
 * existing consumers — packages/cli/src/webui-server/*, the createRequire
 * path resolver in packages/cli/src/webui-server/static-serve.ts, and any
 * downstream user of `@wrongstack/webui/server` — continue to work
 * unchanged for one release.
 *
 * Will be deleted in the next minor release after consumers have migrated
 * to @wrongstack/webui-server. Track removal in the same PR that drops
 * `./server` from packages/webui/package.json.
 */
export * from '@wrongstack/webui-server';