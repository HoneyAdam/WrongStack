import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* =========================================================================
   Site data — every value below is sourced from the WrongStack codebase
   (README.md / AGENTS.md / package manifests). No invented numbers.
   ========================================================================= */

export const META = {
  version: '0.285.0',
  repo: 'https://github.com/WrongStack/WrongStack',
  npm: 'wrongstack',
  node: '22',
  license: 'MIT',
  domain: 'wrongstack.com',
} as const;

export const heroStats = [
  { value: '38', label: 'built-in tools' },
  { value: '23', label: 'bundled skills' },
  { value: '~140', label: 'model providers' },
  { value: '36', label: 'official plugins' },
] as const;

/** 23 bundled skills — README / bundled catalog canonical list. */
export const skills = [
  { name: 'api-design', description: 'REST conventions, pagination, auth, and error taxonomy' },
  { name: 'audit-log', description: 'Analyze session logs and event streams' },
  { name: 'bug-hunter', description: 'Systematic debugging and anti-pattern detection' },
  { name: 'chimera', description: 'Post-session code quality review of changed files' },
  {
    name: 'docker-deploy',
    description: 'Container builds, non-root images, and deployment checks',
  },
  { name: 'git-flow', description: 'Branching strategy and commit conventions' },
  {
    name: 'mailbox-bridge',
    description: 'Expose the shared project mailbox to external agents and scripts',
  },
  { name: 'multi-agent', description: 'Coordinate parallel agent workflows' },
  { name: 'node-modern', description: 'Node.js 22+ patterns and best practices' },
  { name: 'observability', description: 'Structured logs, traces, metrics, and redaction' },
  {
    name: 'output-standards',
    description: 'Output formatting standards and next-step conventions',
  },
  { name: 'plugin-author', description: 'Create, review, and refactor WrongStack plugins' },
  { name: 'prompt-engineering', description: 'Craft effective prompts for better results' },
  { name: 'react-modern', description: 'React 19+ patterns and hooks' },
  { name: 'refactor-planner', description: 'Plan and execute safe refactors' },
  { name: 'research-web', description: 'Disciplined web research with source validation' },
  { name: 'sdd', description: 'Spec-Driven Development workflow' },
  { name: 'security-scanner', description: 'Find vulnerabilities before they ship' },
  { name: 'skill-creator', description: 'Build custom skills for specialized tasks' },
  { name: 'tech-stack', description: 'Validate package versions, reject dead/obsolete tech' },
  { name: 'testing', description: 'Vitest patterns, mocks, coverage, and test strategy' },
  { name: 'typescript-strict', description: 'Strict TypeScript for bulletproof code' },
  {
    name: 'wrongstack-mailbox',
    description: 'External-facing mailbox client for cross-agent coordination',
  },
] as const;

/** The 38 built-in tools from packages/tools/src/builtin.ts, grouped. */
export const toolGroups = [
  {
    label: 'Files',
    tools: ['read', 'write', 'edit', 'replace', 'glob', 'grep', 'tree', 'patch', 'diff'],
  },
  { label: 'Shell', tools: ['bash', 'exec'] },
  { label: 'Web', tools: ['fetch', 'search'] },
  { label: 'Quality', tools: ['lint', 'format', 'typecheck', 'test'] },
  { label: 'Packages', tools: ['install', 'audit', 'outdated'] },
  { label: 'Codegen', tools: ['document', 'scaffold', 'design'] },
  { label: 'Data', tools: ['json', 'logs'] },
  { label: 'Project', tools: ['git', 'todo', 'plan', 'kanban', 'task', 'set_working_dir'] },
  { label: 'Codebase index', tools: ['codebase-index', 'codebase-search', 'codebase-stats'] },
  {
    label: 'Meta-tooling',
    tools: ['tool_search', 'tool_use', 'batch_tool_use', 'tool_help'],
  },
] as const;

/** Provider wire families — from models.dev, no hardcoded models or pricing. */
export const providerFamilies = [
  {
    id: 'anthropic',
    transport: 'Native Claude API + SSE',
    examples: ['Anthropic', 'MiniMax', 'Kimi', 'Vertex (Anthropic)'],
  },
  {
    id: 'openai',
    transport: 'OpenAI Chat Completions + SSE',
    examples: ['OpenAI', 'Perplexity', 'Vivgrid'],
  },
  {
    id: 'openai-compatible',
    transport: 'OpenAI-spec endpoints + SSE',
    examples: [
      'Mistral',
      'Groq',
      'DeepSeek',
      'OpenRouter',
      'Together',
      'xAI',
      'Cerebras',
      'Ollama',
      'Fireworks',
      'Moonshot',
      'GLM',
      'Alibaba',
    ],
  },
  {
    id: 'google',
    transport: 'Gemini streamGenerateContent (SSE)',
    examples: ['Google AI Studio'],
  },
] as const;

/** Visible slash commands from the CLI, TUI, plug-lsp, and core first-party plugins. */
export const slashCommands = [
  '/acp',
  '/agents',
  '/audit',
  '/auth',
  '/autonomy',
  '/autophase',
  '/btw',
  '/chimera',
  '/clear',
  '/codebase-reindex',
  '/collab',
  '/commit',
  '/compact',
  '/context',
  '/coordinator',
  '/dev',
  '/diag',
  '/delegate',
  '/director',
  '/desktop',
  '/design',
  '/doctor',
  '/enhance',
  '/ensemble',
  '/exit',
  '/f',
  '/fallback',
  '/fix',
  '/fleet',
  '/gitcheck',
  '/goal',
  '/health',
  '/help',
  '/hq',
  '/init',
  '/interrupt',
  '/kanban',
  '/lsp',
  '/mailbox',
  '/mailbox-demo',
  '/mailbox-serve',
  '/mcp',
  '/memory',
  '/metrics',
  '/mode',
  '/model',
  '/modelcaps',
  '/models',
  '/mouse',
  '/next',
  '/plan',
  '/plugin',
  '/prompt',
  '/prompt-gen',
  '/prompts',
  '/project',
  '/prune',
  '/push',
  '/queue',
  '/review',
  '/save',
  '/sdd',
  '/security',
  '/setmodel',
  '/settings',
  '/sessions',
  '/shadow',
  '/skill',
  '/skill-gen',
  '/skill-import',
  '/skill-install',
  '/skill-search',
  '/skill-uninstall',
  '/skill-update',
  '/spawn',
  '/stats',
  '/statusline',
  '/steer',
  '/suggest',
  '/supervisor',
  '/sync',
  '/tasks',
  '/techstack',
  '/telegram-settings',
  '/telegram-setup',
  '/tool',
  '/todos',
  '/tools',
  '/webui',
  '/working_dir',
  '/worktree',
  '/yolo',
] as const;

/** Published package/app workspaces. */
export const packages = [
  'wrongstack',
  '@wrongstack/core',
  '@wrongstack/cli',
  '@wrongstack/providers',
  '@wrongstack/tools',
  '@wrongstack/mcp',
  '@wrongstack/plug-lsp',
  '@wrongstack/runtime',
  '@wrongstack/kanban',
  '@wrongstack/sdd',
  '@wrongstack/security-scanner',
  '@wrongstack/tui',
  '@wrongstack/webui',
  '@wrongstack/webui-server',
  '@wrongstack/webui-hq',
  '@wrongstack/telegram',
  '@wrongstack/plugins',
  '@wrongstack/bench',
  '@wrongstack/acp',
  '@wrongstack/desktop',
] as const;

/** 36 official plugins — README plugin table. */
export const plugins = [
  { name: 'auto-doc', note: 'JSDoc / TSDoc generation' },
  { name: 'git-autocommit', note: 'Conventional-commit messages' },
  { name: 'shell-check', note: 'ShellCheck wrapper' },
  { name: 'cost-tracker', note: 'Token + cost per model' },
  { name: 'file-watcher', note: 'Emits file-change events' },
  { name: 'cron', note: 'Recurring actions via hooks' },
  { name: 'template-engine', note: '{{var}} / {{#if}} / {{#each}}' },
  { name: 'semver-bump', note: 'Commit-driven version bumps' },
  { name: 'secret-scanner', note: 'Credential blocking, redaction, and warnings' },
  { name: 'todo-tracker', note: 'Persistent project todo backlog' },
  { name: 'token-budget', note: 'Warn or stop near token limits' },
  { name: 'lint-gate', note: 'Runs linters before file edits land' },
  { name: 'branch-guard', note: 'Blocks unsafe operations on protected branches' },
  { name: 'diff-summary', note: 'Injects compact git diff context after edits' },
  { name: 'commit-validator', note: 'Enforces conventional commit shape' },
  { name: 'format-on-save', note: 'Runs formatter after write/edit' },
  { name: 'test-runner-gate', note: 'Runs relevant tests after source edits' },
  { name: 'import-organizer', note: 'Sorts imports and removes unused entries' },
  { name: 'todo-listener', note: 'Broadcasts todo snapshots to the mailbox' },
  { name: 'session-recap', note: 'Posts a session summary on stop' },
  { name: 'spec-linker', note: 'Finds and fixes unlinked plugin references' },
  { name: 'loop-breaker', note: 'Detects repeated tool-call loops' },
  { name: 'path-guard', note: 'Blocks writes to protected paths' },
  { name: 'context-pins', note: 'Pins facts across sessions and compaction' },
  { name: 'checkpoint', note: 'Captures and restores file snapshots' },
  { name: 'error-lens', note: 'Distills failed command output' },
  { name: 'dep-guard', note: 'Supervises dependency installs' },
  { name: 'config-validator', note: 'Validates JSON/YAML/TOML after edits' },
  { name: 'notify-hub', note: 'Sends session and tool notifications' },
  { name: 'changelog-writer', note: 'Writes Keep a Changelog entries' },
  { name: 'injection-shield', note: 'Flags prompt-injection patterns' },
  { name: 'llm-cache', note: 'Provider response cache' },
  { name: 'model-router', note: 'Request-size and tool-aware routing' },
  { name: 'prompt-firewall', note: 'Credential scanner on the provider wire' },
  { name: 'auto-escalate', note: 'Retry ladder for transient failures' },
  { name: 'token-throttle', note: 'Rolling tokens-per-minute throttle' },
] as const;

/* =========================================================================
   Changelog — source: CHANGELOG.md. Each entry has version, date, tagline,
   and key highlights.
   ========================================================================= */

export interface ChangelogEntry {
  version: string;
  date: string;
  tagline: string;
  highlights: string[];
  /** If true, this release consolidated intermediate bump-only versions. */
  consolidated?: boolean;
  /** If true, marks the latest release. */
  latest?: boolean;
}

export const changelog: ChangelogEntry[] = [
  {
    version: '0.285.0',
    date: '2026-07-11',
    latest: true,
    tagline: 'TypeScript 7 build-system and release-docs alignment',
    highlights: [
      'Workspace builds now run through one topologically ordered esbuild package driver instead of 19 per-package tsup configs',
      'Native TypeScript 7 declaration emit is used for package output while dependencies stay external and entry-point shims remain safe',
      'Compiler API consumers are isolated on Microsoft\'s @typescript/typescript6 compatibility package while build/typecheck run on TypeScript 7.0.2',
      'README and website release copy now describe the current 18-package + 2-app workspace shape',
      'Package tables include kanban, SDD, security scanner, WebUI server, HQ, desktop, and the published wrongstack app entry',
    ],
  },
  {
    version: '0.284.0',
    date: '2026-07-10',
    tagline: 'HQ dashboard hardening and prompt-cache stability',
    highlights: [
      'HQ browser token gate: the dashboard shell stays public while /api/* and WS channels are token-gated, with a full-screen token-entry screen instead of a bare 401',
      'Fleet Map rebuilt on a machine → project → terminal → agent topology with live agent badges',
      'Mailbox composer and server-routed message actions (read, acknowledge, reopen, delete, restore) from the HQ dashboard',
      'System prompt split into core/session/volatile regions with frozen prompt epochs for byte-stable provider cache prefixes',
      'Built-in tools declare structured selection boundaries (doNotUseWhen / useInstead) rendered in the system prompt',
      'ChatGPT/Codex OAuth falls back to a second loopback port and recovers the account id from the id_token',
    ],
  },
  {
    version: '0.283.1',
    date: '2026-07-08',
    tagline: 'HQ prompt delivery, transcript rendering, and picker polish',
    highlights: [
      'HQ PromptDock can send steer, BTW, or queued prompts with subjects derived from the selected send type',
      'Offline HQ prompt delivery falls back to /api/mailbox-send and writes directly to the project mailbox',
      'HQ Live Console renders chat-style transcripts with collapsible tool cards, diffs, terminal output, JSON/input views, and todo checklists',
      'Startup provider/model and numbered fallback pickers share a responsive boxed layout that adapts to terminal width',
      'Codebase indexing caches prepared SQLite statements during large symbol writes',
    ],
  },
  {
    version: '0.283.0',
    date: '2026-07-08',
    tagline: 'Interactive surfaces, kanban reliability, and WebUI polish',
    highlights: [
      'TUI slash commands now open first-class panels for MCP, tools, Brain, Shadow, Help, and command-backed surfaces',
      'Tool toggles persist across CLI-hosted WebUI, standalone WebUI, Desktop wiring, and the TUI tools picker',
      'Built-in modes split into explicit lite/deep families, with context-window overrides honored across CLI, REPL, TUI, and tools',
      'Kanban queue/recovery/cost guardrails gain manager/storage/tool support, docs, and regression coverage',
      'WebUI receives a broad component styling/i18n refresh plus a tested accent-color module',
      'Mailbox read/write locking, Telegram command naming, model fallback, and shell confirmation paths were tightened',
    ],
  },
  {
    version: '0.282.1',
    date: '2026-07-06',
    tagline: 'WebUI polish and MCP preset/env fixes',
    highlights: [
      'WebUI QuickModelSwitcher now searches model descriptions in addition to provider id, model id, and display name',
      'Legacy <next_steps> blocks are stripped from persisted subagent output alongside canonical <nextsteps> blocks',
      'MCP passthroughEnv forwards only explicitly named parent env vars to official stdio MCP child processes',
      'MCP configs saved by older versions merge with built-in presets at boot so new preset defaults are preserved',
      'maxToolTimeoutMs is now passed to the tool executor in every CLI construction path',
    ],
  },
  {
    version: '0.282.0',
    date: '2026-07-06',
    tagline: 'Fleet awareness, HQ control plane, Desktop, skills, and 36 plugins',
    highlights: [
      'FleetSupervisor watches Director fleets through the Brain and can retarget pending work, spawn helpers, steer workers, or notify the leader',
      'Peer awareness adds fleet-pulse digests, a fleet_status tool, and rate-capped status broadcasts through the project mailbox',
      'HQ Command Center gains persisted telemetry, active alerts, token-scoped control, and cross-machine steering commands',
      'Skill registry search, /skill-gen authoring tools, private GitHub installs, and the 23-skill bundled catalog are documented',
      '@wrongstack/plugins expands to 36 official plugins alongside the 8 core first-party plugins',
    ],
  },
  {
    version: '0.269.0',
    date: '2026-06-22',
    tagline: 'HQ command center runtime and discovery hardening',
    highlights: [
      'Runtime endpoint auto-discovery — HQ writes runtime.json after port selection so clients find HQ on custom/auto-advanced ports',
      'Stale-pid runtime endpoint protection — readHqRuntimeFileSync ignores runtime.json when the recorded pid is no longer alive',
      'Publisher reconnect hardening — HqPublisher.connect() catches URL/socket factory failures and schedules reconnect instead of throwing',
      'Project metadata preserved in snapshots — ConnectedClient stores HqProjectIdentity from client.hello',
      'Dashboard token forwarding to WS and API — dashboard inline JS forwards ?token= to /ws/browser and /api/projects/:id',
      'BEHAVIOR_DEFAULTS autonomy and feature fields fixed — fresh configs now include autoProceedDelayMs, tokenSavingMode, allowOutsideProjectRoot',
      'HQ welcome Phase 1 handshake — server replies with protocolVersion, serverTime, acceptedCapabilities, redactionPolicy',
      'parseHqFrame() discriminated dispatcher — enforces wire contract on every client frame before processing',
    ],
  },
  {
    version: '0.268.0',
    date: '2026-06-21',
    tagline: 'HQ command center hardening and release-check cleanup',
    highlights: [
      'HQ browser/client protocol documented in docs/subcommands/hq.md (~785 lines)',
      'parseHqFrame() validated on the wire — invalid JSON → close(1003), unknown type/malformed → close(1008)',
      'hq.welcome server reply — Phase 1 handshake with protocolVersion, serverTime, acceptedCapabilities, redactionPolicy',
      'scrubAndTruncateHqPreview() helper — scrubs secrets and truncates preview fields to 280 chars for broadcast',
      'SECURITY.md threat model for HQ Phase 1 + Phase 2 auth roadmap (browser password, client enrollment tokens, TLS)',
      'Mailbox drawer and live-feed jsdom test coverage expanded (10th–13th tests in hq-dashboard.test.ts)',
      'DuckDuckGo parser hardened — parses newer markup, decodes /l/?uddg redirect URLs, returns ok:false for blocked markup',
    ],
  },
  {
    version: '0.267.0',
    date: '2026-06-20',
    tagline: 'Subscription sign-in',
    highlights: [
      'Sign in with ChatGPT (OAuth) — wstack auth login chatgpt → provider openai-codex, PKCE loopback, ChatGPT Responses API',
      'Sign in with Claude (OAuth) — wstack auth login claude → provider anthropic-oauth, PKCE loopback, Claude Messages API',
      'Sign in with GitHub Copilot (OAuth) — wstack auth login copilot → provider github-copilot, GitHub device flow',
      'Self-refreshing tokens — access tokens refresh near expiry and on 401, AES-256-GCM encrypted at rest',
      'Per-model context window for OAuth families — resolves real window from sibling catalog (1M for Claude Opus 4.8)',
      'Anthropic block sanitization fix — tool_result.name and providerMeta stripped from ContentBlocks before wire',
    ],
  },
  {
    version: '0.264.0',
    date: '2026-06-17',
    tagline: 'Performance release — session/mailbox scaling',
    highlights: [
      'GlobalMailbox refactored with in-memory ring buffer + ack sidecar + batched persistence — eliminates per-call full-file I/O',
      'replay-log-store switched to append-only — ring buffer + appendFile with cached tail hash for O(1) appends',
      'Session flush de-awaited from inner loop — await ctx.session.flush() moved to background so disk I/O no longer stalls iteration',
      'mailbox-types.ts — typed mailbox interfaces for ring buffer state and flush semantics',
    ],
  },
  {
    version: '0.262.0',
    date: '2026-06-16',
    tagline: 'Biome 2.5 lint gate and missing subpath exports',
    highlights: [
      'Missing @wrongstack/core/tools and @wrongstack/webui/types subpath exports — dist files added to the package entry lists',
      'Biome 2.5 migration — $schema bumped to 2.5.0, recommended:true removed, trailing comma fixed, 8 lint errors corrected',
      'css.parser.tailwindDirectives: true added for @theme inline (Tailwind v4) in website/src/index.css',
    ],
  },
  {
    version: '0.260.0',
    date: '2026-06-14',
    tagline: 'Benchmark, observability & capability-authorization',
    highlights: [
      '@wrongstack/bench package + wstack bench subcommand — model-independent harness, Aider polyglot + SWE-bench Verified suites',
      'storage.* EventBus observability — config-loader, memory-store, session-store, todos, queue, annotations emit typed storage.read/write/error events',
      'Capability-based plugin tool-mutation authorization — wrap/override/unregister gated on declared P4-6/P4-7/P4-8 capabilities',
      'AutoApprovePermissionPolicy is allowlist-by-default (fail-closed) — newly-added mutating tools denied to prompt-injected subagents',
      'Subagent mail inline injection — all message types folded into leader conversation before every step',
      'WebUI Fleet Monitor and Agent Monitor sliding sidebars — real-time per-subagent status and diagnostics',
      'buildToolUsage() output cached by reference — reuses rendered tool-usage section when tool list unchanged',
    ],
  },
  {
    version: '0.257.0',
    date: '2026-06-14',
    consolidated: true,
    tagline: 'Token-saving mode & resilience',
    highlights: [
      'Token-saving mode (--token-saving-mode) — 10 Tier-1 tools, compact skills, lazy MCP, ~4–6K fewer prompt tokens',
      'mcp_use meta-tool — reach any MCP tool on demand instead of expanding every server into the tool list',
      'Automatic model rotation on rate limits (429/529/5xx) with a /fallback chain and visible ↻ switched-to hop line',
      '/interrupt command (aliases /stop, /int) — stops the leader run AND the whole fleet across CLI/TUI/WebUI',
      'Capability-based plugin tool-mutation authorization + fail-closed AutoApprovePermissionPolicy allowlist',
      'Compaction throughput pass with token pre-compute + a WebUI sliding compaction drawer',
      'Five new hot-path caches: permission evaluate(), ToolRegistry.list(), buildToolUsage, online agents, scrubber pre-scan',
      'Fixes: secret scrubber bearer/high-entropy redaction, OpenAI null message content, full-width TUI chat + table rendering',
    ],
  },
  {
    version: '0.156.1',
    date: '2026-06-09',
    consolidated: true,
    tagline: 'WebUI fleet, delegate command & slash command polish',
    highlights: [
      '/delegate slash command — hand a discrete piece of work to a specialized subagent',
      'WebUI FleetPanel redesigned — clickable agent cards with detail overlay, Agents tab in sidebar',
      'Live subagent output stream in AgentDetail overlay + copy-to-clipboard button',
      '/next and /suggest slash commands — clickable next-step buttons in WebUI and TUI',
      '/resume renamed to /sessions — clearer intent, session list with metadata',
      'Playwright browser automation agent + MCP server preset added to fleet roster',
      'Header chips made clickable — scroll to panels on click across Fleet, Process, Checkpoint',
      'TodosPanel improved — sorting controls, collapsible completed section',
      'SessionStore, MemoryStore, ModeStore wired to WebUI via CLI-backed backend',
      'Core refactoring: parseSubcommand helpers, noOpVault dedup, brand string generalization',
      'Documentation expansion for fleet, MCP, /prune, /suggest, /auth, /tasks, /modelcaps, /delegate',
    ],
  },
  {
    version: '0.148.0',
    date: '2026-06-09',
    tagline: 'Developer experience & release consolidation',
    highlights: [
      '/dev slash command — run shell commands from chat without LLM involvement',
      'Commands execute in the current working directory, timeout after 60 s, cap output at 500 lines',
      'test tool correctly falls back to vitest when no test-runner config file is detected',
      'All 15 workspace packages and the marketing site aligned to 0.148.0 in lockstep',
      '~30 intermediate version bumps consolidated into one documented release line',
    ],
  },
  {
    version: '0.109.1',
    date: '2026-06-08',
    consolidated: true,
    tagline: 'TUI monitor control & goal-path cleanup',
    highlights: [
      'TUI hidden-input mode keeps F-key and Esc routing alive while overlays occupy the bottom region',
      'Monitor panels keep the chat input live underneath them; the process list remains modal for kill shortcuts',
      'F9 goal panel reads the canonical per-project goal.json shared by /goal and autonomy engines',
      'Goal state refreshes when the F9 panel opens and while it remains open',
      'Code-block frames clamp width so bordered boxes no longer wrap into the next line',
      'Build script prepends root/package node_modules/.bin for reliable Windows package builds',
    ],
  },
  {
    version: '0.107.2',
    date: '2026-06-08',
    consolidated: true,
    tagline: 'WebUI operations & terminal polish',
    highlights: [
      'WebUI Goal panel with deliverables, progress, trend, recent journal, and lifecycle state',
      'Process monitor for running tools with process.list, process.kill, and process.killAll',
      'Checkpoint timeline with session checkpoint listing and rewind requests',
      'Autonomy picker for off, suggest, auto, eternal, and eternal-parallel modes',
      'AutoPhase, phase agents, task board, worktree lanes, and WebSocket handlers tightened',
      'Markdown tables and assistant bodies render more predictably in narrow TUI terminals',
    ],
  },
  {
    version: '0.104.0',
    date: '2026-06-08',
    consolidated: true,
    tagline: 'Autonomy control & release realignment',
    highlights: [
      'Goal auto-refinement — /goal set now extracts concrete deliverables and stores original + refined missions',
      'Goal progress tracking — percent, notes, history, trend, lifecycle state, and bounded journal persistence',
      'TUI F9 goal panel — mission, checklist, progress bar, trend, state, iterations, and last task',
      'AutonomyBrain — bounded unattended decisions for blocked autonomous workflows',
      '/auth slash command — non-blocking credential dashboard inside REPL and TUI sessions',
      'Auth menu split into focused modules with a backward-compatible shim',
      '/setmodel resolve + doctor — model matrix explanation and diagnostics',
      'README, CHANGELOG, and marketing site realigned to 0.104.0',
    ],
  },
  {
    version: '0.89.4',
    date: '2026-06-08',
    tagline: 'Task system & agent enhancements',
    highlights: [
      'New task tool — structured work items with dependencies, types, priorities, and agent assignment',
      '/tasks slash command — human-facing task management with promote-to-todos',
      'Three-layer work hierarchy: plan (strategic) → task (structured) → todo (tactical)',
      '/setmodel resolve <role> — walk the full resolution chain step by step',
      '/setmodel doctor — validate matrix entries against current config',
      'tech-stack validator agent — 43rd fleet agent, single-shot version checking',
      'Telegram notifications humanized — no more raw JSON dumps, semantic truncation',
      'Fleet roster 46 → 47 agents (43 catalog + 4 legacy)',
    ],
  },
  {
    version: '0.89.3',
    date: '2026-06-08',
    tagline: 'TUI hardening & code consolidation',
    consolidated: true,
    highlights: [
      'F8 process list overlay — live process view with kill actions in the TUI',
      'Arrow-key navigation hardened across all TUI overlays — generic overlayOpen guard',
      'Stale terminal worktrees auto-pruned in F4 monitor with 5-minute TTL',
      'Compact agents monitor + fleet stale pruning + cost precision 4dp',
      'expectDefined deduplicated from ACP & WebUI into @wrongstack/core/utils/expect-defined',
      'WebUI layout overlap fix, terminal resize corruption fix, SettingsPicker ghost text fix',
    ],
  },
  {
    version: '0.87.0',
    date: '2026-06-07',
    tagline: 'Session lifecycle & type safety',
    consolidated: true,
    highlights: [
      '/prune session housekeeping — delete old sessions by age, --dry-run preview, --rebuild-index',
      'Analytics-grade session summaries: iteration/tool/error/file-change counts, per-tool breakdown, outcome',
      'Categorized slash-command discovery — grouped TUI picker, WebUI command list 19 → 39',
      'Non-modal TUI monitor overlays — chat input stays live while monitors are open',
      'fetch undici dispatcher torn down on exit; session-store teardown race fixed (Windows ENOTEMPTY)',
      'Monorepo-wide type-safety hardening (exactOptionalPropertyTypes), MCP undici@7 type conflict resolved',
    ],
  },
  {
    version: '0.77.0',
    date: '2026-06-06',
    tagline: 'Prompt refinement & hardening',
    highlights: [
      'LLM-driven /enhance prompt refinement with countdown auto-send preview in the TUI',
      '/telegram-setup one-command bot configuration against the Telegram getMe API',
      'Live concurrency ceiling in TUI fleet monitor with kernel event subscription',
      'Project-root detection hardened — stops walk-up at homedir, prunes stale project dirs',
      'TUI input fixes: Delete/Backspace separation, Shift+Enter multi-line insert',
      '3 new TUI surfaces: CompactTodosPanel, QueuePanel, TodosMonitor',
      'pnpm 11.3.0 → 11.5.2, human-readable project directory naming',
    ],
  },
  {
    version: '0.73.1',
    date: '2026-06-06',
    tagline: 'Background indexer & decomposition',
    consolidated: true,
    highlights: [
      'Background, gitignore-aware SQLite codebase indexer with /codebase-reindex command',
      'Large-file decomposition pass: 16 monoliths → 55 focused submodules (WebUI store/WS/sidebar, TUI app)',
      'TUI mouse mode removed entirely — unreliable on Windows consoles',
      'Node 23.9 → 24.0 migration, expanded pre-launch readiness checks',
    ],
  },
  {
    version: '0.66.13',
    date: '2026-06-05',
    tagline: 'WebUI fleet & agent decomposition',
    consolidated: true,
    highlights: [
      'Agent loop decomposed: 1,064-line core/agent.ts monolith → 6 focused, independently-testable modules',
      'WebUI multi-instance with auto-advancing ports, self-healing instance registry',
      'WebUI visual overhaul — "Engineering Instrument Deck" design system with dark/light modes',
      'Live fleet roster in WebUI: per-subagent iteration/tool/cost counters, context-fill bar',
      '/yolo destructive toggle — keep YOLO for routine work, confirm risky operations',
      'createToolOutputSerializer: budget-capped tool-output serialization',
    ],
  },
  {
    version: '0.54.1',
    date: '2026-06-04',
    tagline: 'Boot refresh & model picker',
    consolidated: true,
    highlights: [
      'Blocking models.dev catalog refresh on boot — TUI and model resolution always see fresh data',
      'Type-to-search model picker with scroll-window navigation, capped at 10 visible items',
      'WebUI secret redaction before WebSocket broadcast (DefaultSecretScrubber)',
      'Cloud-sync path-traversal guard, edit tool double-edit stale-read fix',
      'wstack models --search --page --per-page pagination',
    ],
  },
  {
    version: '0.51.3',
    date: '2026-06-04',
    tagline: 'Brain-governed AutoPhase',
    highlights: [
      'BrainArbiter coordination layer — policy decisions escalate unsafe choices to human via TUI',
      'TUI Brain decision prompt: interactive A/B/C panel with Esc/D safe default',
      'AutoPhase conflict resolution routed through Brain before merge',
      'Phase completion and worktree integration tracked separately',
      'Director budget-extension policy hooks consult Brain at soft limits',
    ],
  },
  {
    version: '0.41.0',
    date: '2026-06-03',
    tagline: 'Model matrix & AutoPhase verification gate',
    consolidated: true,
    highlights: [
      'Per-task model matrix + /setmodel slash command — different roles run on different models',
      'AutoPhase verification gate + auto-repair: verifyPhase callback retries up to maxVerifyAttempts',
      'Unified TTY / stdout abstraction layer (isStdoutTTY, writeOut, writeErr)',
      'WebUI server decomposition, CLI index.ts split into 5 modules',
      '4 critical/high audit findings resolved — argument injection blocked across 4 tools',
    ],
  },
  {
    version: '0.31.1',
    date: '2026-06-03',
    tagline: 'Director resilience',
    consolidated: true,
    highlights: [
      'LargeAnswerStore + ask_result tool — bounded Director context, 2K-char threshold for out-of-band storage',
      'Calibrated token estimation — self-corrects estimate-vs-actual ratio from provider usage',
      'Fleet failure taxonomy surfaced in TUI agents monitor and fleet timeline',
      'Director resource leak fixes: remove() frees manifest entries, task owners, nickname slots',
      'Orphaned pending tasks no longer hang awaitTasks() — synthetic stopped completions',
    ],
  },
  {
    version: '0.24.0',
    date: '2026-06-03',
    tagline: 'Version-line realignment',
    highlights: [
      'All 15 workspace manifests consolidated to single 0.24.0 lockstep version',
      'Tag history reset to single v0.24.0 — prior tags (v0.10.2–v0.28.0) deleted',
      'Intermediate bump-only versions (0.11.0–0.23.1) collapsed into this entry',
    ],
  },
  {
    version: '0.10.3',
    date: '2026-06-02',
    tagline: 'Lockstep workspace alignment',
    highlights: ['All workspace packages bumped to 0.10.3 in lockstep'],
  },
  {
    version: '0.9.20',
    date: '2026-06-01',
    tagline: 'The collaboration release',
    highlights: [
      'Collaborative debugging — multi-human sessions (observer, annotator, controller roles)',
      'Deterministic replay — record/replay/auto modes, byte-for-byte equality',
      'Stateful session recovery — crash markers, in_flight_start/end events, /resume --incomplete',
      'Chained SHA-256 tool-call audit trail — tamper-evident, verify(sessionId) check',
      '4 IDEAS.md items shipped: collab debug, replay, recovery, audit',
    ],
  },
  {
    version: '0.8.4',
    date: '2026-05-28',
    tagline: 'AutoPhase — autonomous phase workflow',
    highlights: [
      '/autophase command: start/pause/resume/stop/status/list/load/save',
      'Ordered phases: Discovery → Design → Implementation → Testing → Deployment',
      'WebSocket-driven AutoPhase view in the web UI',
      'TUI input and status bar pinned to bottom fix',
      'Compaction overhead accounting corrected',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-05-25',
    tagline: 'Eternal autonomy & SDD',
    highlights: [
      '/autonomy eternal — run-until-done engine with decide → execute → reflect loop',
      'Persistent /goal system with pause/resume, goalState lifecycle, journal ring buffer',
      'Spec-Driven Development workflow: parse → analyze → generate → track → execute',
      '46-agent fleet roster with smart dispatcher routing',
      'Delegate budgets raised 10×, maxConcurrent 2 → 8',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-05-22',
    tagline: 'Eternal autonomy engine',
    highlights: [
      'EternalAutonomyEngine class — idle → running → stopped state machine',
      '/goal command unified: set, clear, journal subcommands',
      'TUI eternal stage chip: ⟳ DECIDE → ⚡ EXECUTE → ◎ REFLECT',
      '/autonomy eternal + --eternal flag',
      'WebUI eternal.iteration WS broadcast',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-05-21',
    tagline: 'First tagged release',
    highlights: [
      'Initial public release',
      'pnpm workspace monorepo with lockstep versioning',
      'CLI, TUI, WebUI, MCP client, providers, tools, skills, plugins',
    ],
  },
];

/* =========================================================================
   Release process — source: RELEASE.md
   ========================================================================= */

export interface ReleaseStep {
  phase: string;
  steps: string[];
}

export const releaseProcess: ReleaseStep[] = [
  {
    phase: 'Pre-release',
    steps: [
      'pnpm test — all tests green',
      'pnpm typecheck — clean tsc --noEmit',
      'pnpm lint — Biome clean',
      'pnpm build — all packages build',
      'node scripts/publish-check.mjs --dry-run',
    ],
  },
  {
    phase: 'Version bump',
    steps: [
      'node scripts/bump-version.mjs <patch|minor|major>',
      'Version bumped in root + all 20 package/app workspace manifests + website/',
      'CHANGELOG.md updated with release date and highlights',
    ],
  },
  {
    phase: 'Commit & tag',
    steps: ['git commit -am "release: X.Y.Z"', 'git tag vX.Y.Z', 'git push --follow-tags'],
  },
  {
    phase: 'Verify CI',
    steps: [
      'GitHub Actions Release workflow triggered by tag push',
      'All 3 platforms green: Ubuntu, macOS, Windows',
      'npm packages published to all workspace subpaths',
    ],
  },
  {
    phase: 'Post-release',
    steps: [
      'Verify: npm info @wrongstack/core',
      'Test install: npm install -g wrongstack && wrongstack version',
      'GitHub Release created with auto-generated notes',
    ],
  },
];

export const releaseWorkflow = {
  trigger: 'Push a tag matching v*',
  automation: [
    'Typecheck + build + test on 3 platforms',
    'Version tag verification (tag must match package.json)',
    'npm publish for all workspace packages',
    'GitHub Release creation with auto-generated notes',
  ],
  requiredSecrets: ['NPM_TOKEN — npm authentication token with publish access'],
  preReleaseNote: 'Tags containing "-" (e.g. v1.0.0-beta.1) are marked as pre-release on GitHub.',
  hotfix: [
    'git checkout vX.Y.Z',
    'git checkout -b hotfix/X.Y.Z+1',
    'node scripts/bump-version.mjs patch',
    'git commit -am "release: X.Y.Z+1"',
    'git tag vX.Y.Z+1',
    'git push --follow-tags',
  ],
} as const;
