# Architecture Health Report

**Generated:** 2026-07-22T10:08:16.164Z
**Scope:** packages, apps; excluded: website

## Summary

| Measure | Value |
|---|---:|
| Workspace packages | 24 |
| Production source files | 2104 |
| Production source lines | 555501 |
| Test files | 1789 |
| Workspace dependency edges | 72 |
| Relative module edges | 6253 |
| Non-command slash imports | 0 |
| Runtime module cycles | 0 |
| Type-inclusive module cycles | 15 |
| Tests without TypeScript test-project coverage | 0 |
| Tests in multiple TypeScript projects | 0 |

## Verification result

PASS — no blocking architecture-health errors.

## Workspace packages

| Package | Sources | Tests | Workspace dependencies |
|---|---:|---:|---|
| @wrongstack/acp | 32 | 27 | @wrongstack/core |
| @wrongstack/bench | 22 | 38 | @wrongstack/core |
| @wrongstack/cli | 313 | 253 | @wrongstack/acp, @wrongstack/bench, @wrongstack/core, @wrongstack/desktop, @wrongstack/kanban, @wrongstack/mcp, @wrongstack/plug-lsp, @wrongstack/plugins, @wrongstack/providers, @wrongstack/runtime, @wrongstack/sdd, @wrongstack/security-scanner, @wrongstack/simpleui, @wrongstack/super-memory, @wrongstack/techstack, @wrongstack/telegram, @wrongstack/tools, @wrongstack/tui, @wrongstack/webui, @wrongstack/webui-hq, @wrongstack/webui-server |
| @wrongstack/core | 491 | 448 | @wrongstack/kanban, @wrongstack/persistence |
| @wrongstack/desktop | 33 | 15 | @wrongstack/core, @wrongstack/webui, @wrongstack/webui-server |
| @wrongstack/kanban | 21 | 16 | @wrongstack/persistence |
| @wrongstack/mcp | 23 | 20 | @wrongstack/core |
| @wrongstack/persistence | 2 | 1 | — |
| @wrongstack/plug-lsp | 41 | 19 | @wrongstack/core, @wrongstack/tools |
| @wrongstack/plugins | 73 | 94 | @wrongstack/core, @wrongstack/tools |
| @wrongstack/providers | 50 | 39 | @wrongstack/core |
| @wrongstack/runtime | 9 | 10 | @wrongstack/core, @wrongstack/super-memory, @wrongstack/tools |
| @wrongstack/sdd | 26 | 25 | @wrongstack/core |
| @wrongstack/security-scanner | 15 | 20 | @wrongstack/core |
| @wrongstack/simpleui | 57 | 26 | @wrongstack/tools, @wrongstack/webui-server |
| @wrongstack/super-memory | 24 | 28 | @wrongstack/core |
| @wrongstack/techstack | 46 | 26 | @wrongstack/core, @wrongstack/tools |
| @wrongstack/telegram | 19 | 20 | @wrongstack/core |
| @wrongstack/tools | 117 | 122 | @wrongstack/core, @wrongstack/kanban |
| @wrongstack/tui | 204 | 210 | @wrongstack/core, @wrongstack/kanban, @wrongstack/runtime, @wrongstack/sdd, @wrongstack/super-memory, @wrongstack/tools |
| @wrongstack/webui | 302 | 216 | @wrongstack/core, @wrongstack/kanban, @wrongstack/providers, @wrongstack/tools, @wrongstack/webui-server |
| @wrongstack/webui-hq | 44 | 28 | @wrongstack/core, @wrongstack/tools, @wrongstack/webui-server |
| @wrongstack/webui-server | 139 | 88 | @wrongstack/core, @wrongstack/kanban, @wrongstack/mcp, @wrongstack/providers, @wrongstack/runtime, @wrongstack/sdd, @wrongstack/super-memory, @wrongstack/techstack, @wrongstack/tools |
| wrongstack | 1 | 0 | @wrongstack/cli |

## Module cycles

### Runtime

None.

### Type-inclusive

- packages/acp/src/registry/agents.catalog.ts ↔ packages/acp/src/registry/ensemble-registry.ts
- packages/cli/src/acp-server-agent.ts ↔ packages/cli/src/hq-server.ts ↔ packages/cli/src/hq-server/routes.ts ↔ packages/cli/src/mcp-serve.ts ↔ packages/cli/src/subcommands/handlers/acp.ts ↔ packages/cli/src/subcommands/handlers/audit.ts ↔ packages/cli/src/subcommands/handlers/auth.ts ↔ packages/cli/src/subcommands/handlers/bench.ts ↔ packages/cli/src/subcommands/handlers/chronicle.ts ↔ packages/cli/src/subcommands/handlers/diag-doctor.ts ↔ packages/cli/src/subcommands/handlers/export.ts ↔ packages/cli/src/subcommands/handlers/hq.ts ↔ packages/cli/src/subcommands/handlers/init.ts ↔ packages/cli/src/subcommands/handlers/mailbox-serve.ts ↔ packages/cli/src/subcommands/handlers/mcp.ts ↔ packages/cli/src/subcommands/handlers/modeldiag.ts ↔ packages/cli/src/subcommands/handlers/plugin-usage.ts ↔ packages/cli/src/subcommands/handlers/projects.ts ↔ packages/cli/src/subcommands/handlers/providers-models.ts ↔ packages/cli/src/subcommands/handlers/quick.ts ↔ packages/cli/src/subcommands/handlers/replay.ts ↔ packages/cli/src/subcommands/handlers/rewind.ts ↔ packages/cli/src/subcommands/handlers/sessions-config.ts ↔ packages/cli/src/subcommands/handlers/sessions-fleet.ts ↔ packages/cli/src/subcommands/handlers/tools-skills.ts ↔ packages/cli/src/subcommands/handlers/update.ts ↔ packages/cli/src/subcommands/handlers/version-help.ts ↔ packages/cli/src/subcommands/index.ts
- packages/cli/src/boot/tui-settings-adapter.ts ↔ packages/cli/src/execute-deps.ts ↔ packages/cli/src/execution.ts
- packages/cli/src/fleet/host.ts ↔ packages/cli/src/fleet/routing.ts
- packages/core/src/coordination/brain-telemetry.ts ↔ packages/core/src/coordination/brain.ts ↔ packages/core/src/kernel/events.ts ↔ packages/core/src/kernel/events/brain-events.ts ↔ packages/core/src/kernel/events/session-events.ts
- packages/core/src/core/agent-internals.ts ↔ packages/core/src/core/agent-loop.ts ↔ packages/core/src/core/agent-response.ts ↔ packages/core/src/core/agent-tools.ts ↔ packages/core/src/core/agent-types.ts ↔ packages/core/src/core/agent.ts ↔ packages/core/src/extension/extension-points.ts ↔ packages/core/src/extension/registry.ts ↔ packages/core/src/mailbox-attach.ts ↔ packages/core/src/types/plugin.ts
- packages/core/src/core/context.ts ↔ packages/core/src/core/conversation-state.ts ↔ packages/core/src/core/run-env.ts ↔ packages/core/src/types/compactor.ts ↔ packages/core/src/types/provider.ts ↔ packages/core/src/types/session.ts ↔ packages/core/src/types/token-counter.ts ↔ packages/core/src/types/tool.ts ↔ packages/core/src/utils/context-evidence.ts ↔ packages/core/src/utils/token-estimate.ts ↔ packages/core/src/utils/tool-wire-compact.ts
- packages/core/src/hq/protocol/client.ts ↔ packages/core/src/hq/protocol/core.ts ↔ packages/core/src/hq/protocol/fleet.ts ↔ packages/core/src/hq/protocol/session.ts
- packages/core/src/index.ts ↔ packages/core/src/plugins/prompts-plugin.ts ↔ packages/core/src/plugins/skills-plugin.ts ↔ packages/core/src/plugins/sync-plugin.ts ↔ packages/core/src/tools/mcp-control.ts ↔ packages/core/src/tools/mcp-use.ts
- packages/core/src/plugins/chimera-plugin.ts ↔ packages/core/src/plugins/review-context-builder.ts
- packages/mcp/src/client.ts ↔ packages/mcp/src/tool-schema.ts ↔ packages/mcp/src/transport-base.ts ↔ packages/mcp/src/transport-sse.ts ↔ packages/mcp/src/transport-streamable.ts ↔ packages/mcp/src/transport.ts
- packages/plug-lsp/src/document-tracker.ts ↔ packages/plug-lsp/src/registry.ts
- packages/techstack/src/adapters/interface.ts ↔ packages/techstack/src/adapters/paths.ts
- packages/tui/src/components/status-bar-chips.tsx ↔ packages/tui/src/components/status-bar.tsx
- packages/webui/src/components/SettingsPanel/MCPSection.tsx ↔ packages/webui/src/components/SettingsPanel/official-servers.ts

## Largest production files

| Lines | File |
|---:|---|
| 3777 | `packages/super-memory/src/store.ts` |
| 3305 | `packages/webui/src/types.ts` |
| 2549 | `packages/webui/src/components/KanbanView.tsx` |
| 2479 | `packages/super-memory/src/sqlite-store.ts` |
| 2313 | `packages/webui/src/components/CodeMap.tsx` |
| 2301 | `packages/tui/src/components/history/utils.tsx` |
| 2279 | `packages/cli/src/fleet/host.ts` |
| 2034 | `packages/core/src/coordination/director-tools.ts` |
| 1948 | `packages/core/src/storage/session-store.ts` |
| 1872 | `packages/core/src/types/config.ts` |
| 1854 | `packages/tools/src/codebase-index/writer.ts` |
| 1783 | `packages/cli/src/execution.ts` |
| 1765 | `packages/cli/src/slash-commands/memory.ts` |
| 1753 | `packages/core/src/coordination/global-mailbox.ts` |
| 1730 | `packages/tui/src/input-validation.ts` |
| 1705 | `packages/core/src/coordination/director.ts` |
| 1705 | `packages/tui/src/components/status-bar.tsx` |
| 1602 | `packages/tui/src/components/settings-picker.tsx` |
| 1579 | `packages/core/src/storage/config-loader.ts` |
| 1569 | `packages/webui/src/components/OfficeMapCanvas.tsx` |
| 1555 | `packages/cli/src/repl.ts` |
| 1555 | `packages/core/src/tools/fallback-manage-tools.ts` |
| 1545 | `packages/webui/src/components/AgentOfficeView.tsx` |
| 1508 | `packages/tui/src/app-state.ts` |
| 1483 | `packages/acp/src/client/acp-session.ts` |
| 1455 | `packages/webui-server/src/server/setup-events.ts` |
| 1454 | `packages/core/src/execution/tool-executor.ts` |
| 1445 | `packages/tui/src/app.tsx` |
| 1433 | `packages/tui/src/run-tui.ts` |
| 1421 | `packages/tools/src/kanban.ts` |
| 1400 | `packages/cli/src/subcommands/handlers/per-subcommand-help.ts` |
| 1394 | `packages/cli/src/hq-server/routes.ts` |
| 1380 | `packages/webui/src/components/ChatInput.tsx` |
| 1366 | `packages/webui/src/components/SetupScreen.tsx` |
| 1349 | `packages/core/src/core/system-prompt-builder.ts` |
| 1314 | `packages/kanban/src/manager/_internal.ts` |
| 1312 | `packages/cli/src/slash-commands/sdd.ts` |
| 1305 | `packages/sdd/src/sdd-parallel-run.ts` |
| 1285 | `packages/mcp/src/registry.ts` |
| 1272 | `packages/core/src/coordination/multi-agent-coordinator.ts` |
| 1271 | `packages/cli/src/slash-commands/kanban.ts` |
| 1249 | `packages/cli/src/webui-server.ts` |
| 1241 | `apps/desktop/src/renderer/src/renderer.ts` |
| 1231 | `packages/webui/src/lib/ws-client.ts` |
| 1202 | `packages/webui/src/components/SettingsPanel/index.tsx` |
| 1198 | `packages/core/src/execution/compaction-core.ts` |
| 1181 | `packages/cli/src/picker.ts` |
| 1181 | `packages/cli/src/subcommands/handlers/modeldiag.ts` |
| 1179 | `packages/cli/src/cli-main.ts` |
| 1175 | `packages/core/src/core/agent-loop.ts` |

## TypeScript test coverage debt

- 0 test files are not included in a package TypeScript test project.
- 0 test files are included in more than one package TypeScript project.

> This report is generated. Change architecture registry inputs or source code, then regenerate it; do not hand-edit measurements.
