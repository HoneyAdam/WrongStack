export interface CommandDetail {
  /** One-sentence purpose — what problem this command solves. */
  purpose: string;
  /** 2–3 sentence description of how the command behaves when invoked. */
  behavior: string;
  /** What to check or confirm before running this command. */
  before: string;
  /** What you observe while the command executes. */
  during: string;
  /** What to verify or do after the command completes. */
  after: string;
}

type CommandDetailMap = Record<string, CommandDetail>;

export const commandDetails: CommandDetailMap = {
  // ─── Workflow ────────────────────────────────────────────────────────────────

  '/sdd': {
    purpose:
      'Run the Spec-Driven Development workflow: define a spec, let the agent plan, implement, and verify in structured phases.',
    behavior:
      'The command enters a multi-phase workflow. First it prompts you for or accepts a spec string. Then it plans the implementation, executes it with tool access, and runs verification. Each phase produces structured output you can review before the next phase begins. The workflow respects your current mode and tool permissions.',
    before:
      'Have a clear spec in mind — a sentence or two describing the desired outcome. Confirm the working tree is clean or changes are stashed.',
    during:
      'Watch the phase transitions. The agent prints a plan summary, then implementation evidence, then verification results. You can interrupt between phases.',
    after:
      'Review the diff and the verification output. Run additional tests if needed. The SDD phase state persists in the session.',
  },

  '/btw': {
    purpose:
      'Ask a quick side question without derailing the current task or polluting the main conversation thread.',
    behavior:
      'The command opens a lightweight side-channel. Your question is answered inline but does not become part of the main task context — the agent returns to its primary objective immediately after answering. Ideal for clarifying syntax, checking a fact, or getting a quick lookup without context pollution.',
    before: 'No preparation needed. Just have your question ready.',
    during:
      'The agent pauses its main task briefly, answers your question, then resumes. The side answer appears inline.',
    after:
      'The main task continues uninterrupted. The side Q&A is logged but does not steer the primary workflow.',
  },

  '/next': {
    purpose:
      'Toggle automatic next-task prediction — the agent suggests what to do after the current task completes.',
    behavior:
      'When enabled, after each task completion the agent appends 2–4 suggested next prompts in a <nextsteps> block. You select one with `/next 1` (or `/next 1 2 3`), list them with `/next list`, or regenerate with `/suggest`. Running `/next` without arguments toggles the feature on or off.',
    before:
      'Check whether you want predictive suggestions for your workflow style. Some users prefer manual control.',
    during:
      'If toggling on, observe the next task completion — suggestions appear at the end of the agent response.',
    after:
      'Use `/next list` to see available suggestions or `/next 1` to select one. Disable with another `/next` if it gets distracting.',
  },

  '/suggest': {
    purpose:
      'Generate context-aware next actions manually, with an optional fast heuristic mode that skips the model call.',
    behavior:
      'The command analyzes your current session context — open files, recent tasks, mailbox messages, and todo list — and produces a ranked list of suggested next prompts. In heuristic mode it uses pattern matching for speed; without it, the configured model generates richer suggestions.',
    before:
      'Complete or pause your current task so the context reflects what remains to be done.',
    during:
      'Suggestions appear as a numbered list. Heuristic mode returns near-instantly; model mode may take a few seconds.',
    after:
      'Type `/next <number>` to select a suggestion or `/next list` to review them again.',
  },

  '/enhance': {
    purpose:
      'Refine a prompt before it is sent to the agent — improve clarity, add missing context, or rephrase for better results.',
    behavior:
      'The command takes your raw prompt and runs it through a refinement pass. The model expands vague instructions, adds relevant context from the session, and sharpens the ask. You see the enhanced version and can accept it, edit it, or discard it before it reaches the agent.',
    before:
      'Write a rough prompt — even a few words will do. The enhancer works best when you give it a clear goal statement.',
    during:
      'The refined prompt appears for your review. You can accept it as-is, edit it inline, or cancel.',
    after:
      'The accepted prompt is sent to the agent. If you edited it, your version is used. If cancelled, nothing is sent.',
  },

  '/fix': {
    purpose:
      'Classify an error and route it into a focused repair workflow — faster than explaining the bug manually.',
    behavior:
      'The command reads the most recent error from the session (or accepts a pasted error), classifies it by type (type error, lint, test failure, runtime crash), and dispatches a targeted repair sub-agent with the appropriate tools and context. The fixer proposes a patch you can review.',
    before:
      'Keep the error message handy — copy it from your terminal or let the command read the last session error.',
    during:
      'The classifier identifies the error type, then a repair workflow runs. You see diagnostic output and the proposed fix.',
    after:
      'Review the diff. Run tests to confirm the fix. If the classifier misidentified the error, re-run with a pasted error message.',
  },

  '/autophase': {
    purpose:
      'Run an autonomous phase-based workflow — the agent plans, executes, and verifies across multiple phases without manual steering.',
    behavior:
      'Similar to SDD but fully autonomous. The agent breaks work into phases (plan → implement → test → review), executes each in an isolated worktree, and reports results. You set the initial goal; the agent drives the rest. Phases can be paused, resumed, or cancelled.',
    before:
      'Define a clear goal. Ensure worktrees are enabled and disk space is available. Consider setting `/autonomy` level first.',
    during:
      'Watch phase progress in the TUI status bar or via `/autophase status`. Each phase produces a summary.',
    after:
      'Review the final diff across all phases. Merge worktree results. Run `/autophase status` for the phase journal.',
  },

  '/goal': {
    purpose:
      'Set, show, pause, resume, journal, or clear an autonomous mission that the agent works toward across turns.',
    behavior:
      'A goal is a persistent, high-level objective the agent keeps in context. `/goal set "..."` creates one. The agent references it in planning and task selection. `/goal pause` suspends it; `/goal resume` reactivates it; `/goal journal` shows progress; `/goal clear` removes it.',
    before:
      'Formulate a concrete, achievable mission statement. Goals work best when they are scoped to a session or a few sessions.',
    during:
      'The goal appears in the status line and the agent references it when choosing next actions.',
    after:
      'Use `/goal journal` to review progress. Clear the goal when the mission is complete to free context.',
  },

  '/autonomy': {
    purpose:
      'Set the active autonomy level — control how independently the agent chooses and executes tasks.',
    behavior:
      'Autonomy levels range from manual (you drive every step) to full (the agent plans and executes freely). `/autonomy` without arguments shows the current level. `/autonomy <level>` sets it. Higher levels unlock automatic task chaining, goal pursuit, and proactive tool use.',
    before:
      'Decide how much control you want to retain. Higher autonomy is powerful but requires trust in the agent judgment.',
    during:
      'The new level takes effect immediately. The status line updates to reflect the change.',
    after:
      'Observe the agent behavior for a few turns. Lower autonomy if it overreaches; raise it if you want less micromanagement.',
  },

  '/plan': {
    purpose:
      'Manage the per-session strategic plan board — outline big-picture work and track progress across turns.',
    behavior:
      'The plan is a durable outline that survives within the session. `/plan add "title"` creates an item. `/plan start <id>` marks it in progress. `/plan done <id>` completes it. `/plan promote <id>` breaks a plan item into todo items. Plans can be session-scoped or project-scoped.',
    before:
      'Think about the high-level milestones for your session. Plans are coarser than todos — they represent phases or features.',
    during:
      'The plan board prints after each mutation. Active items show their status.',
    after:
      'Use `/plan promote` to convert completed plan items into actionable todos for detailed execution.',
  },

  '/review': {
    purpose:
      'Run a model-driven code review pass — the agent inspects your changes and reports issues, risks, and suggestions.',
    behavior:
      'The command runs the configured model over your working tree diff (or specified files). It checks for bugs, anti-patterns, security issues, style violations, and design problems. The output is a structured review with severity levels and actionable suggestions.',
    before:
      'Stage or diff the changes you want reviewed. Narrow the scope with a file path for faster, more focused reviews.',
    during:
      'The review runs as a focused model pass. It produces a categorized report with file references and severity tags.',
    after:
      'Address critical and high-severity findings. Re-run the review after fixes to confirm resolution.',
  },

  '/kanban': {
    purpose:
      'Manage durable Kanban boards — create columns, add dependency-aware tasks, assign work, and dispatch to the fleet.',
    behavior:
      'The full Kanban system supports multiple boards, columns, tasks with dependency chains, assignments, leases, heartbeats, and fleet dispatch. `/kanban` opens the TUI panel. Subcommands like `/kanban task ready`, `/kanban task dispatch`, and `/kanban snapshot` provide CLI access. Aliases: `/kb`, `/board`.',
    before:
      'Create a board with columns matching your workflow (e.g., Todo, Running, Review, Done). Define task dependencies before dispatching.',
    during:
      'The TUI panel shows live column state. Dispatched tasks appear in the fleet with lease tracking.',
    after:
      'Run `/kanban snapshot` to persist board state. Recover stale tasks with `/kanban task recover`.',
  },

  '/refiner': {
    purpose:
      'Inspect and tune automatic prompt-refinement behavior — control how the agent polishes prompts before execution.',
    behavior:
      'The refiner automatically enhances prompts before they reach the agent. `/refiner` shows current settings. You can adjust the refinement level, enable/disable it, or configure which prompt types get refined. Works alongside `/enhance` for manual refinement.',
    before:
      'Understand your refinement preferences. Aggressive refinement may change your intent; light refinement only fixes clarity.',
    during:
      'Settings take effect immediately. Future prompts are refined according to the new configuration.',
    after:
      'Test with a sample prompt to verify the refinement level matches your expectations.',
  },

  // ─── Session ─────────────────────────────────────────────────────────────────

  '/clear': {
    purpose:
      'Wipe the current session state and clear the terminal view — start fresh without restarting the process.',
    behavior:
      'The command clears the terminal screen and optionally resets session state (context, todo list, plan). By default it only clears the visual display. With flags it can also reset context, memory, or the full session. The REPL prompt reappears at the top.',
    before:
      'Save any important session state with `/save` if you might need it later.',
    during:
      'The terminal clears instantly. If resetting state, a confirmation prompt may appear.',
    after:
      'Verify the session is in the expected state. Re-run `/context` or `/diag` if you reset deeper state.',
  },

  '/compact': {
    purpose:
      'Run the configured context-window compactor immediately — reclaim token space without losing essential context.',
    behavior:
      'The compactor summarizes older messages, prunes irrelevant content, and consolidates the conversation into a denser form. It preserves key decisions, file references, and active tasks. Run it proactively when approaching context limits or when the conversation feels bloated.',
    before:
      'Check current context usage with `/context` or `/stats`. Compact when you are above 70% of the window.',
    during:
      'The compaction runs as a model pass. It may take a few seconds. A summary note is injected post-compaction.',
    after:
      'Review the compaction summary to ensure no critical context was lost. Continue working — the agent remembers the essentials.',
  },

  '/context': {
    purpose:
      'Inspect, repair, and tune context modes, thresholds, and limits — control how the agent manages its working memory.',
    behavior:
      '`/context` shows the current context window state: token usage, message count, compaction thresholds. Subcommands let you switch context modes (deep, balanced, tight), adjust compaction thresholds, manually prune message ranges, and inject summary notes. The `/ctx` alias works interchangeably.',
    before:
      'Check `/stats` first for a quick overview. Use `/context` when you need to inspect or modify the context strategy.',
    during:
      'The command output shows the live context state. Mode switches and threshold changes apply immediately.',
    after:
      'Monitor context usage over the next few turns to confirm the new settings work for your workflow.',
  },

  '/diag': {
    purpose:
      'Inspect runtime diagnostics and active system state — a comprehensive health check for the current session.',
    behavior:
      'The command prints a structured diagnostics report: Node.js version, process uptime, memory usage, active plugins, loaded skills, registered tools, provider status, session metrics, and any detected anomalies. Use it when something feels wrong or before reporting a bug.',
    before: 'No preparation needed. Run it anytime you want a system health snapshot.',
    during:
      'The report prints section by section. Each section is labeled and can be visually scanned for warnings.',
    after:
      'Address any warnings or errors shown in the report. Share the output when filing a bug report.',
  },

  '/stats': {
    purpose:
      'Show token, cost, and iteration statistics for the current session — understand where your budget is going.',
    behavior:
      'The command prints a breakdown: total tokens used (input vs output), estimated cost, iteration count, tool call count, and averages per turn. Some providers expose more detail than others. The stats reset when you start a new session.',
    before: 'No preparation needed. Run it to check your usage against provider limits or cost concerns.',
    during: 'The stats print instantly — no model call required.',
    after:
      'If costs are high, consider switching to a cheaper model with `/setmodel` or compacting with `/compact`.',
  },

  '/memory': {
    purpose:
      'Search, graph, verify, clean, import, and inspect the structured SuperMemory system.',
    behavior:
      'SuperMemory persists facts across sessions. `/memory search <query>` finds relevant memories. `/memory graph` shows the knowledge graph. `/memory verify` checks integrity. `/memory hygiene` cleans stale entries. `/memory import` loads from external sources. The memory system auto-injects relevant facts into agent context.',
    before:
      'Think about what you want to find or manage. Use search for fact retrieval, graph for relationship exploration.',
    during:
      'Search results show relevance scores. Graph view shows nodes and edges. Hygiene operations show what was cleaned.',
    after:
      'Verified memories are more reliable. After importing, search to confirm the data landed correctly.',
  },

  '/todos': {
    purpose:
      'View and manage the current session todo list — the agent tactical task tracker.',
    behavior:
      'The todo list is the agent per-turn task list. `/todos` prints all items with their status (pending, in_progress, completed). The agent updates it automatically as it works. You can add, remove, or reorder items manually. Unlike `/tasks`, todos are ephemeral and reset each session.',
    before: 'No preparation needed. Run it to see what the agent is currently working on.',
    during: 'The list prints with status indicators. Only one item can be in_progress at a time.',
    after: 'Completed items stay visible for the session. Use `/clear` to reset the todo list.',
  },

  '/tasks': {
    purpose:
      'Manage structured tasks with priorities, dependencies, types, and assignments — a richer alternative to todos.',
    behavior:
      'Tasks support types (feature, bugfix, refactor, docs, test, chore), priorities, dependency chains, assignees, and estimates. `/tasks` shows the full list. Tasks can be session-scoped or project-scoped. Use `/tasks promote` to convert a task into actionable todos.',
    before:
      'Plan your task hierarchy. Define dependencies before marking tasks ready to avoid blocked states.',
    during: 'The task list prints with type badges, priority indicators, and dependency arrows.',
    after:
      'Completed tasks can be promoted to todos for detailed execution tracking.',
  },

  '/save': {
    purpose:
      'Force the live session writer to flush to disk — persist the current conversation state immediately.',
    behavior:
      'The session writer normally flushes periodically. `/save` forces an immediate write of the full conversation transcript, memory state, and session metadata to disk. Use it before a risky operation or before closing the terminal.',
    before: 'No preparation needed. It is safe to run at any time.',
    during: 'The flush happens synchronously — the prompt returns when the write is complete.',
    after:
      'Your session is now durable on disk. You can safely exit or resume later with `/sessions`.',
  },

  '/sessions': {
    purpose:
      'List and resume saved sessions — pick up where you left off, also available as `/resume` and `/load`.',
    behavior:
      'The command lists all saved sessions with timestamps, durations, and summary snippets. `/sessions resume <id>` restores a session with its full context, todo list, plan, and memory state. `/sessions rename <id> "name"` labels a session. `/sessions delete <id>` removes old sessions.',
    before:
      'Save your current session with `/save` first if you plan to switch.',
    during:
      'The session list prints with IDs and metadata. Resuming loads the session and prints a restore summary.',
    after:
      'Verify the restored context is correct. The agent should remember your previous task and plan.',
  },

  '/prune': {
    purpose:
      'Preview or delete old session data — free disk space by removing stale transcripts and checkpoints.',
    behavior:
      '`/prune` shows a preview of which sessions are eligible for deletion based on age and size. `/prune --execute` performs the deletion. You can filter by age, project, or session count. Pruning is irreversible — the preview is always shown before deletion.',
    before:
      'Run `/prune` without flags first to preview what would be deleted. Confirm nothing important is in the list.',
    during: 'The preview lists sessions with size and age. The execute phase shows progress.',
    after:
      'Run `/prune` again to confirm the old sessions are gone. Freed disk space is reported.',
  },

  '/exit': {
    purpose:
      'Close the REPL cleanly — aliases include `/quit` and `/q`.',
    behavior:
      'The command triggers a graceful shutdown: the session is saved, active subagents are terminated, cron jobs are cancelled, and the process exits. Any unsaved changes are flushed before exit. Use this instead of Ctrl+C for a clean teardown.',
    before:
      'Confirm you want to end the session. Any running fleet operations will be terminated.',
    during:
      'The shutdown sequence prints: saving session, stopping agents, cancelling timers, exiting.',
    after: 'The terminal returns to your shell. Your session is saved for later resume.',
  },

  '/interrupt': {
    purpose:
      'Abort the in-flight leader iteration safely — stop the agent mid-thought without corrupting session state.',
    behavior:
      'When the agent is in the middle of a model call or long tool execution, `/interrupt` sends a cancellation signal. The current operation stops gracefully, partial output is discarded, and the REPL prompt returns. Unlike Ctrl+C, it does not risk corrupting the session file.',
    before: 'Use when the agent is stuck, looping, or heading in the wrong direction.',
    during: 'The interrupt signal propagates. In-flight tool calls may complete or abort depending on their phase.',
    after:
      'The REPL prompt returns. Review what the agent was doing and provide corrective steering.',
  },

  // ─── Agents ──────────────────────────────────────────────────────────────────

  '/spawn': {
    purpose:
      'Create an isolated specialist subagent — give it a bounded task with its own context, tools, and budget.',
    behavior:
      'The command creates a new subagent process with a dedicated context window. You specify a role (from the 50+ built-in roster), a task description, and optional budget constraints (timeout, max iterations, max tool calls, max cost). The subagent runs independently and returns its result when done.',
    before:
      'Choose the right specialist role for the task. Define clear success criteria and budget limits.',
    during:
      'The subagent status appears in `/fleet`. Its progress is logged to its own transcript.',
    after:
      'Collect the subagent result with `/fleet` or `/agents`. Review its output and terminate it if no longer needed.',
  },

  '/agents': {
    purpose:
      'Monitor agents, timeline events, and per-agent transcripts — the agent observability dashboard.',
    behavior:
      '`/agents` shows a list of all agents (leader + subagents) with status, current task, and last activity. `/agents show <id>` opens a detailed view. `/agents chat compact` shows a compacted transcript. `/agents timeline` shows an event chronology. The TUI panel provides live updates.',
    before: 'No preparation needed. Run it when you want to see what your fleet is doing.',
    during: 'The agent list prints with status indicators. Live agents show heartbeat timestamps.',
    after:
      'Terminate idle agents to free resources. Review transcripts for completed agents to extract results.',
  },

  '/director': {
    purpose:
      '(Obsolete — Director Mode is permanently on) Previously used to promote the session into Director orchestration mode.',
    behavior:
      'Director Mode is now always active. Fleet orchestration tools (spawn, assign, monitor, terminate) are available on every session without any command or flag. The `/director` slash command is a no-op that always succeeds.',
    before: 'No preparation needed — Director Mode is always on.',
    during:
      'Fleet orchestration tools are available without any promotion step.',
    after:
      'No action needed. Manage your fleet via /spawn, /fleet, /delegate, and /agents.',
  },

  '/delegate': {
    purpose:
      'Hand a bounded task to a specialist role — the simplest way to get parallel work done.',
    behavior:
      '`/delegate --role=<role> "task"` creates a subagent with the specified role, assigns the task, and waits for the result. It is a convenience wrapper around spawn + assign + await. You can also use smart dispatch by omitting the role and letting the system choose.',
    before:
      'Define a clear, self-contained task. Choose a role or trust the smart dispatcher to pick one.',
    during:
      'The delegate runs in the background. A status line shows progress. You can continue working in the REPL.',
    after:
      'The result appears when the delegate finishes. Review it, then the delegate terminates automatically.',
  },

  '/fleet': {
    purpose:
      'Inspect fleet status, budgets, logs, streams, retries, and workers — the full fleet operations surface.',
    behavior:
      '`/fleet` shows a snapshot of all subagents, coordinator counts, and pending tasks. `/fleet status` shows live state. `/fleet usage` shows token and cost breakdowns per agent. `/fleet health` shows budget pressure and activity. `/fleet dispatch` sends work to the fleet. `/fleet session <id>` reads agent transcripts.',
    before:
      'No preparation needed. Run it whenever you want visibility into your fleet operations.',
    during:
      'Status output updates live. Usage reports show cumulative and per-agent breakdowns.',
    after:
      'Use `/fleet health` to identify agents near budget limits. Terminate idle agents to free resources.',
  },

  '/ensemble': {
    purpose:
      'Fan one task to multiple ACP-capable coding agents — get independent perspectives on the same problem.',
    behavior:
      'The command sends the same task to multiple installed ACP agents (Claude Code, Codex CLI, Gemini CLI, etc.) in parallel. Each agent works independently with its own tools and context. Results are collected and presented side by side for comparison or voting.',
    before:
      'Install and configure the ACP agents you want to use. Verify they are discoverable with `/acp probe`.',
    during:
      'Each agent runs in parallel. Progress indicators show which agents are still working.',
    after:
      'Compare results. Ensemble works best for review tasks, architecture decisions, and solution comparison.',
  },

  '/collab': {
    purpose:
      'Start structured live collaboration helpers — BugHunter, RefactorPlanner, and Critic run in parallel on target files.',
    behavior:
      'The collaboration workflow spawns three specialist agents simultaneously: BugHunter scans for bugs, RefactorPlanner proposes improvements, and Critic evaluates both. Events flow between them on the FleetBus. The final report aggregates findings with an overall verdict.',
    before:
      'Identify the target files or directories. Narrow scope for faster results.',
    during:
      'Agents emit events on the FleetBus as they find issues. The Critic evaluates in real time.',
    after:
      'Review the structured report. Address bugs first, then consider refactor suggestions.',
  },

  '/brain': {
    purpose:
      'Inspect the decision arbiter, ask it a question, or set its risk ceiling — the Brain governs high-stakes fleet decisions.',
    behavior:
      'The Brain agent evaluates risky fleet actions (spawning, tool approval escalation, worktree creation) against configurable risk thresholds. `/brain` shows current settings. `/brain ask "..."` queries the Brain for a decision recommendation. `/brain risk <level>` sets the risk ceiling.',
    before:
      'Understand the Brain role in your fleet. It acts as a safety gate, not a replacement for your judgment.',
    during:
      'Brain queries return a decision with reasoning. Risk level changes apply immediately to future decisions.',
    after:
      'Monitor Brain decisions in the fleet event log. Adjust the risk ceiling if it is too conservative or permissive.',
  },

  '/coordinator': {
    purpose:
      'Control multi-session autonomous goal coordination — let goals persist and progress across terminal sessions.',
    behavior:
      'The Coordinator tracks goals across sessions. When you close a terminal and resume later, the Coordinator picks up the goal and continues. `/coordinator status` shows active goals. `/coordinator pause` suspends cross-session tracking. `/coordinator resume` reactivates it.',
    before:
      'Set a goal with `/goal set` first. The Coordinator only manages goals that have been explicitly created.',
    during:
      'The Coordinator runs in the background, tracking goal progress across session boundaries.',
    after:
      'Use `/coordinator status` to confirm goals are being tracked. Clear completed goals to free coordinator resources.',
  },

  '/mailbox': {
    purpose:
      'Read and send cross-agent project mailbox messages — the inter-agent communication hub.',
    behavior:
      'The project mailbox is a shared message store for all agents working on the same project. `/mailbox` shows unread messages. `/mailbox send` sends a typed message (note, ask, assign, steer, broadcast, etc.). `/mailbox query` filters messages. Messages support priorities, read receipts, and completion tracking.',
    before:
      'Check `/mailbox` when starting work to see if other agents have left messages or assignments for you.',
    during:
      'Unread messages appear inline. Sending confirms with a message ID.',
    after:
      'Acknowledge completed assignments with `/mailbox ack`. Broadcast milestones so peers avoid duplicate work.',
  },

  '/mailbox-demo': {
    purpose:
      'Exercise mailbox routing during development — test message delivery, read receipts, and agent registration.',
    behavior:
      'A development-only command that simulates mailbox traffic: sends test messages, verifies delivery, tests read receipts, and exercises agent registration/heartbeat flows. Useful when building or debugging mailbox integrations.',
    before: 'Ensure the mailbox bridge or local mailbox is running.',
    during: 'Test messages flow through the mailbox. Results show delivery status and timing.',
    after: 'Review the demo output for any failures. All demo messages are marked as test traffic.',
  },

  '/mailbox-serve': {
    purpose:
      'Expose the project mailbox through its HTTP bridge — let external agents (Claude Code, scripts, CI) participate.',
    behavior:
      'The command starts a loopback HTTP server wrapping the GlobalMailbox. External agents can send/receive messages via REST endpoints using a bearer token. The server prints its bind URL and writes the token to `.mailbox.token`. External agents appear in the WebUI with `source: http`.',
    before:
      'Ensure the project is initialized. The bridge binds to loopback by default — safe for local development.',
    during:
      'The server prints its URL and routes. Press Ctrl+C to stop. Heartbeat from external agents keeps them visible.',
    after:
      'Stop the bridge when external coordination is complete. The token file is cleaned up on shutdown.',
  },

  '/shadow': {
    purpose:
      'Start and manage a shadow fleet monitor — a background agent that watches fleet health and detects anomalies.',
    behavior:
      'The Shadow Agent runs silently, checking fleet heartbeats, detecting stuck agents, tracking spike tasks (agents that start and die quickly), and monitoring mailbox traffic. `/shadow start` activates it. `/shadow status` shows its current snapshot. `/shadow stop` deactivates it. It can auto-intervene if configured.',
    before:
      'Decide whether you want automatic intervention or observation-only mode.',
    during:
      'The Shadow runs on a cron schedule. Its findings appear as status events in the mailbox.',
    after:
      'Review Shadow reports periodically. Address stuck agents and investigate spike patterns.',
  },

  '/supervisor': {
    purpose:
      'Inspect or configure the Brain-gated Fleet Supervisor — the safety layer that approves or blocks fleet actions.',
    behavior:
      'The Supervisor sits between the Director and the fleet, evaluating every spawn, assign, and tool escalation against Brain risk thresholds. `/supervisor status` shows current state. `/supervisor on` enables it. `/supervisor off` disables it (not recommended for production work).',
    before:
      'Understand the risk implications of disabling the Supervisor. It prevents runaway fleet behavior.',
    during:
      'Status shows recent decisions: approved, blocked, and escalated actions.',
    after:
      'Review blocked actions to understand why they were rejected. Adjust Brain risk levels if the Supervisor is too strict.',
  },

  '/acp': {
    purpose:
      'Discover and run installed ACP coding agents using their existing logins — no extra API keys needed.',
    behavior:
      'ACP (Agent Communication Protocol) lets WrongStack drive external coding agents like Claude Code, Codex CLI, and Gemini CLI. `/acp` lists discovered agents. `/acp probe` tests connectivity. `/acp <agent> "task"` sends work to a specific agent. `/acp parallel a,b "task"` fans to multiple.',
    before:
      'Install the ACP agents you want to use. Run `/acp probe` to verify they are reachable.',
    during:
      'The external agent runs with its own tools and context. Progress is streamed back to WrongStack.',
    after:
      'Review the external agent output. Results are captured in the session transcript.',
  },

  '/hq': {
    purpose:
      'Inspect and control HQ Command Center connectivity for the current surface — connect to remote orchestration.',
    behavior:
      'The HQ Command Center provides a web-based fleet control panel. `/hq` shows connection status. `/hq connect <url>` links to an HQ server. `/hq disconnect` severs the link. When connected, HQ operators can send prompts, steer agents, and monitor fleet status through the web UI.',
    before:
      'Have the HQ server URL ready. Ensure network access and authentication are configured.',
    during:
      'Connection status updates live. HQ prompts appear in your mailbox as steer/btw/queue messages.',
    after:
      'Monitor HQ prompts in your mailbox. Disconnect when you no longer need remote orchestration.',
  },

  // ─── Configure ───────────────────────────────────────────────────────────────

  '/init': {
    purpose:
      'Regenerate .wrongstack/AGENTS.md and back up the existing file first — bootstrap or refresh project configuration.',
    behavior:
      'The command creates or regenerates the project-level AGENTS.md file that defines the agent behavior, conventions, and constraints. If an existing AGENTS.md is found, it is backed up before overwriting. The generated file includes project structure, language settings, and coding conventions.',
    before:
      'Review any existing AGENTS.md — you may want to preserve custom sections before regenerating.',
    during:
      'The backup is created with a timestamp. The new AGENTS.md is written and its path is printed.',
    after:
      'Review the generated AGENTS.md. Edit it to add project-specific conventions that the agent should follow.',
  },

  '/mode': {
    purpose:
      'Switch the session persona — choose from 19 built-in modes including lite, deep, and specialist workflows.',
    behavior:
      'WrongStack ships 19 persona modes: brief, code-reviewer, bug-hunter, refactor-planner, security-scanner, and more. `/mode` lists all modes. `/mode <name>` switches immediately. Each mode adjusts the system prompt, tool preferences, and output style. This is independent from `/context mode` and `/autonomy`.',
    before:
      'Review available modes with `/mode list`. Choose one that matches your current task type.',
    during:
      'The mode switch applies immediately. The next agent turn uses the new persona system prompt.',
    after:
      'Verify the agent behavior matches the mode expectations. Switch back to a general mode when the specialist task is done.',
  },

  '/setmodel': {
    purpose:
      'Set the leader model or role/phase model routing matrix — choose which AI model powers which agent.',
    behavior:
      '`/setmodel <model-id>` changes the model for the current session. You can also set per-role models: `/setmodel --role=security-scanner <model-id>`. `/setmodel --reset` clears custom assignments. Model changes take effect on the next agent turn. Some models have different pricing, speed, and capability profiles.',
    before:
      'Check available models with `/models` or `/modelcaps`. Consider cost, speed, and capability tradeoffs.',
    during:
      'The new model assignment prints for confirmation. Per-role overrides show in a routing table.',
    after:
      'Monitor the first few responses from the new model. Switch back if the quality or style does not match expectations.',
  },

  '/models': {
    purpose:
      'Manage custom model definitions — add, remove, and configure model entries beyond the built-in catalog.',
    behavior:
      '`/models` lists all configured models (built-in + custom). `/models add` registers a new model with provider, context window, pricing, and capability metadata. `/models remove` deletes a custom entry. Custom models appear in `/setmodel` and `/modelcaps` alongside built-ins.',
    before:
      'Have the model metadata ready: provider name, model ID, context window size, and pricing if known.',
    during:
      'Custom model registration validates the metadata and adds it to the registry.',
    after:
      'Verify the new model appears in `/modelcaps` and can be selected with `/setmodel`.',
  },

  '/modelcaps': {
    purpose:
      'Browse model context, capability, and pricing information — compare models before choosing one.',
    behavior:
      'The command prints a browsable table of all registered models with columns: provider, context window, max output tokens, pricing (input/output per 1M tokens), capabilities (vision, reasoning, tool use), and status. Custom models added via `/models` appear alongside built-ins.',
    before: 'No preparation needed. Run it when deciding which model to use for a task.',
    during: 'The table prints with sortable columns. Use search to filter by provider or capability.',
    after:
      'Select a model with `/setmodel <id>`. Consider using cheaper models for simple tasks and premium models for complex work.',
  },

  '/yolo': {
    purpose:
      'Query or toggle automatic tool approval for this session — skip permission prompts when you trust the agent.',
    behavior:
      'By default, tools require confirmation before execution. `/yolo` enables automatic approval — the agent runs tools without asking. `/yolo off` restores confirmations. `/yolo` without arguments shows the current state. YOLO mode is session-scoped and resets on restart. Explicit deny rules still apply.',
    before:
      'Only enable YOLO when you fully trust the agent and the working directory. Review the permission policy first.',
    during:
      'The status line updates to show YOLO is active. Tools execute without prompting.',
    after:
      'Monitor agent actions more closely in YOLO mode. Disable it when you need to review each step.',
  },

  '/settings': {
    purpose:
      'View or change live runtime settings — the unified configuration surface for all WrongStack behavior.',
    behavior:
      '`/settings` prints all current settings grouped by category. `/settings get <key>` reads a specific value. `/settings set <key> <value>` changes it. Settings can be session-only or persisted. The command validates values against expected types and ranges. Use it instead of editing config files directly.',
    before:
      'Check current values with `/settings get <key>` before changing. Some settings have interdependencies.',
    during:
      'Get returns the value immediately. Set validates and applies the change, printing the new effective value.',
    after:
      'Verify the change with `/settings get <key>`. Run `/diag` if the change does not seem to take effect.',
  },

  '/statusline': {
    purpose:
      'Choose which TUI status-bar instruments are visible — customize the information density of your terminal UI.',
    behavior:
      'The TUI status line shows mode, model, token usage, goal, YOLO state, and more. `/statusline` lists available instruments. `/statusline <instrument> on|off` toggles visibility. You can create a minimal bar for focus or a dense bar for full situational awareness.',
    before:
      'Decide which information you need visible at all times vs. what you can check on demand.',
    during:
      'The status bar updates immediately. Changes persist for the session.',
    after:
      'Observe the status bar for a few turns. Adjust if it feels too sparse or too cluttered.',
  },

  '/fallback': {
    purpose:
      'Inspect and configure fallback model behavior — define what happens when the primary model fails or times out.',
    behavior:
      'Fallback chains let you specify backup models. `/fallback` shows the current chain. `/fallback add <model>` appends a fallback. `/fallback remove <model>` removes one. When the primary model errors, times out, or exceeds budget, the next fallback in the chain is tried automatically.',
    before:
      'Identify reliable backup models. Fallbacks should have different failure characteristics than the primary.',
    during:
      'The chain prints in order. Fallback events are logged when they activate.',
    after:
      'Monitor fallback usage in `/stats`. Frequent fallbacks suggest the primary model is unreliable for your workload.',
  },

  '/auth': {
    purpose:
      'Open the API-key status dashboard — view, add, and verify provider authentication.',
    behavior:
      'The command displays all configured API keys (masked), their providers, last validation status, and expiration dates. You can add new keys, re-validate existing ones, and remove expired keys. Keys are stored encrypted with AES-256-GCM per machine.',
    before:
      'Have your API keys ready. Keys are never displayed in full — only the last 4 characters are shown.',
    during:
      'The dashboard prints key status. Validation makes a test request to the provider API.',
    after:
      'Remove unused or expired keys. Re-validate keys that show an unknown status.',
  },

  '/working_dir': {
    purpose:
      'Show or change the live working directory — control where the agent reads and writes files.',
    behavior:
      '`/working_dir` prints the current working directory. `/working_dir <path>` changes it. The new directory must be within the project root. All subsequent file operations (read, write, glob, grep) resolve relative to this directory. The change is session-scoped.',
    before:
      'Verify the target directory exists and is within the project root.',
    during:
      'The new path prints for confirmation. The change applies immediately.',
    after:
      'Run `/working_dir` again to confirm. Relative paths in subsequent commands will resolve from the new location.',
  },

  '/project': {
    purpose:
      'List, add, rename, remove, or switch registered projects — manage your WrongStack workspace.',
    behavior:
      'WrongStack tracks projects with metadata (name, root path, last opened). `/project` lists all registered projects. `/project add <path>` registers a new one. `/project switch <name>` changes the active project. `/project rename <old> <new>` relabels. `/project remove <name>` unregisters.',
    before:
      'Run `/project` to see current projects before adding or switching.',
    during:
      'List shows all projects with the active one highlighted. Switch reloads the project context.',
    after:
      'Verify the active project with `/project`. Session state is per-project, so switching starts a fresh context.',
  },

  '/f': {
    purpose:
      'Open a numbered TUI function-key panel — access common operations through single-key shortcuts.',
    behavior:
      'The TUI function-key bar maps F1–F12 to frequent commands: F1=help, F2=context, F3=fleet, etc. `/f` opens the panel overlay showing all bindings. `/f <number>` triggers that binding directly. The panel is also accessible by pressing the function keys in the TUI.',
    before: 'No preparation needed. Use it as a keyboard-driven alternative to typing slash commands.',
    during: 'The panel overlay shows labeled function keys. Press a key or type `/f <number>`.',
    after: 'The triggered command executes. The panel closes automatically.',
  },

  '/mouse': {
    purpose:
      'Capture mouse events for terminal UI testing — verify click, scroll, and hover behavior in the TUI.',
    behavior:
      'A developer-focused command that enables mouse event logging. Clicks, scrolls, and drags in the terminal are captured and printed with coordinates and event types. Useful for debugging TUI interaction bugs or verifying terminal emulator compatibility.',
    before: 'Ensure your terminal emulator supports mouse reporting.',
    during: 'Mouse events print to the console in real time with event type and coordinates.',
    after: 'Disable mouse capture when done testing to avoid console noise.',
  },

  '/design': {
    purpose:
      'Browse, pin, and materialize a curated Design Studio kit — apply a cohesive design system to UI work.',
    behavior:
      'WrongStack Design Studio offers 48+ curated design kits (neo-brutalist, minimal-clarity, cyberpunk-neon, etc.). `/design list` shows all kits. `/design use <kit-id>` loads and pins one. `/design materialize` writes CSS custom properties and Tailwind v4 @theme tokens to a file. `/design verify` scans UI files for off-palette colors.',
    before:
      'Browse kits with `/design list`. Choose one that matches your project aesthetic.',
    during:
      'Using a kit pins it for the session. Materialize writes tokens to the configured output path.',
    after:
      'Verify your UI components use the design tokens with `/design verify`. Re-materialize after kit changes.',
  },

  // ─── Developer ───────────────────────────────────────────────────────────────

  '/dev': {
    purpose:
      'Run a shell command locally without adding its output to model context — save tokens on diagnostic commands.',
    behavior:
      'The command executes a shell command and prints the output directly to your terminal. The output is NOT added to the agent context window — the agent does not see it. Use it for `ls`, `cat`, `git log`, and other diagnostic commands where you want to see the result but do not need the agent to process it.',
    before:
      'Use when the output is for your eyes only. For agent-visible commands, just type them directly.',
    during:
      'The command runs and output prints to your terminal. The agent does not receive this output.',
    after:
      'If the agent needs the information, run the command again without `/dev`.',
  },

  '/codebase-reindex': {
    purpose:
      'Rebuild the project symbol and codebase search index — refresh the fast search database.',
    behavior:
      'The codebase index powers fast symbol search (`codebase-search` tool) and code understanding. `/codebase-reindex` rebuilds the SQLite+BM25 index from scratch. By default it processes only changed files; use `--force` for a full rebuild. Indexing runs in the background.',
    before:
      'Run when search results seem stale or after pulling new code. A full reindex can take minutes on large repos.',
    during:
      'Progress prints: files indexed, symbols found, languages detected.',
    after:
      'Run `/codebase-reindex` again without `--force` to confirm the index is up to date. Search should now return current results.',
  },

  '/techstack': {
    purpose:
      'Scan dependencies, verify versions, and write a technology report — understand what your project depends on.',
    behavior:
      'The command scans package.json files, lockfiles, and config files across the project. It produces a report: runtime versions, dependency trees, outdated packages, security advisories, and compatibility notes. The report can be printed to the terminal or written to a file.',
    before: 'No preparation needed. Run it when onboarding to a project or before major upgrades.',
    during: 'The scan runs through workspace packages. A summary prints with categories.',
    after:
      'Address critical outdated packages. Run `/audit` for a deeper security review of dependencies.',
  },

  '/worktree': {
    purpose:
      'Inspect and manage git worktrees used by autonomous phases — isolate work without branch switching.',
    behavior:
      'Autonomous phase workflows create git worktrees for isolation. `/worktree list` shows all active worktrees. `/worktree add <path>` creates one manually. `/worktree remove <path>` cleans up. `/worktree prune` removes stale entries. Worktrees let multiple agents work on different branches simultaneously.',
    before:
      'Ensure the working tree is clean before creating worktrees. Stash or commit changes first.',
    during:
      'List shows worktree paths, branches, and status. Add creates a new worktree with a fresh checkout.',
    after:
      'Prune old worktrees to keep the workspace clean. Remove worktrees when their phase is complete.',
  },

  '/audit': {
    purpose:
      'Inspect the side-effect trail for shell, install, and fetch actions — see everything the agent has done.',
    behavior:
      'Every shell command, package install, and network fetch is logged with its full command, exit code, and output summary. `/audit` prints this trail chronologically. `/audit --since <time>` filters by recency. `/audit --tool <name>` filters by tool. Use it to verify the agent did not do anything unexpected.',
    before: 'No preparation needed. Run it after a long agent session to review its actions.',
    during: 'The trail prints with timestamps, commands, exit codes, and truncated output.',
    after:
      'Investigate any unexpected commands. The audit trail is your accountability mechanism.',
  },

  '/security': {
    purpose:
      'Run dependency audit, scan dispatch, and redaction diagnostics — the security health check command.',
    behavior:
      '`/security audit-deps` runs a vulnerability scan on all dependencies. `/security scan` dispatches a security-scanner subagent to review code. `/security redact-test` verifies that secret redaction is working correctly. Results are categorized by severity with actionable fix recommendations.',
    before:
      'Run `/security audit-deps` regularly and before releases. The scan is read-only and safe.',
    during:
      'Audit results show vulnerability counts by severity. The scanner subagent reports findings in real time.',
    after:
      'Address critical and high-severity findings immediately. Re-run the audit after fixes to confirm resolution.',
  },

  '/commit': {
    purpose:
      'Stage changes and create a generated conventional commit — produce well-formed commit messages automatically.',
    behavior:
      'The command stages specified files (or auto-detects changed files), generates a conventional commit message (type, scope, summary, body) from the diff, and creates the commit. You can review the generated message before committing. Supports all conventional commit types: feat, fix, docs, refactor, test, chore, etc.',
    before:
      'Review the diff with `/git diff` first. Know which files you want to commit.',
    during:
      'The generated commit message appears for review. You can edit it before confirming.',
    after:
      'Verify the commit with `/git log`. Push with `/push` when ready.',
  },

  '/git': {
    purpose:
      'Run high-level Git workflow actions through the command surface — status, log, diff, branch, checkout, stash, and more.',
    behavior:
      'The command wraps common git operations with safe defaults and structured output. `/git status` shows working tree state. `/git log` shows commit history. `/git diff` shows changes. `/git branch` manages branches. `/git checkout` switches. `/git stash` shelves changes. All operations are read-only by default unless explicitly mutating.',
    before:
      'Check the working tree state with `/git status` before mutating operations.',
    during:
      'Git output is formatted for readability. Errors include suggestions for resolution.',
    after:
      'Verify the repository state after mutations. Use `/git log` to confirm commits.',
  },

  '/gitcheck': {
    purpose:
      'Silently inspect the working tree for uncommitted changes — a lightweight gate for automation.',
    behavior:
      'The command checks for uncommitted changes (modified, added, deleted, untracked files) and returns a clean/dirty status with a file count. It produces no output beyond the status unless changes are found. Ideal for pre-flight checks in automated workflows.',
    before: 'No preparation needed. Run it before operations that require a clean tree.',
    during: 'Returns instantly — no git operations beyond status check.',
    after:
      'If dirty, review changes with `/git diff`. Commit or stash before proceeding.',
  },

  '/push': {
    purpose:
      'Push the current branch to its configured remote — a safe wrapper around git push.',
    behavior:
      'The command pushes the current branch to its upstream remote. It checks for uncommitted changes first (warning, not blocking). It handles authentication through the configured git credential system. Output shows the push progress and the remote branch update.',
    before:
      'Commit your changes with `/commit`. Verify with `/git log` that the right commits are on the branch.',
    during:
      'Push progress prints. Remote URL and branch name are shown.',
    after:
      'Verify the push succeeded. Check the remote repository if needed.',
  },

  '/gitid': {
    purpose:
      'Inspect or manage Git identity used for repository operations — set name and email for commits.',
    behavior:
      '`/gitid` shows the current git user.name and user.email. `/gitid set name "..."` changes the name. `/gitid set email "..."` changes the email. Changes apply to the repository config by default; use `--global` for global config. The identity is used for commits created by `/commit`.',
    before:
      'Verify your current identity with `/gitid` before making commits.',
    during: 'Identity changes print for confirmation.',
    after:
      'Run `/gitid` again to confirm the change. The next commit will use the new identity.',
  },

  '/doctor': {
    purpose:
      'Diagnose and safely repair configuration problems with backup and history — fix broken setups.',
    behavior:
      'The command runs a series of diagnostic checks: Node.js version, package integrity, config file validity, provider connectivity, permission policy coherence, and plugin compatibility. It reports issues with severity levels and can auto-repair common problems (with backup). Each repair is logged.',
    before:
      'Run when something is not working as expected. The doctor is safe — it backs up before any change.',
    during:
      'Diagnostics run sequentially. Issues are reported as they are found.',
    after:
      'Address any issues the doctor could not auto-repair. Review the repair log for changes made.',
  },

  '/tuneup': {
    purpose:
      'Audit session health, context cost, performance, and reliability settings — optimize your agent configuration.',
    behavior:
      'The command runs a comprehensive health audit: context efficiency, model choice appropriateness, permission policy strictness, plugin overhead, memory utilization, and fleet configuration. `/tuneup` prints recommendations. `/tuneup fix` applies safe optimizations. `/tuneup deep` runs extended diagnostics.',
    before:
      'Run after several sessions or when you notice performance degradation.',
    during:
      'The audit runs multiple checks. Each recommendation includes a rationale and impact estimate.',
    after:
      'Apply recommended fixes with `/tuneup fix`. Review deep diagnostics for systemic issues.',
  },

  // ─── Ecosystem ───────────────────────────────────────────────────────────────

  '/help': {
    purpose:
      'List all commands or open detailed help for one command — your first stop when learning WrongStack.',
    behavior:
      '`/help` prints a categorized list of all available slash commands with one-line summaries. `/help <command>` (without the leading slash) shows detailed help: subcommands, arguments, aliases, and examples. The help output reflects the exact command contracts installed in your current version.',
    before: 'No preparation needed. Run `/help` to explore; `/help <cmd>` to go deep on one command.',
    during: 'Help output is formatted for scannability: categories, command names in bold, summaries.',
    after:
      'Try the command with its simplest invocation. Use `/help` again if you need argument details.',
  },

  '/desktop': {
    purpose:
      'Explain how to access the local WrongStack Desktop application — the Electron-based GUI surface.',
    behavior:
      'The command prints instructions for launching and accessing the WrongStack Desktop application. It checks whether the desktop app is installed, shows the default port, and provides troubleshooting steps for common issues (port conflicts, white screen, connection refused).',
    before: 'Ensure WrongStack is installed. The desktop app may need to be launched separately.',
    during: 'Instructions print with platform-specific notes (Windows, macOS, Linux).',
    after:
      'Open the desktop app URL in your browser or launch the Electron app directly.',
  },

  '/webui': {
    purpose:
      'Explain how to start and access the browser-based WrongStack interface — the WebUI surface.',
    behavior:
      'The command prints instructions for starting the WebUI server and accessing it in a browser. It shows the default bind address (loopback), how to change the port, and security considerations for remote access. The WebUI provides a graphical interface to the same agent kernel.',
    before:
      'Ensure no other service is using the default WebUI port.',
    during:
      'Instructions print with the server start command and the access URL.',
    after:
      'Start the WebUI server and open the URL. The WebUI connects to the same project mailbox as CLI agents.',
  },

  '/tool': {
    purpose:
      'Choose simple or extended tool-description detail — control how much tool metadata the agent sees.',
    behavior:
      'Tool descriptions consume context tokens. `/tool simple` uses minimal descriptions (name + one-liner). `/tool extended` uses full descriptions with parameter details. `/tool` shows the current setting. Simple mode saves tokens; extended mode gives the agent more precise tool understanding.',
    before:
      'Consider your context budget. Extended mode adds ~20% to tool description tokens.',
    during: 'The change applies to the next agent turn. Current turn is unaffected.',
    after:
      'Monitor tool use accuracy. If the agent misuses tools, switch to extended mode.',
  },

  '/tools': {
    purpose:
      'List the complete registered tool inventory — see every tool the agent can use.',
    behavior:
      'The command prints all registered tools grouped by source (core, plugins, MCP). Each entry shows the tool name, description, permission level (auto/confirm/deny), and source. The list includes both built-in tools and those added by plugins and MCP servers.',
    before: 'No preparation needed. Run it to understand the agent capabilities.',
    during: 'The tool list prints in categorized sections. Long lists are paginated.',
    after:
      'Use `/tool` to adjust description detail. Disable unnecessary tools via plugin management or MCP control.',
  },

  '/plugin': {
    purpose:
      'List, inspect, enable, disable, and manage plugins — control WrongStack extensibility.',
    behavior:
      'Plugins add commands, tools, hooks, and skills. `/plugin list` shows all installed plugins with status. `/plugin enable <name>` activates one. `/plugin disable <name>` deactivates. `/plugin inspect <name>` shows what the plugin registers. Plugin state is persisted across sessions.',
    before:
      'Review what a plugin adds before enabling it. Some plugins register tools that consume context.',
    during:
      'List shows plugin names, versions, status, and registration counts.',
    after:
      'Disable unused plugins to reduce context overhead and startup time.',
  },

  '/mcp': {
    purpose:
      'Add, update, discover, restart, and inspect MCP servers — extend WrongStack with external tool providers.',
    behavior:
      'MCP (Model Context Protocol) servers expose tools from external sources (GitHub, filesystem, databases, APIs). `/mcp list` shows connected servers. `/mcp add` registers a new server. `/mcp discover <name>` searches the MCP registry. `/mcp restart <name>` reconnects. `/mcp inspect <name>` shows registered tools.',
    before:
      'Ensure the MCP server is installed and reachable. Some servers require authentication.',
    during:
      'Server status shows connection state and tool count. Discovery searches the registry.',
    after:
      'Verify tools are registered with `/tools`. Restart servers that show connection errors.',
  },

  '/telegram-setup': {
    purpose:
      'Configure a Telegram bot token and default chat — enable Telegram notifications and approvals.',
    behavior:
      'The command guides you through setting up Telegram integration: creating a bot via BotFather, entering the token, and setting a default chat ID. Once configured, the agent can send notifications, request approvals, and receive commands through Telegram.',
    before:
      'Create a Telegram bot via @BotFather and have the token ready.',
    during:
      'The setup wizard prompts for token and chat ID. Validation confirms connectivity.',
    after:
      'Send a test message with `/telegram-settings test`. Approvals can be requested with the telegram_approve tool.',
  },

  '/telegram-settings': {
    purpose:
      'Tune Telegram notification preferences — control what events trigger messages.',
    behavior:
      'The command shows and configures notification preferences: which events trigger Telegram messages (task completion, error, approval request, milestone), notification priority thresholds, and quiet hours. `/telegram-settings test` sends a test message to verify connectivity.',
    before:
      'Decide which events warrant a notification. Too many notifications reduce their value.',
    during:
      'Settings print with current values. Changes apply immediately.',
    after:
      'Send a test message to confirm delivery. Adjust preferences based on notification volume.',
  },

  '/prompts': {
    purpose:
      'Manage the layered project, user, and bundled prompt library — organize reusable prompt templates.',
    behavior:
      'WrongStack maintains a layered prompt library: bundled (shipped with WrongStack), user (~/.wrongstack/prompts), and project (.wrongstack/prompts). `/prompts` lists all prompts with their source layer. Prompts can be searched, favorited, and inserted into the agent context. Layers merge by slug; user overrides project, project overrides bundled.',
    before: 'No preparation needed. Browse prompts to see what templates are available.',
    during: 'The prompt list shows slugs, titles, source layers, and favorite status.',
    after:
      'Insert a prompt with `/prompt <slug>`. Create new prompts with `/prompt-gen`.',
  },

  '/prompt': {
    purpose:
      'Search and insert a reusable prompt — inject a pre-written steering template into the agent context.',
    behavior:
      '`/prompt search <query>` finds matching prompts by title, tag, or content. `/prompt <slug>` inserts that prompt into the next agent turn. Prompts can contain variables that are rendered at insertion time. Favorited prompts appear first in search results.',
    before:
      'Browse available prompts with `/prompts` or search with `/prompt search`.',
    during:
      'Search results show relevance-ranked prompts. Insertion renders variables and adds the prompt to context.',
    after:
      'The inserted prompt steers the next agent turn. Edit or remove it if the effect is not what you wanted.',
  },

  '/prompt-gen': {
    purpose:
      'Author a reusable prompt with model assistance — create high-quality steering templates.',
    behavior:
      'The command opens a prompt authoring workflow. Describe what you want the prompt to do, and the model generates a draft with proper structure, variables, and metadata. You can refine iteratively before saving. Generated prompts are stored in the user or project layer.',
    before:
      'Have a clear idea of the steering behavior you want to capture as a reusable prompt.',
    during:
      'The model generates a draft. You review and iterate. The final version is saved with a slug.',
    after:
      'Test the prompt with `/prompt <slug>`. Refine with `/prompt-gen` again if needed.',
  },

  '/sync': {
    purpose:
      'Sync selected settings, skills, prompts, memory, and history through GitHub — keep machines in sync.',
    behavior:
      'WrongStack can sync configuration artifacts through a GitHub repository. `/sync` shows sync status. `/sync push` uploads local changes. `/sync pull` downloads remote changes. `/sync configure` sets the repository. Conflicts are detected and reported before overwriting.',
    before:
      'Create a GitHub repository for sync. Configure it with `/sync configure <repo-url>`.',
    during:
      'Push and pull show file-level changes. Conflicts are flagged with diff output.',
    after:
      'Verify synced artifacts on the other machine. Run `/sync pull` there to receive changes.',
  },

  '/metrics': {
    purpose:
      'Show a metrics snapshot when observability is enabled — track agent performance over time.',
    behavior:
      'When the observability plugin is active, `/metrics` prints a dashboard of key metrics: session count, average tokens per session, tool success rate, model latency, cost per session, and fleet utilization. Metrics are collected in the background with minimal overhead.',
    before:
      'Enable observability in settings. Metrics collection starts automatically.',
    during:
      'The dashboard prints with current values and trend indicators.',
    after:
      'Use metrics to identify inefficient patterns. Adjust model choices or workflow based on data.',
  },

  '/health': {
    purpose:
      'Run registered health checks when observability is enabled — verify system integrity.',
    behavior:
      'Health checks validate critical subsystems: database connectivity, provider reachability, plugin integrity, permissions policy coherence, and file system access. `/health` runs all checks. `/health <check-name>` runs a specific check. Failures include diagnostic information.',
    before:
      'Enable observability in settings. Health checks are lightweight and safe to run anytime.',
    during:
      'Checks run sequentially. Each prints a pass/fail status with timing.',
    after:
      'Investigate any failing checks. The diagnostic output usually points directly to the root cause.',
  },

  '/skill': {
    purpose:
      'List discovered skills or load one skill body — browse and activate WrongStack extensions.',
    behavior:
      'Skills extend WrongStack with specialized knowledge and workflows. `/skill` lists all discovered skills (bundled, user-installed, project). `/skill <name>` loads and displays a skill full instruction body. Skills auto-activate when their trigger words appear in your request.',
    before:
      'No preparation needed. Browse skills to discover available capabilities.',
    during:
      'The skill list shows names, sources, and trigger descriptions. Loading shows the full skill body.',
    after:
      'Use skill trigger words in your prompts. Install new skills with `/skill-install`.',
  },

  '/skill-gen': {
    purpose:
      'Author a new skill with model guidance — create custom WrongStack extensions.',
    behavior:
      'The command guides you through skill creation: define the trigger words, write the instruction body, set capability requirements, and choose the storage location. The model helps draft the skill content based on your description. Generated skills are immediately available.',
    before:
      'Define what the skill should do and what words should trigger it.',
    during:
      'The authoring workflow steps through metadata, trigger configuration, and content generation.',
    after:
      'Test the skill by using its trigger words. Refine with `/skill-gen` if the behavior needs adjustment.',
  },

  '/skill-search': {
    purpose:
      'Search the configured skill registry — find skills by name, tag, or capability.',
    behavior:
      '`/skill-search <query>` searches across all skill sources: the official registry, GitHub, and local installations. Results show skill name, description, tags, author, and installation status. You can filter by source or capability.',
    before:
      'Have a capability or task type in mind. The search supports natural language queries.',
    during:
      'Results appear ranked by relevance. Already-installed skills are marked.',
    after:
      'Install interesting skills with `/skill-install`. Verify with `/skill <name>`.',
  },

  '/skill-install': {
    purpose:
      'Install a skill from GitHub or the registry — add new capabilities to WrongStack.',
    behavior:
      '`/skill-install user/repo` installs from a GitHub repository. `/skill-install registry:<id>` installs from the official registry. The skill is downloaded, validated, and registered. Installation can be project-scoped or user-scoped. Dependencies are checked before installation.',
    before:
      'Verify the skill source is trustworthy. Review its description and capabilities.',
    during:
      'Download and validation progress prints. Registration confirms the skill is active.',
    after:
      'Verify installation with `/skill <name>`. Test the skill by using its trigger words.',
  },

  '/skill-import': {
    purpose:
      'Import compatible skills from supported foreign locations — bring skills from other AI coding tools.',
    behavior:
      'The command discovers and imports skills from Claude Code, Aider, Continue, and other compatible tools. `/skill-import` scans known locations. `/skill-import <path>` imports from a specific directory. Imported skills are adapted to WrongStack conventions.',
    before:
      'Ensure the foreign tool skills are in their standard locations.',
    during:
      'Discovery lists found skills. Import adapts and registers them.',
    after:
      'Review imported skills — some foreign conventions may need manual adjustment.',
  },

  '/skill-update': {
    purpose:
      'Update installed skills — get the latest versions with bug fixes and new features.',
    behavior:
      '`/skill-update` checks all installed skills for updates. `/skill-update <name>` updates a specific skill. Updates preserve local modifications where possible. The changelog (if available) is shown before updating.',
    before:
      'Review what changed in the skill update. Some updates may change behavior.',
    during:
      'Update progress shows download and validation. The changelog prints if available.',
    after:
      'Verify updated skills still work as expected. Roll back if the update breaks functionality.',
  },

  '/skill-uninstall': {
    purpose:
      'Remove an installed skill — clean up unused or problematic extensions.',
    behavior:
      '`/skill-uninstall <name>` removes a skill and its registration. User data created by the skill is preserved. The command confirms before removal. Bundled skills cannot be uninstalled — they can only be disabled.',
    before:
      'Confirm you no longer need the skill. Uninstallation is reversible only by reinstalling.',
    during:
      'Confirmation prompt appears. Removal is instant after confirmation.',
    after:
      'Verify the skill no longer appears in `/skill list`. Reinstall with `/skill-install` if needed.',
  },
};
