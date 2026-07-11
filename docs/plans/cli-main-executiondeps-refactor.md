# CLI Boot Wiring & ExecutionDeps Refactor Plan

**Status:** Complete (2026-07-11)
**Target files:** `packages/cli/src/cli-main.ts` (2414 lines), `packages/cli/src/execution.ts` (1438 lines)
**Goal:** Break the "kitchen sink" `ExecutionDeps` (~80 fields) into focused interfaces and extract remaining inline wiring from `main()` into dedicated modules.

Implementation note: the final composition root constructs the grouped `ExecuteDeps` shape directly and passes it through the typed `toExecuteDeps()` boundary. The earlier mutable `WireContext` prototype was removed because it duplicated every field and required unsafe casts. Shared controllers are created by `wiring/controllers.ts`; coverage lives in `tests/wiring-controllers.test.ts`.

---

## Problem statement

`cli-main.ts`'s `main()` function is the orchestrator that wires every subsystem before calling `execute()`. While the Issue #29 refactor (PRs 0–7) extracted many boot phases into `packages/cli/src/boot/`, the wiring phase remains a single ~300-line block that:

1. Resolves container singletons
2. Assembles state from 15+ `wiring/` module calls (each returning 2–8 values)
3. Builds the `ExecutionDeps` object with ~80 fields of varying concerns

This makes:
- **Adding a new dependency** require edits in 3+ places (wiring call, destructuring, ExecutionDeps field, execute() parameter destructuring)
- **Testing in isolation** impossible — any test of `execute()` must mock the entire 80-field interface
- **Understanding the flow** require reading through 300+ lines of variable plumbing

---

## Proposed architecture

### Phase 1: Break `ExecutionDeps` into focused sub-interfaces

```typescript
// Before: monolithic ExecutionDeps ~80 fields
function execute(deps: ExecutionDeps): Promise<number>;

// After: composed from focused sub-interfaces
function execute(deps: ExecuteDeps): Promise<number>;

interface ExecuteDeps {
  core: CoreDeps;
  session: SessionDeps;
  provider: ProviderDeps;
  ui: UiDeps;
  fleet?: FleetDeps;
  controllers: ControllerDeps;
  lifecycles: LifecycleDeps;  // ← optional callbacks, default no-op
}
```

#### Proposed sub-interfaces

**1. `CoreDeps`** — always-required runtime essentials
```
agent: Agent
events: EventBus
config: Config
configStore: ConfigStore
wpaths: WstackPaths
projectRoot: string
cwd: string
flags: Record<string, string | boolean>
positional: string[]
tokenCounter: TokenCounter
recoveryLock: RecoveryLock
```

**2. `SessionDeps`** — session + state stores
```
session: SessionWriter
context: Context
attachments: AttachmentStore
queueStore: QueueStore
sessionStore: SessionStore
memoryStore: MemoryStore
modeStore: ModeStore
slashRegistry: SlashCommandRegistry
detachTodosCheckpoint?: () => void | Promise<void>
needsSetup?: boolean
restoredMessages?: Message[]
restoredToolCalls?: RestoredToolCall[]
```

**3. `ProviderDeps`** — provider/model selection + switching
```
modelsRegistry: ModelsRegistry
savedProviderCfg?: ProviderConfig
resolvedProvider?: ResolvedProvider
getPickableProviders: () => Promise<Array<...>>
switchProviderAndModel: (providerId, modelId) => string | null | Promise<string | null>
onModelContextResolved?: (providerId, modelId, maxContext) => void
mcpRegistry: MCPRegistry
mailbox: GlobalMailbox
```

**4. `UiDeps`** — I/O surface
```
renderer: TerminalRenderer
reader: ReadlineInputReader
stats: SessionStats
effectiveMaxContext: number
getEffectiveMaxContext?: () => number | undefined
```

**5. `FleetDeps`** — director + multi-agent
```
director: Director | null
getDirector?: () => Director | null
sddSubagentFactory?: AgentFactory | undefined
fleetRoster?: Record<string, { name: string }>
fleetStreamController?: FleetStreamController
agentsMonitorController?: AgentsMonitorController
```

**6. `ControllerDeps`** — shared mutable controllers
```
interruptController: InterruptController
enhanceController: EnhanceController
coordinatorController?: CoordinatorController
hqCommandController?: HqCommandController
yoloController: YoloController
autonomyController: AutonomyController
```

**7. `PickerDeps`** — settings/plugin/mcp/tool pickers
```
getPluginItems: () => PluginPickerItem[]
onPluginToggle: (name) => Promise<PickerResult>
getMcpServers: () => McpPickerItem[]
onMcpToggle: (name) => Promise<PickerResult>
onMcpRestart: (name) => Promise<PickerResult>
getToolsItems: () => ToolPickerItem[]
onToolToggle: (name) => Promise<PickerResult>
getBrainData: () => BrainData
onBrainRiskLevel: (level) => string | undefined
onShadowStart?: () => Promise<string | undefined>
onShadowStop?: () => Promise<string | undefined>
authHost?: AuthPanelHost
```

**8. `LifecycleDeps`** — eternal/SDD/autonomy lifecycle callbacks
```
getEternalEngine: () => EternalAutonomyEngine | null
getParallelEngine: () => ParallelEternalEngine | null
getSddRun: () => SddRunControl | null
onSddLifecycle: (op, opts?) => Promise<LifecycleResult>
subscribeEternalIteration: (fn) => () => void
subscribeEternalStage: (fn) => () => void
onCountdownTick?: (remaining) => boolean | void
onSuggestionsParsed?: (suggestions) => void
getSuggestions?: () => string[]
onValidateAutoProceed?: (suggestion, lastOutput) => Promise<boolean>
onDestroy?: () => void
onCoordinatorStop?: () => void
```

### Phase 2: Extract remaining inline wiring from `main()` into `wiring/`

Currently `main()` still has inline blocks that were NOT extracted during PR 0–7:

| Block | Lines | Extract to | Reason |
|---|---|---|---|
| Mode resolution + SystemPromptBuilder binding | 141–206 | Already extracted? | `resolveModeAndCapabilities()` exists, but the binding of SystemPromptBuilder is inline |
| Tool registry creation | 208–222 | Already extracted | `registerBuiltinTools()` in `boot/tool-registry.ts` |
| Metrics + health registry | 225–234 | Keep as is | Already in `wiring/metrics.ts` |
| Event wiring | 265–275 | Already extracted | `wireEventWiring()` in `boot/event-wiring.ts` |
| System prompt building | 277–305 | Extract to `wiring/system-prompt.ts` | Builds the prompt from promptBuilder + online agents |
| Session + context | 307–334 | Already extracted | `setupSession()` in `wiring/session.ts` |
| Memory store trace ID | 336–342 | Move into `wiring/session.ts` | Related to session setup |
| Session registry + agent tracker | 344–432 | Extract to `wiring/session-registry.ts` | Cross-process session registration + git branch detection |
| Shutdown handler | 404–410 | Keep as is | `createGracefulShutdown()` already extracted |
| Session stats | 438 | Keep as is | `new SessionStats(events, tokenCounter)` |
| Lifecycle/plugins | 467–537 | Already extracted | `setupLifecycleAndPlugins()` in `wiring/lifecycle-plugins.ts` |
| Dep-watcher | 507–537 | Already extracted | `setupDepWatcherConsumers()` in `wiring/dep-watcher.ts` |
| Provider runtime | 539–593 | Already extracted | `setupProviderRuntime()` in `wiring/provider-runtime-setup.ts` |
| Brain + orchestration | 594–754 | Already extracted | `setupBrainAndOrchestration()` in `wiring/brain-and-orchestration.ts` |
| Director + autonomy | 754–... | Already extracted | `setupDirectorAndAutonomy()` in `wiring/director-setup.ts` |
| Shared controllers (interrupt/enhance/yolo) | ~700–900 | Extract to `wiring/controllers.ts` | All small inline controller objects |
| Slash registry + command factory | ~1900–1943 | Already extracted | `buildBuiltinSlashCommands()` |
| Eternal flag handling | 1945–1969 | Keep as is | One-shot launch before execute |
| Codebase indexing | 1971–1981 | Already extracted | `setupCodebaseIndexing()` |
| Plugin picker items | ~1986–2039 | Move to `wiring/plugin-picker.ts` or keep in place | Used only for the execute() call |
| Final execute() call | 2041–2408 | Keep as is | Terminal dispatch point |

**Key observation:** Most wiring IS already extracted. What remains is:
1. The **orchestration** of calling all those `wiring/` modules and collecting their return values
2. The **inline controller objects** (interruptController, enhanceController, yoloController, etc.)
3. The **huge `ExecutionDeps` assembly** at the call site

### Phase 3: Introduce `WireContext` — the wiring state bag

Replace the current pattern of:
```typescript
let { a, b, c } = await wireA({...});
let { d, e, f } = await wireB({...});
```

With:
```typescript
const ctx = new WireContext(config, container);
await wireSession(ctx);
await wireProviders(ctx);
await wireFleet(ctx);
// ctx now has ctx.session, ctx.provider, ctx.fleet, etc.
return execute(buildExecuteDeps(ctx));
```

This eliminates the 15+ destructuring lines and makes the wiring order explicit.

---

## Migration plan

### Step 1 — Sub-interfaces (minimal risk, pure refactor)
1. Define the sub-interfaces in a new file `packages/cli/src/execute-deps.ts`
2. Build `ExecuteDeps` in `main()` using the sub-interfaces
3. Destructure in `execute()` using the sub-interfaces
4. **No behavior change** — just reorganization

### Step 2 — Inline controller extraction (mechanical)
1. Extract `InterruptController`, `EnhanceController`, `YoloController`, etc. into `wiring/controllers.ts`
2. Each returns one controller instead of mutating inline variables
3. **No behavior change** — same setters, same defaults

### Step 3 — WireContext (larger change)
1. Create `wiring/wire-context.ts` with the `WireContext` class
2. Migrate each `wiring/<module>.ts` to accept/return `WireContext`
3. Collapse the variable plumbing in `main()`
4. **Behavior change risk**: must verify all refs stay in sync — requires careful review

### Step 4 — Picker deps consolidation
1. Group all `getXItems`/`onXToggle` callbacks into a `PickerDeps` object
2. Extract inline lambdas from `main()` into focused functions
3. **Low risk** — purely structural

---

## Verification

Each step:
1. `pnpm --filter @wrongstack/cli exec tsc --noEmit` — typecheck
2. `pnpm --filter @wrongstack/cli exec vitest run` — existing tests pass
3. Manual smoke test: `wstack help`, `wstack --help`, `wstack version`, `wstack -v`

Final:
1. Full test suite: `pnpm test`
2. E2E: `pnpm test:e2e`
3. Bench: `pnpm bench` (no regression)

---

## Anti-patterns to avoid

1. **Don't inline new `wiring/` modules** — each new subsystem gets its own file
2. **Don't add fields to `ExecutionDeps`** — add to the appropriate sub-interface
3. **Don't mutate `WireContext` after wiring** — freeze after `buildExecuteDeps()`
4. **Don't re-extract already extracted modules** — verify with `git log --follow`
