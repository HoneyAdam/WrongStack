# Architecture Health Report

**Generated:** 2026-07-21T19:53:19.570Z  
**Scope:** packages, apps; excluded: website

## Summary

| Measure | Value |
|---|---:|
| Workspace packages | 23 |
| Production source files | 1997 |
| Production source lines | 545438 |
| Test files | 1769 |
| Workspace dependency edges | 66 |
| Relative module edges | 5968 |
| Runtime module cycles | 0 |
| Type-inclusive module cycles | 20 |
| Tests without TypeScript test-project coverage | 0 |
| Tests in multiple TypeScript projects | 0 |

## Verification result

PASS — no blocking architecture-health errors.

## Workspace packages

| Package | Sources | Tests | Workspace dependencies |
|---|---:|---:|---|
| @wrongstack/acp | 28 | 26 | @wrongstack/core |
| @wrongstack/bench | 22 | 38 | @wrongstack/core |
| @wrongstack/cli | 290 | 251 | @wrongstack/acp, @wrongstack/bench, @wrongstack/core, @wrongstack/desktop, @wrongstack/kanban, @wrongstack/mcp, @wrongstack/plug-lsp, @wrongstack/plugins, @wrongstack/providers, @wrongstack/runtime, @wrongstack/sdd, @wrongstack/simpleui, @wrongstack/super-memory, @wrongstack/techstack, @wrongstack/telegram, @wrongstack/tools, @wrongstack/tui, @wrongstack/webui, @wrongstack/webui-hq, @wrongstack/webui-server |
| @wrongstack/core | 476 | 444 | @wrongstack/kanban |
| @wrongstack/desktop | 33 | 15 | @wrongstack/core, @wrongstack/webui, @wrongstack/webui-server |
| @wrongstack/kanban | 21 | 16 | — |
| @wrongstack/mcp | 23 | 20 | @wrongstack/core |
| @wrongstack/plug-lsp | 41 | 19 | @wrongstack/core, @wrongstack/tools |
| @wrongstack/plugins | 69 | 94 | @wrongstack/core, @wrongstack/tools |
| @wrongstack/providers | 47 | 37 | @wrongstack/core |
| @wrongstack/runtime | 8 | 8 | @wrongstack/core, @wrongstack/super-memory |
| @wrongstack/sdd | 26 | 25 | @wrongstack/core |
| @wrongstack/security-scanner | 14 | 20 | @wrongstack/core |
| @wrongstack/simpleui | 55 | 25 | @wrongstack/tools, @wrongstack/webui-server |
| @wrongstack/super-memory | 19 | 27 | @wrongstack/core |
| @wrongstack/techstack | 46 | 26 | @wrongstack/core, @wrongstack/tools |
| @wrongstack/telegram | 19 | 20 | @wrongstack/core |
| @wrongstack/tools | 116 | 122 | @wrongstack/core, @wrongstack/kanban |
| @wrongstack/tui | 161 | 207 | @wrongstack/core, @wrongstack/kanban, @wrongstack/runtime, @wrongstack/sdd, @wrongstack/tools |
| @wrongstack/webui | 301 | 214 | @wrongstack/core, @wrongstack/kanban, @wrongstack/tools, @wrongstack/webui-server |
| @wrongstack/webui-hq | 44 | 28 | @wrongstack/core, @wrongstack/tools, @wrongstack/webui-server |
| @wrongstack/webui-server | 137 | 87 | @wrongstack/core, @wrongstack/kanban, @wrongstack/mcp, @wrongstack/providers, @wrongstack/runtime, @wrongstack/sdd, @wrongstack/super-memory, @wrongstack/techstack, @wrongstack/tools |
| wrongstack | 1 | 0 | @wrongstack/cli |

## Module cycles

### Runtime

None.

### Type-inclusive

- packages/acp/src/registry/agents.catalog.ts ↔ packages/acp/src/registry/ensemble-registry.ts
- packages/cli/src/acp-server-agent.ts ↔ packages/cli/src/hq-server.ts ↔ packages/cli/src/hq-server/auth-state.ts ↔ packages/cli/src/hq-server/routes.ts ↔ packages/cli/src/mcp-serve.ts ↔ packages/cli/src/subcommands/handlers/acp.ts ↔ packages/cli/src/subcommands/handlers/audit.ts ↔ packages/cli/src/subcommands/handlers/auth.ts ↔ packages/cli/src/subcommands/handlers/bench.ts ↔ packages/cli/src/subcommands/handlers/chronicle.ts ↔ packages/cli/src/subcommands/handlers/diag-doctor.ts ↔ packages/cli/src/subcommands/handlers/export.ts ↔ packages/cli/src/subcommands/handlers/hq.ts ↔ packages/cli/src/subcommands/handlers/init.ts ↔ packages/cli/src/subcommands/handlers/mailbox-serve.ts ↔ packages/cli/src/subcommands/handlers/mcp.ts ↔ packages/cli/src/subcommands/handlers/modeldiag.ts ↔ packages/cli/src/subcommands/handlers/plugin-usage.ts ↔ packages/cli/src/subcommands/handlers/projects.ts ↔ packages/cli/src/subcommands/handlers/providers-models.ts ↔ packages/cli/src/subcommands/handlers/quick.ts ↔ packages/cli/src/subcommands/handlers/replay.ts ↔ packages/cli/src/subcommands/handlers/rewind.ts ↔ packages/cli/src/subcommands/handlers/sessions-config.ts ↔ packages/cli/src/subcommands/handlers/sessions-fleet.ts ↔ packages/cli/src/subcommands/handlers/tools-skills.ts ↔ packages/cli/src/subcommands/handlers/update.ts ↔ packages/cli/src/subcommands/handlers/version-help.ts ↔ packages/cli/src/subcommands/index.ts
- packages/cli/src/boot/tui-settings-adapter.ts ↔ packages/cli/src/execute-deps.ts ↔ packages/cli/src/execution.ts
- packages/cli/src/fleet/host.ts ↔ packages/cli/src/fleet/routing.ts
- packages/cli/src/slash-commands/acp.ts ↔ packages/cli/src/slash-commands/agents.ts ↔ packages/cli/src/slash-commands/audit.ts ↔ packages/cli/src/slash-commands/auth.ts ↔ packages/cli/src/slash-commands/autonomy.ts ↔ packages/cli/src/slash-commands/brain.ts ↔ packages/cli/src/slash-commands/btw.ts ↔ packages/cli/src/slash-commands/clear.ts ↔ packages/cli/src/slash-commands/codebase-reindex.ts ↔ packages/cli/src/slash-commands/collab.ts ↔ packages/cli/src/slash-commands/compact.ts ↔ packages/cli/src/slash-commands/context.ts ↔ packages/cli/src/slash-commands/coordinator.ts ↔ packages/cli/src/slash-commands/delegate.ts ↔ packages/cli/src/slash-commands/design.ts ↔ packages/cli/src/slash-commands/dev.ts ↔ packages/cli/src/slash-commands/diag-stats.ts ↔ packages/cli/src/slash-commands/doctor.ts ↔ packages/cli/src/slash-commands/enhance.ts ↔ packages/cli/src/slash-commands/ensemble.ts ↔ packages/cli/src/slash-commands/f-keys.ts ↔ packages/cli/src/slash-commands/fallback.ts ↔ packages/cli/src/slash-commands/fix.ts ↔ packages/cli/src/slash-commands/fleet.ts ↔ packages/cli/src/slash-commands/git.ts ↔ packages/cli/src/slash-commands/gitid.ts ↔ packages/cli/src/slash-commands/goal.ts ↔ packages/cli/src/slash-commands/health.ts ↔ packages/cli/src/slash-commands/help.ts ↔ packages/cli/src/slash-commands/hq.ts ↔ packages/cli/src/slash-commands/index.ts ↔ packages/cli/src/slash-commands/init.ts ↔ packages/cli/src/slash-commands/interrupt.ts ↔ packages/cli/src/slash-commands/kanban.ts ↔ packages/cli/src/slash-commands/mailbox-demo.ts ↔ packages/cli/src/slash-commands/mailbox-serve.ts ↔ packages/cli/src/slash-commands/mailbox.ts ↔ packages/cli/src/slash-commands/mcp.ts ↔ packages/cli/src/slash-commands/memory.ts ↔ packages/cli/src/slash-commands/metrics.ts ↔ packages/cli/src/slash-commands/mode.ts ↔ packages/cli/src/slash-commands/modelcaps.ts ↔ packages/cli/src/slash-commands/models.ts ↔ packages/cli/src/slash-commands/mouse.ts ↔ packages/cli/src/slash-commands/next.ts ↔ packages/cli/src/slash-commands/plan.ts ↔ packages/cli/src/slash-commands/plugin.ts ↔ packages/cli/src/slash-commands/profile.ts ↔ packages/cli/src/slash-commands/project.ts ↔ packages/cli/src/slash-commands/prune.ts ↔ packages/cli/src/slash-commands/refiner.ts ↔ packages/cli/src/slash-commands/review.ts ↔ packages/cli/src/slash-commands/sdd.ts ↔ packages/cli/src/slash-commands/sdd/project-context.ts ↔ packages/cli/src/slash-commands/sdd/spec-detection.ts ↔ packages/cli/src/slash-commands/sdd/state.ts ↔ packages/cli/src/slash-commands/sdd/task-manager.ts ↔ packages/cli/src/slash-commands/security.ts ↔ packages/cli/src/slash-commands/session.ts ↔ packages/cli/src/slash-commands/setmodel.ts ↔ packages/cli/src/slash-commands/settings.ts ↔ packages/cli/src/slash-commands/shadow.ts ↔ packages/cli/src/slash-commands/spawn-agents.ts ↔ packages/cli/src/slash-commands/suggest.ts ↔ packages/cli/src/slash-commands/supervisor.ts ↔ packages/cli/src/slash-commands/tasks.ts ↔ packages/cli/src/slash-commands/techstack.ts ↔ packages/cli/src/slash-commands/telegram-settings.ts ↔ packages/cli/src/slash-commands/telegram-setup.ts ↔ packages/cli/src/slash-commands/todos.ts ↔ packages/cli/src/slash-commands/tool.ts ↔ packages/cli/src/slash-commands/tools.ts ↔ packages/cli/src/slash-commands/tuneup.ts ↔ packages/cli/src/slash-commands/working-dir.ts ↔ packages/cli/src/slash-commands/worktree.ts ↔ packages/cli/src/slash-commands/yolo.ts
- packages/core/src/coordination/brain-telemetry.ts ↔ packages/core/src/coordination/brain.ts ↔ packages/core/src/kernel/events.ts ↔ packages/core/src/kernel/events/brain-events.ts ↔ packages/core/src/kernel/events/session-events.ts
- packages/core/src/coordination/collab-debug.ts ↔ packages/core/src/coordination/director-tools.ts ↔ packages/core/src/coordination/director.ts ↔ packages/core/src/coordination/director/director-collab.ts ↔ packages/core/src/coordination/fleet-spawn.ts
- packages/core/src/core/agent-internals.ts ↔ packages/core/src/core/agent-loop.ts ↔ packages/core/src/core/agent-response.ts ↔ packages/core/src/core/agent-tools.ts ↔ packages/core/src/core/agent-types.ts ↔ packages/core/src/core/agent.ts ↔ packages/core/src/extension/extension-points.ts ↔ packages/core/src/extension/registry.ts ↔ packages/core/src/mailbox-attach.ts ↔ packages/core/src/types/plugin.ts
- packages/core/src/core/context.ts ↔ packages/core/src/core/conversation-state.ts ↔ packages/core/src/core/run-env.ts ↔ packages/core/src/types/compactor.ts ↔ packages/core/src/types/provider.ts ↔ packages/core/src/types/session.ts ↔ packages/core/src/types/token-counter.ts ↔ packages/core/src/types/tool.ts ↔ packages/core/src/utils/context-evidence.ts ↔ packages/core/src/utils/token-estimate.ts ↔ packages/core/src/utils/tool-wire-compact.ts
- packages/core/src/hq/protocol/client.ts ↔ packages/core/src/hq/protocol/core.ts ↔ packages/core/src/hq/protocol/fleet.ts ↔ packages/core/src/hq/protocol/session.ts
- packages/core/src/index.ts ↔ packages/core/src/plugins/prompts-plugin.ts ↔ packages/core/src/plugins/skills-plugin.ts ↔ packages/core/src/plugins/sync-plugin.ts ↔ packages/core/src/tools/mcp-control.ts ↔ packages/core/src/tools/mcp-use.ts
- packages/core/src/plugins/chimera-plugin.ts ↔ packages/core/src/plugins/review-context-builder.ts
- packages/mcp/src/client.ts ↔ packages/mcp/src/tool-schema.ts ↔ packages/mcp/src/transport-base.ts ↔ packages/mcp/src/transport-sse.ts ↔ packages/mcp/src/transport-streamable.ts ↔ packages/mcp/src/transport.ts
- packages/plug-lsp/src/document-tracker.ts ↔ packages/plug-lsp/src/registry.ts
- packages/super-memory/src/middleware/tool-call-memory.ts ↔ packages/super-memory/src/middleware/turn-memory.ts
- packages/techstack/src/adapters/interface.ts ↔ packages/techstack/src/adapters/paths.ts
- packages/tui/src/app-props.ts ↔ packages/tui/src/app.tsx ↔ packages/tui/src/components/agents-monitor.tsx ↔ packages/tui/src/components/coordinator-panel.tsx ↔ packages/tui/src/components/fleet-monitor.tsx ↔ packages/tui/src/components/fleet-panel.tsx ↔ packages/tui/src/components/resume-picker.tsx ↔ packages/tui/src/hooks/use-queue-manager.ts ↔ packages/tui/src/queue-slash.ts
- packages/tui/src/components/brain-panel-model.ts ↔ packages/tui/src/components/brain-panel.tsx
- packages/tui/src/components/status-bar-chips.tsx ↔ packages/tui/src/components/status-bar.tsx
- packages/webui/src/components/SettingsPanel/MCPSection.tsx ↔ packages/webui/src/components/SettingsPanel/official-servers.ts

## Largest production files

| Lines | File |
|---:|---|
| 7672 | `packages/tui/src/app.tsx` |
| 3772 | `packages/super-memory/src/store.ts` |
| 3202 | `packages/webui/src/types.ts` |
| 2675 | `packages/cli/src/cli-main.ts` |
| 2549 | `packages/webui/src/components/KanbanView.tsx` |
| 2533 | `packages/tui/src/app-reducer.ts` |
| 2313 | `packages/webui/src/components/CodeMap.tsx` |
| 2301 | `packages/tui/src/components/history/utils.tsx` |
| 2230 | `packages/cli/src/fleet/host.ts` |
| 2196 | `packages/core/src/coordination/director.ts` |
| 2013 | `packages/core/src/coordination/director-tools.ts` |
| 1973 | `packages/super-memory/src/sqlite-store.ts` |
| 1940 | `packages/core/src/storage/session-store.ts` |
| 1872 | `packages/core/src/types/config.ts` |
| 1854 | `packages/tools/src/codebase-index/writer.ts` |
| 1798 | `packages/cli/src/slash-commands/memory.ts` |
| 1793 | `packages/cli/src/execution.ts` |
| 1744 | `packages/core/src/coordination/global-mailbox.ts` |
| 1729 | `packages/tui/src/input-validation.ts` |
| 1704 | `packages/tui/src/components/status-bar.tsx` |
| 1602 | `packages/tui/src/components/settings-picker.tsx` |
| 1570 | `packages/cli/src/repl.ts` |
| 1566 | `packages/webui/src/components/OfficeMapCanvas.tsx` |
| 1555 | `packages/core/src/tools/fallback-manage-tools.ts` |
| 1539 | `packages/webui/src/components/AgentOfficeView.tsx` |
| 1517 | `packages/webui/src/components/SetupScreen.tsx` |
| 1515 | `packages/tui/src/app-state.ts` |
| 1477 | `packages/core/src/storage/config-loader.ts` |
| 1473 | `packages/acp/src/client/acp-session.ts` |
| 1455 | `packages/webui-server/src/server/setup-events.ts` |
| 1454 | `packages/core/src/execution/tool-executor.ts` |
| 1420 | `packages/tools/src/kanban.ts` |
| 1407 | `packages/cli/src/hq-server/routes.ts` |
| 1402 | `packages/tui/src/run-tui.ts` |
| 1400 | `packages/cli/src/subcommands/handlers/per-subcommand-help.ts` |
| 1380 | `packages/webui/src/components/ChatInput.tsx` |
| 1349 | `packages/core/src/core/system-prompt-builder.ts` |
| 1314 | `packages/kanban/src/manager/_internal.ts` |
| 1306 | `packages/cli/src/slash-commands/sdd.ts` |
| 1306 | `packages/sdd/src/sdd-parallel-run.ts` |
| 1283 | `packages/mcp/src/registry.ts` |
| 1272 | `packages/core/src/coordination/multi-agent-coordinator.ts` |
| 1270 | `packages/cli/src/slash-commands/kanban.ts` |
| 1264 | `packages/cli/src/webui-server.ts` |
| 1241 | `apps/desktop/src/renderer/src/renderer.ts` |
| 1220 | `packages/webui/src/lib/ws-client.ts` |
| 1202 | `packages/webui/src/components/SettingsPanel/index.tsx` |
| 1198 | `packages/core/src/execution/compaction-core.ts` |
| 1188 | `packages/cli/src/picker.ts` |
| 1184 | `packages/cli/src/plugin-management.ts` |

## TypeScript test coverage debt

- 0 test files are not included in a package TypeScript test project.
- 0 test files are included in more than one package TypeScript project.

> This report is generated. Change architecture registry inputs or source code, then regenerate it; do not hand-edit measurements.
