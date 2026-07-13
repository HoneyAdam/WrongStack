// Per-tool detail data for the built-in tool detail pages.
// Generated from the real tool definitions in @wrongstack/tools (name, description,
// inputSchema, selection boundaries). Keys match runtime-catalog.ts toolCatalog names.

export interface ToolParamDetail {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface ToolDetail {
  longDescription: string;
  params: ToolParamDetail[];
  doNotUseWhen?: string[];
  useInstead?: string[];
  notes?: string[];
}

export const toolDetails: Record<string, ToolDetail> = {
  'browser_open': {
    longDescription:
      'Open an isolated first-party Playwright browser session, optionally navigating to a URL.',
    params: [
      {
        name: 'url',
        type: 'string',
        description: 'Optional absolute http(s) URL.',
      },
      {
        name: 'width',
        type: 'integer',
      },
      {
        name: 'height',
        type: 'integer',
      },
      {
        name: 'trace',
        type: 'boolean',
        description: 'Capture a Playwright trace; defaults to true.',
      },
    ],
  },
  'browser_status': {
    longDescription:
      'Check whether first-party Playwright Chromium is installed and ready to launch.',
    params: [],
  },
  'browser_list': {
    longDescription:
      'List browser sessions owned by the current agent without exposing other agents sessions.',
    params: [],
  },
  'browser_navigate': {
    longDescription:
      'Navigate an owned browser session to an approved http(s) URL.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'url',
        type: 'string',
        required: true,
      },
    ],
  },
  'browser_snapshot': {
    longDescription:
      'Return bounded accessibility state plus redacted console and network summaries.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
    ],
  },
  'browser_screenshot': {
    longDescription:
      'Capture a page or element PNG and return sensitive artifact metadata with integrity hash.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'fullPage',
        type: 'boolean',
      },
      {
        name: 'selector',
        type: 'string',
      },
    ],
  },
  'browser_click': {
    longDescription:
      'Click an element in an owned browser session.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'selector',
        type: 'string',
        required: true,
      },
    ],
  },
  'browser_type': {
    longDescription:
      'Fill an input in an owned browser session. Use secretEnv instead of text for credentials so values stay out of tool arguments and session audit.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'selector',
        type: 'string',
        required: true,
      },
      {
        name: 'text',
        type: 'string',
      },
      {
        name: 'secretEnv',
        type: 'string',
        description: 'Host environment variable resolved only at execution time.',
      },
    ],
  },
  'browser_select': {
    longDescription:
      'Select an option in an owned browser session.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'selector',
        type: 'string',
        required: true,
      },
      {
        name: 'value',
        type: 'string',
        required: true,
      },
    ],
  },
  'browser_press': {
    longDescription:
      'Press a keyboard key in an owned browser session.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'key',
        type: 'string',
        required: true,
      },
    ],
  },
  'browser_hover': {
    longDescription:
      'Hover an element in an owned browser session.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'selector',
        type: 'string',
        required: true,
      },
    ],
  },
  'browser_drag': {
    longDescription:
      'Drag one element to another in an owned browser session.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'from',
        type: 'string',
        required: true,
      },
      {
        name: 'to',
        type: 'string',
        required: true,
      },
    ],
  },
  'browser_wait': {
    longDescription:
      'Wait for an element or a bounded duration in an owned browser session.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'selector',
        type: 'string',
      },
      {
        name: 'timeoutMs',
        type: 'integer',
      },
    ],
  },
  'browser_evaluate': {
    longDescription:
      'Evaluate bounded JavaScript in the page. Requires confirmation because page code is arbitrary.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'expression',
        type: 'string',
        required: true,
      },
    ],
  },
  'browser_upload': {
    longDescription:
      'Upload project-local files through a file input in an owned browser session.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
      {
        name: 'selector',
        type: 'string',
        required: true,
      },
      {
        name: 'files',
        type: 'string[]',
        required: true,
      },
    ],
  },
  'browser_close': {
    longDescription:
      'Close an owned browser session, reclaim its context, and return sensitive trace metadata.',
    params: [
      {
        name: 'sessionId',
        type: 'string',
        required: true,
        description: 'Browser session id returned by browser_open.',
      },
    ],
  },
  'e2e_plan': {
    longDescription:
      'Discover Playwright and Cypress projects and preview bounded E2E execution plans without loading configs or starting processes.',
    params: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Directory inside the project to inspect.',
      },
      {
        name: 'framework',
        type: '\'all\' | \'playwright\' | \'cypress\'',
        description: 'Optional framework filter; defaults to all.',
      },
      {
        name: 'maxDepth',
        type: 'integer',
        description: 'Maximum workspace discovery depth; defaults to 5.',
      },
      {
        name: 'includeSpecs',
        type: 'boolean',
        description: 'Count and sample specs; defaults to true.',
      },
    ],
    notes: [
      'Use before running browser E2E tests. The result identifies authoritative configs, package scripts, static server hints, specs, and exact argv.',
    ],
  },
  'read': {
    longDescription:
      'Read the contents of a file with line numbers. This is the primary way to inspect source code, configuration, or any text file before making changes. Lines are returned 1-indexed with a ` N| ` prefix for easy reference in edits.',
    params: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Path to the file (relative to project root or absolute within project).',
      },
      {
        name: 'offset',
        type: 'integer',
        description: '1-based starting line number. Use together with `limit` for large files.',
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum number of lines to return (default is 2000).',
      },
      {
        name: 'mode',
        type: '\'content\' | \'summary\'',
        description: 'Return full line-numbered content (default) or a compact file summary with imports/exports/symbols.',
      },
    ],
    doNotUseWhen: ['you need to search many files for matching content.'],
    useInstead: ['grep'],
    notes: [
      'Always read a file before using `edit`, `replace`, or `write` on it (the system often requires it for safety).',
      'Use `offset` + `limit` for very large files instead of reading everything at once.',
      'Default limit is generous (2000 lines) but can be increased.',
      'Output is capped at 256 KiB.',
    ],
  },
  'write': {
    longDescription:
      'Write or completely overwrite a file on disk. This is a high-privilege operation. For modifying existing files, you should almost always prefer the `edit` tool instead, because `edit` is safer and works on the last-read version of the file.',
    params: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Relative path from project root. Must not escape the project.',
      },
      {
        name: 'content',
        type: 'string',
        required: true,
        description: 'The complete new content of the file.',
      },
    ],
    doNotUseWhen: ['making a precise change to part of an existing file.'],
    useInstead: ['edit'],
    notes: [
      'Use `write` primarily for new files or when you want to replace the entire content.',
      'For any existing file, strongly prefer `edit` (it requires a prior `read` in the same session and is more precise).',
      'You MUST have called `read` on the file earlier in the conversation before using `write` on an existing path (the system enforces this for safety).',
    ],
  },
  'edit': {
    longDescription:
      'Perform a precise, surgical text replacement in a file. This is the preferred tool for modifying existing code. It works best after a prior `read`, but can auto-read the current file when the replacement is still unambiguous.',
    params: [
      {
        name: 'path',
        type: 'string',
        required: true,
      },
      {
        name: 'old_string',
        type: 'string',
        required: true,
      },
      {
        name: 'new_string',
        type: 'string',
        required: true,
      },
      {
        name: 'replace_all',
        type: 'boolean',
      },
    ],
    doNotUseWhen: ['creating a new file, replacing the whole file, or applying an existing unified diff.'],
    useInstead: ['write', 'patch'],
    notes: [
      'Prefer calling `read` on the target file first when planning an edit.',
      'Use a sufficiently unique `old_string` (include surrounding lines/context if needed).',
      'If the string appears multiple times and you want to change all of them, set `replace_all: true`.',
    ],
  },
  'replace': {
    longDescription:
      'Perform a search-and-replace across multiple files using a regex pattern. This is a powerful bulk transformation tool. Dry-run is ON by default — set `dry_run: false` to apply changes.',
    params: [
      {
        name: 'pattern',
        type: 'string',
        required: true,
        description: 'Regex pattern to match',
      },
      {
        name: 'replacement',
        type: 'string',
        required: true,
        description: 'Replacement string',
      },
      {
        name: 'files',
        type: 'string',
        required: true,
        description: 'File(s) to target: single path, comma-separated list, or glob pattern',
      },
      {
        name: 'glob',
        type: 'string',
        description: 'Additional glob filter (e.g. "*.ts")',
      },
      {
        name: 'replace_all',
        type: 'boolean',
        description: 'Replace all occurrences in each file (default: true)',
      },
      {
        name: 'dry_run',
        type: 'boolean',
        description: 'Preview changes without writing (default: true)',
      },
    ],
    notes: [
      'Run without `dry_run: false` first to see exactly what would change (dry-run is the default).',
      'Review the diff output, then re-run with `dry_run: false` to apply.',
      'Use a specific enough `pattern` (and `glob` / `files`) to avoid accidental broad changes.',
    ],
  },
  'glob': {
    longDescription:
      'Find files matching a glob pattern. Fast way to discover relevant files before reading, grepping, or editing them.',
    params: [
      {
        name: 'pattern',
        type: 'string',
        required: true,
        description: 'Glob pattern to match (e.g. "**/*.ts", "src/**").',
      },
      {
        name: 'path',
        type: 'string',
        description: 'Base directory to search from (defaults to project root).',
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum number of results to return (default 1000, max 5000).',
      },
    ],
    doNotUseWhen: ['you need to search inside file contents.'],
    useInstead: ['grep'],
    notes: [
      'Use early to get a list of files you actually care about.',
      'Combine with `path` and `limit`.',
      'Default ignores common build/dependency directories.',
      'Output is capped at 64 KiB.',
    ],
  },
  'grep': {
    longDescription:
      'Search across files using a regular expression. This is one of the primary code search tools. Prefers ripgrep for speed and features when available.',
    params: [
      {
        name: 'pattern',
        type: 'string',
        required: true,
        description: 'Regular expression pattern to search for in file contents.',
      },
      {
        name: 'path',
        type: 'string',
        description: 'Limit search to this directory or file (relative to project root).',
      },
      {
        name: 'glob',
        type: 'string',
        description: 'Glob filter for which files to include (e.g. "**/*.ts", "src/**").',
      },
      {
        name: 'output_mode',
        type: '\'content\' | \'files_with_matches\' | \'count\'',
        description: 'Return style: detailed matches, just file list, or count only.',
      },
      {
        name: 'context_lines',
        type: 'integer',
        description: 'How many lines of surrounding context to include with each match.',
      },
      {
        name: 'case_insensitive',
        type: 'boolean',
        description: 'Ignore case when matching.',
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum number of matches to return.',
      },
    ],
    doNotUseWhen: ['you only need to locate files by name or path pattern.'],
    useInstead: ['glob'],
    notes: [
      '`pattern` is a regular expression.',
      'Use `output_mode: "content"` (default) to get matching lines with context.',
      'Use `"files_with_matches"` when you only need the list of files.',
      'Output is capped at 128 KiB.',
    ],
  },
  'bash': {
    longDescription:
      'Execute an arbitrary command in the user\'s default shell (bash/zsh/pwsh/cmd). stdout and stderr are merged into one stream. This is the most powerful and dangerous tool — it gives the model full access to the developer\'s machine. Prefer specialized tools whenever possible.',
    params: [
      {
        name: 'command',
        type: 'string',
        required: true,
        description: 'The exact shell command to run. Prefer simple, focused commands.',
      },
      {
        name: 'timeout_ms',
        type: 'integer',
        description: 'Optional timeout for this specific command in milliseconds.',
      },
      {
        name: 'background',
        type: 'boolean',
        description: 'If true, launch the process in the background and return the PID immediately.',
      },
    ],
    doNotUseWhen: ['the command is allowlisted and does not require pipes, redirection, or shell expansion.'],
    useInstead: ['exec'],
    notes: [
      'Strongly prefer `exec` for known safe commands (node, npm, pnpm, tsc, git, etc.).',
      'Use bash only when you genuinely need shell features (pipes, redirection, complex one-liners).',
      'Prefer single focused commands over huge `&&` chains.',
      'Output is capped at 32 KiB.',
    ],
  },
  'exec': {
    longDescription:
      'Execute a **whitelisted, restricted set of commands** with strict argument validation. This is the **preferred and safer** alternative to the `bash` tool for running development tools (node, npm, pnpm, tsc, git, tests, linters, etc.). It prevents arbitrary command injection and limits what the model can do.',
    params: [
      {
        name: 'command',
        type: 'string',
        required: true,
        description: 'The base command to run. Must be in the internal allowlist (e.g. "node", "pnpm", "git", "tsc").',
      },
      {
        name: 'args',
        type: 'string[]',
        description: 'Arguments passed to the command. Passed as an array (no shell parsing).',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Optional working directory. Must resolve inside the project root.',
      },
      {
        name: 'timeout',
        type: 'integer',
        description: 'Per-command timeout in milliseconds.',
      },
    ],
    doNotUseWhen: ['the operation requires pipes, redirection, shell expansion, or a non-allowlisted command.'],
    useInstead: ['bash'],
    notes: [
      '`command` must be in the allowlist. Defaults cover JS (node/npm/pnpm/yarn/bun/deno/tsc/vitest/eslint/biome), Go (`go build`/`go test`), Rust (cargo), Python (python/pip), Ruby (gem/bundle), JVM (java/mvn/gradle), .NET (dotnet), native (make/cmake), and git. Users can extend it via `tools.exec.allow` in config.',
      'Arguments are passed as a clean array (no shell interpretation).',
      '`cwd` is validated to stay inside the project.',
    ],
  },
  'fetch': {
    longDescription:
      'Fetch a URL and return its content. HTML pages are automatically converted to clean markdown. This tool has strong SSRF protections (private IPs, localhost, and cloud metadata endpoints are blocked by default).',
    params: [
      {
        name: 'url',
        type: 'string',
        required: true,
        description: 'The target URL (must use https://).',
      },
      {
        name: 'format',
        type: '\'markdown\' | \'text\' | \'raw\'',
        description: 'Output format. "markdown" is recommended for HTML pages.',
      },
    ],
    notes: [
      'Only HTTPS is allowed by default.',
      'Internal/private networks are blocked unless explicitly enabled via environment variable.',
      'Redirects are followed but re-validated at each hop.',
      'Output is capped at 128 KiB.',
    ],
  },
  'search': {
    longDescription:
      'Perform a web search and return results with title, URL, and snippet. Use this when you need up-to-date external information that is not in the local codebase. Results are cached (5 min TTL) and deduplicated by URL.',
    params: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Search query',
      },
      {
        name: 'num_results',
        type: 'integer',
        description: 'Number of results (1-50, default 10)',
      },
      {
        name: 'source',
        type: '\'duckduckgo\' | \'google\' | \'bing\'',
        description: 'Search engine to use (default: duckduckgo)',
      },
      {
        name: 'skip_cache',
        type: 'boolean',
        description: 'Skip the in-memory cache and force a fresh search (default: false)',
      },
    ],
    notes: [
      'Prefer specific queries over very broad ones.',
      'Results go through the guarded fetch system (same protections as the `fetch` tool).',
      'Supports duckduckgo (default), google, and bing sources.',
    ],
  },
  'todo': {
    longDescription:
      'Manage the session-level todo list. This is the primary mechanism for tracking multi-step work. The list is fully replaced on every call (not appended).',
    params: [
      {
        name: 'todos',
        type: 'object[]',
        required: true,
        description: 'The complete new list of todos. This replaces the previous list entirely.',
      },
    ],
    notes: [
      'At the beginning of a non-trivial task, create a clear todo list with specific, actionable items.',
      'Only one item should be `in_progress` at any time.',
      'Update the list frequently as work progresses (mark items done, add new ones, change status).',
    ],
  },
  'plan': {
    longDescription:
      'Manage a session-persistent strategic plan. The plan is written to disk and survives conversation resumptions within the same session, but is isolated to this session — other sessions have their own separate plans. Unlike todos (which are per-turn and lost on restart), a plan tracks high-level progress across multiple turns.',
    params: [
      {
        name: 'action',
        type: '\'show\' | \'add\' | \'start\' | \'done\' | \'remove\' | \'promote\' | \'template_use\' | \'clear\' | \'taskify\'',
        required: true,
        description: 'The operation to perform on the plan board.',
      },
      {
        name: 'title',
        type: 'string',
        description: 'Title of the plan item. Required for action=add.',
      },
      {
        name: 'details',
        type: 'string',
        description: 'Additional details or description for a new plan item (action=add).',
      },
      {
        name: 'target',
        type: 'string',
        description: 'Identifier for the target plan item (id, 1-based index, or partial title). Required for most actions except add/show/clear.',
      },
      {
        name: 'subtasks',
        type: 'string[]',
        description: 'List of subtask titles. Used with promote to break a plan item into multiple todos.',
      },
      {
        name: 'template',
        type: 'string',
        description: 'Template identifier when using action=template_use. Common values: new-feature, bug-fix, refactor, release, security-audit.',
      },
      {
        name: 'scope',
        type: '\'session\' | \'project\'',
        description: 'Storage scope: "session" (default, isolated to this session) or "project" (shared across all sessions for this project).',
      },
    ],
    notes: [
      'Start by creating a high-level plan with `action: "add"` or using templates (`template_use`).',
      'Use `promote` to turn a plan item into actionable todos.',
      'Use `taskify` to convert a plan item into a structured task (with type/priority/deps).',
    ],
  },
  'kanban': {
    longDescription:
      'Manage project-scoped multi-kanban boards stored under .wrongstack/kanbans. Supports board/task/column CRUD, ready-task queues, dependency chains, split/merge, assignment metadata, provider/model/fallback routing hints, goal metrics, success checks, notes, links, and run status updates.',
    params: [
      {
        name: 'action',
        type: '\'list_boards\' | \'get_board\' | \'create_board\' | \'duplicate_board\' | \'update_board\' | \'delete_board\' | \'generate_board\' | \'export_markdown\' | \'export_task_graph\' | \'sync_task_graph\' | \'search_tasks\' | \'ready_tasks\' | \'snapshot\' | \'add_column\' | \'update_column\' | \'delete_column\' | \'add_task\' | \'split_task\' | \'merge_tasks\' | \'copy_task\' | \'transfer_task\' | \'get_task\' | \'update_task\' | \'move_task\' | \'delete_task\' | \'set_chain\' | \'get_chain\' | \'claim_task\' | \'release_task\' | \'assign_task\' | \'mark_assignment\' | \'heartbeat_assignment\' | \'recover_stale\' | \'events\' | \'queue_health\' | \'add_dependency\' | \'add_goal_metric\' | \'update_goal_metric\' | \'add_check\' | \'update_check\' | \'add_note\' | \'add_link\'',
        required: true,
      },
      {
        name: 'boardId',
        type: 'string',
      },
      {
        name: 'taskId',
        type: 'string',
      },
      {
        name: 'taskIds',
        type: 'string[]',
      },
      {
        name: 'chainId',
        type: 'string',
      },
      {
        name: 'columnId',
        type: 'string',
      },
      {
        name: 'targetBoardId',
        type: 'string',
      },
      {
        name: 'targetColumnId',
        type: 'string',
      },
      {
        name: 'title',
        type: 'string',
      },
      {
        name: 'description',
        type: 'string',
      },
      {
        name: 'tags',
        type: 'string[]',
      },
      {
        name: 'labels',
        type: 'string[]',
      },
      {
        name: 'priority',
        type: '\'critical\' | \'high\' | \'medium\' | \'low\'',
      },
      {
        name: 'status',
        type: '\'pending\' | \'ready\' | \'in_progress\' | \'blocked\' | \'review\' | \'completed\' | \'failed\' | \'archived\'',
      },
      {
        name: 'order',
        type: 'number',
      },
      {
        name: 'query',
        type: 'string',
      },
      {
        name: 'limit',
        type: 'number',
      },
      {
        name: 'agentId',
        type: 'string',
      },
      {
        name: 'name',
        type: 'string',
      },
      {
        name: 'role',
        type: 'string',
      },
      {
        name: 'provider',
        type: 'string',
      },
      {
        name: 'model',
        type: 'string',
      },
      {
        name: 'fallbackProfile',
        type: 'string',
      },
      {
        name: 'fallbackModels',
        type: 'string[]',
      },
      {
        name: 'tools',
        type: 'string[]',
      },
      {
        name: 'allowedCapabilities',
        type: 'string[]',
      },
      {
        name: 'leaseId',
        type: 'string',
      },
      {
        name: 'claimedAt',
        type: 'string',
      },
      {
        name: 'heartbeatAt',
        type: 'string',
      },
      {
        name: 'leaseExpiresAt',
        type: 'string',
      },
      {
        name: 'attempt',
        type: 'number',
      },
      {
        name: 'maxAttempts',
        type: 'number',
      },
      {
        name: 'subagentId',
        type: 'string',
      },
      {
        name: 'runTaskId',
        type: 'string',
      },
      {
        name: 'lastResult',
        type: 'string',
      },
      {
        name: 'error',
        type: 'string',
      },
      {
        name: 'assignmentStatus',
        type: '\'assigned\' | \'queued\' | \'running\' | \'completed\' | \'failed\' | \'cancelled\'',
      },
      {
        name: 'releaseStatus',
        type: '\'pending\' | \'ready\' | \'blocked\'',
      },
      {
        name: 'releaseReason',
        type: 'string',
      },
      {
        name: 'clearAssignee',
        type: 'boolean',
      },
      {
        name: 'recoveryMode',
        type: '\'release\' | \'retry\' | \'fail\'',
      },
      {
        name: 'recoveryNow',
        type: 'string',
      },
      {
        name: 'taskGraph',
        type: 'object',
      },
      {
        name: 'graphId',
        type: 'string',
      },
      {
        name: 'specId',
        type: 'string',
      },
      {
        name: 'sourceSystem',
        type: 'string',
      },
      {
        name: 'phaseId',
        type: 'string',
      },
      {
        name: 'preserveOriginTaskIds',
        type: 'boolean',
      },
      {
        name: 'includeArchived',
        type: 'boolean',
      },
      {
        name: 'archiveMissingTasks',
        type: 'boolean',
      },
      {
        name: 'preserveManualDependencies',
        type: 'boolean',
      },
      {
        name: 'dependencyTaskId',
        type: 'string',
      },
      {
        name: 'enforceDependencies',
        type: 'boolean',
      },
      {
        name: 'childTitles',
        type: 'string[]',
      },
      {
        name: 'inheritAssignment',
        type: 'boolean',
      },
      {
        name: 'inheritLabels',
        type: 'boolean',
      },
      {
        name: 'inheritSuccessCriteria',
        type: 'boolean',
      },
      {
        name: 'inheritGoalMetrics',
        type: 'boolean',
      },
      {
        name: 'inheritDependencies',
        type: 'boolean',
      },
      {
        name: 'chainChildren',
        type: 'boolean',
      },
      {
        name: 'rewireDependents',
        type: 'boolean',
      },
      {
        name: 'closeSourceTasks',
        type: 'boolean',
      },
      {
        name: 'metricId',
        type: 'string',
      },
      {
        name: 'metricName',
        type: 'string',
      },
      {
        name: 'metricTarget',
        type: 'string | number',
      },
      {
        name: 'metricCurrent',
        type: 'string | number',
      },
      {
        name: 'metricUnit',
        type: 'string',
      },
      {
        name: 'metricStatus',
        type: '\'pending\' | \'met\' | \'missed\' | \'waived\'',
      },
      {
        name: 'metricNotes',
        type: 'string',
      },
      {
        name: 'checkId',
        type: 'string',
      },
      {
        name: 'checkDescription',
        type: 'string',
      },
      {
        name: 'checkStatus',
        type: '\'pending\' | \'passed\' | \'failed\' | \'skipped\'',
      },
      {
        name: 'note',
        type: 'string',
      },
      {
        name: 'author',
        type: 'string',
      },
      {
        name: 'url',
        type: 'string',
      },
      {
        name: 'linkTitle',
        type: 'string',
      },
      {
        name: 'linkType',
        type: '\'issue\' | \'pr\' | \'doc\' | \'commit\' | \'design\' | \'file\' | \'url\' | \'other\'',
      },
      {
        name: 'context',
        type: 'string',
      },
      {
        name: 'columns',
        type: 'string[]',
      },
      {
        name: 'generatedBy',
        type: 'string',
      },
      {
        name: 'includeTasks',
        type: 'boolean',
      },
      {
        name: 'includeCompletedTasks',
        type: 'boolean',
      },
      {
        name: 'preserveAssignment',
        type: 'boolean',
      },
      {
        name: 'preserveDependencies',
        type: 'boolean',
      },
      {
        name: 'moveTasksToColumnId',
        type: 'string',
      },
    ],
    notes: [
      'Use this for durable project kanban state. Agents should call snapshot/ready_tasks, then claim_task before working.',
    ],
  },
  'task': {
    longDescription:
      'Manage session-persistent structured work items with dependencies, types, and priorities. Unlike `todo` (flat, tactical), `task` supports typed work (feature/bugfix/refactor/etc.), dependencies between items, priority ranking, and agent assignment. Tasks are written to disk and survive session resumes.',
    params: [
      {
        name: 'action',
        type: '\'replace\' | \'add\' | \'status\' | \'show\' | \'promote\' | \'planify\'',
        required: true,
        description: 'replace = set full list, add = append, status = update task status, show = view only, promote = convert task to todos, planify = convert task to plan item.',
      },
      {
        name: 'tasks',
        type: 'object[]',
        description: 'Complete task list. Replaces previous list entirely.',
      },
      {
        name: 'task',
        type: 'object',
        description: 'Single task to append (id/createdAt/updatedAt auto-generated).',
      },
      {
        name: 'id',
        type: 'string',
        description: 'Task id for action=status or target for action=promote.',
      },
      {
        name: 'status',
        type: '\'pending\' | \'in_progress\' | \'blocked\' | \'failed\' | \'review\' | \'completed\'',
        description: 'New status for action=status.',
      },
      {
        name: 'target',
        type: 'string',
        description: 'Target task identifier (id, 1-based index, or title substring) for action=promote.',
      },
      {
        name: 'subtasks',
        type: 'string[]',
        description: 'Optional subtask titles for action=promote. Each becomes a pending todo.',
      },
      {
        name: 'scope',
        type: '\'session\' | \'project\'',
        description: 'Storage scope: "session" (default, isolated to this session) or "project" (shared across all sessions for this project).',
      },
    ],
    notes: [
      '`action: "replace"` — set the complete task list (tasks ordered by priority)',
      '`action: "status"` — update a task\'s status (e.g. pending→in_progress, in_progress→completed)',
    ],
  },
  'git': {
    longDescription:
      'Safe wrapper around common git operations. Supports status, log, diff, commit, branch, checkout, stash, push, pull, fetch, reset, worktree, etc. This is the preferred way to interact with git instead of using the raw `bash` or `exec` tools.',
    params: [
      {
        name: 'command',
        type: '\'status\' | \'log\' | \'diff\' | \'commit\' | \'branch\' | \'checkout\' | \'stash\' | \'push\' | \'pull\' | \'fetch\' | \'reset\' | \'worktree\'',
        required: true,
        description: 'Git subcommand',
      },
      {
        name: 'files',
        type: 'string',
        description: 'File(s) for status/diff: single path, comma-separated list, or "**/*.ts" glob',
      },
      {
        name: 'message',
        type: 'string',
        description: 'Commit message (required for commit)',
      },
      {
        name: 'branch',
        type: 'string',
        description: 'Branch name for checkout/branch',
      },
      {
        name: 'format',
        type: '\'short\' | \'oneline\' | \'stat\' | \'graph\'',
        description: 'Log format (default: short)',
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Limit for log (default: 20)',
      },
      {
        name: 'dry_run',
        type: 'boolean',
        description: 'For commit: show what would be committed',
      },
      {
        name: 'worktreeAction',
        type: '\'list\' | \'add\' | \'remove\' | \'prune\'',
        description: 'Worktree action: list, add, remove, prune',
      },
      {
        name: 'worktreePath',
        type: 'string',
        description: 'Path for worktree add/remove (e.g. "../wt-feature-xyz")',
      },
      {
        name: 'newBranch',
        type: 'boolean',
        description: 'Create new branch when adding worktree',
      },
      {
        name: 'force',
        type: 'boolean',
        description: 'Force operation (e.g. worktree remove --force)',
      },
    ],
    notes: [
      '`command`: one of the supported subcommands (status, log, diff, commit, etc.)',
      'Use `message` only for commit operations.',
      'Use `files` array for operations that take paths (status, diff, add, etc.).',
    ],
  },
  'patch': {
    longDescription:
      'Apply a unified diff (patch) to the project. This is the correct tool when you have a diff that needs to be applied precisely, including handling of rejects.',
    params: [
      {
        name: 'patch',
        type: 'string',
        required: true,
        description: 'Unified diff patch content',
      },
      {
        name: 'directory',
        type: 'string',
        description: 'Root directory for patch (default: cwd)',
      },
      {
        name: 'strip',
        type: 'integer',
        description: 'Strip leading path components (default: 1)',
      },
      {
        name: 'dry_run',
        type: 'boolean',
        description: 'Preview without applying',
      },
    ],
    doNotUseWhen: ['you do not already have a unified diff or only need one precise replacement.'],
    useInstead: ['edit'],
    notes: [
      'Use `dry_run: true` to see what would happen without modifying files.',
      'On failure it creates .rej and .orig files for manual review.',
    ],
  },
  'json': {
    longDescription:
      'Parse, pretty-print, query, validate, transform, and merge JSON/JSON5/YAML. Use `action` to select the operation: parse (default), query, validate, transform, or merge.',
    params: [
      {
        name: 'action',
        type: '\'parse\' | \'query\' | \'validate\' | \'transform\' | \'merge\'',
        description: 'Operation (default: parse). parse=read/pretty-print, query=JMESPath, validate=schema, transform=chained queries, merge=deep merge.',
      },
      {
        name: 'file',
        type: 'string',
        description: 'Path to JSON/JSON5/YAML file (parse/query/validate)',
      },
      {
        name: 'data',
        type: 'string',
        description: 'JSON/JSON5/YAML string (parse/query/validate, alternative to file)',
      },
      {
        name: 'format',
        type: '\'json\' | \'json5\' | \'yaml\'',
        description: 'Output format for parse/query/transform (default: json)',
      },
      {
        name: 'query',
        type: 'string',
        description: 'JMESPath-like query expression (query action)',
      },
      {
        name: 'transforms',
        type: 'string[]',
        description: 'Ordered JMESPath query strings (transform action)',
      },
      {
        name: 'schema',
        type: 'object',
        description: 'JSON Schema to validate against (validate action)',
      },
      {
        name: 'base',
        type: 'object',
        description: 'Base JSON object (merge action)',
      },
      {
        name: 'patch',
        type: 'object',
        description: 'Patch JSON object to merge in (merge action)',
      },
      {
        name: 'conflictResolution',
        type: '\'prefer-base\' | \'prefer-patch\'',
        description: 'Merge conflict resolution (default: prefer-patch)',
      },
      {
        name: 'validate',
        type: 'boolean',
        description: 'Validate syntax only, no output (parse action, default: false)',
      },
    ],
    notes: [
      '`action: "parse"` (default): read/pretty-print/convert JSON, JSON5, or YAML from `file` or `data`.',
      '`action: "query"`: JMESPath-like query (`a.b[0].c`, `items[*].name`, filters, functions).',
      '`action: "validate"`: validate data against a JSON Schema (`schema` param).',
    ],
  },
  'diff': {
    longDescription:
      'Show file content with line numbers, staged/working-tree diffs via git, or commit/branch diffs. A safer and more structured alternative to raw `git diff` via shell.',
    params: [
      {
        name: 'path',
        type: 'string',
        description: 'Working directory for the diff operation (defaults to project root).',
      },
      {
        name: 'files',
        type: 'string',
        description: 'Files or globs to diff (e.g. "src/**/*.ts" or comma-separated list).',
      },
      {
        name: 'a',
        type: 'string',
        description: 'First ref/commit/branch for git diff (e.g. HEAD, main, a commit hash).',
      },
      {
        name: 'b',
        type: 'string',
        description: 'Second ref/commit/branch for git diff.',
      },
      {
        name: 'staged',
        type: 'boolean',
        description: 'If true, only show changes that are staged in git.',
      },
      {
        name: 'mode',
        type: '\'unified\' | \'side-by-side\' | \'stat\'',
        description: 'Output format. "unified" is default, "stat" shows summary only.',
      },
      {
        name: 'context',
        type: 'integer',
        description: 'Number of context lines for unified diffs (default: 3).',
      },
    ],
    notes: [
      '`files` + no `a`/`b` → show file content with line numbers (NOT a unified diff; no +/- prefixes).',
      '`a` and/or `b` → git-style commit/branch diff (unified format, real +/- prefixes).',
      '`staged: true` → only show staged changes.',
    ],
  },
  'tree': {
    longDescription:
      'Display a directory tree of the project (or a subpath). This is the recommended way to explore the high-level structure of a codebase before reading specific files.',
    params: [
      {
        name: 'path',
        type: 'string',
        description: 'Root directory to display the tree from (defaults to project root).',
      },
      {
        name: 'depth',
        type: 'integer',
        description: 'Maximum directory depth to traverse (default 3, use 0 for unlimited).',
      },
      {
        name: 'glob',
        type: 'string',
        description: 'Only include files matching this glob pattern.',
      },
      {
        name: 'exclude',
        type: 'string[]',
        description: 'List of directory names to completely ignore.',
      },
      {
        name: 'show_files',
        type: 'boolean',
        description: 'Whether to show individual files (default true).',
      },
      {
        name: 'show_dirs',
        type: 'boolean',
        description: 'Whether to show directories (default true).',
      },
      {
        name: 'show_hidden',
        type: 'boolean',
        description: 'Show hidden files starting with . (default: false)',
      },
    ],
    notes: [
      'Call early when working with an unfamiliar project or module.',
      'Tune `depth` (default 3) and use `glob`/`exclude` to focus the view.',
      'Prefer this over raw `bash find` or `glob` + manual reading when you need a quick structural overview.',
    ],
  },
  'lint': {
    longDescription:
      'Run the project linter (primarily Biome in this repo). Detects style violations, potential bugs, and formatting issues.',
    params: [
      {
        name: 'files',
        type: 'string',
        description: 'Files/patterns: single path, comma-separated list, or glob (e.g. "src/**/*.ts")',
      },
      {
        name: 'fix',
        type: 'boolean',
        description: 'Auto-fix fixable issues (default: false)',
      },
      {
        name: 'linter',
        type: '\'biome\' | \'eslint\' | \'tslint\' | \'auto\'',
        description: 'Linter to use (default: auto-detect)',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
    ],
    notes: [
      '`fix: true` will automatically correct what it can.',
      'Target specific files or globs when you only want to check part of the project.',
    ],
  },
  'format': {
    longDescription:
      'Format source files according to project style (Biome). Can also run in check-only mode.',
    params: [
      {
        name: 'files',
        type: 'string',
        description: 'Files/patterns: single path, comma-separated list, or glob',
      },
      {
        name: 'fixer',
        type: '\'biome\' | \'prettier\' | \'auto\'',
        description: 'Formatter to use (default: auto-detect)',
      },
      {
        name: 'check',
        type: 'boolean',
        description: 'Verify only, do not modify files (default: false)',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
    ],
    notes: [
      'Use on changed files before committing.',
      '`check: true` verifies formatting without making changes (useful in CI-like flows).',
    ],
  },
  'typecheck': {
    longDescription:
      'Run the project\'s TypeScript type checker (`tsc --noEmit` or equivalent). Essential for verifying type safety before making changes or committing.',
    params: [
      {
        name: 'project',
        type: 'string',
        description: 'Path to tsconfig.json (default: auto-detect)',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
      {
        name: 'strict',
        type: 'boolean',
        description: 'Add --strict flag for maximum type checking (default: false)',
      },
      {
        name: 'all',
        type: 'boolean',
        description: 'Type-check all projects (pnpm -r) (default: false)',
      },
      {
        name: 'json',
        type: 'boolean',
        description: 'Emit JSON output from tsc (default: false)',
      },
    ],
    notes: [
      'Use this to catch type errors early.',
      'In monorepos, `all: true` will check every package.',
      'This is one of the most important quality gates in this project.',
    ],
  },
  'test': {
    longDescription:
      'Execute the project\'s test suite. This is one of the most critical tools for validating that your changes are correct.',
    params: [
      {
        name: 'files',
        type: 'string',
        description: 'Test files: single path, comma-separated list, or glob (e.g. "**/*.test.ts")',
      },
      {
        name: 'runner',
        type: '\'vitest\' | \'jest\' | \'mocha\' | \'auto\'',
        description: 'Test runner (default: auto-detect)',
      },
      {
        name: 'watch',
        type: 'boolean',
        description: 'Run in watch mode (default: false)',
      },
      {
        name: 'coverage',
        type: 'boolean',
        description: 'Generate coverage report (default: false)',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
      {
        name: 'grep',
        type: 'string',
        description: 'Filter tests by name pattern (default: none)',
      },
      {
        name: 'timeout',
        type: 'integer',
        description: 'Test timeout in ms (default: 30000)',
      },
      {
        name: 'verbose',
        type: 'boolean',
        description: 'Per-test verbose reporter output (default: false — the summary reporter is used; full output is always saved to a log file referenced in the result)',
      },
    ],
    notes: [
      'Use `files` or `grep` to run only relevant tests during development.',
      '`coverage: true` is useful when working on critical paths.',
    ],
  },
  'language_info': {
    longDescription:
      'Detect language workspaces and preview predefined language-specific command plans without executing them.',
    params: [
      {
        name: 'action',
        type: '\'detect\' | \'plan\' | \'capabilities\'',
        required: true,
        description: 'Read-only action to perform.',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Directory inside the project to inspect.',
      },
      {
        name: 'target',
        type: 'string',
        description: 'Optional target file used for workspace selection.',
      },
      {
        name: 'language',
        type: '\'typescript\' | \'javascript\' | \'go\' | \'rust\' | \'php\' | \'csharp\' | \'python\' | \'java\' | \'ruby\' | \'c\' | \'cpp\' | \'swift\' | \'dart\' | \'elixir\' | \'deno\' | \'shell\'',
        description: 'Optional language profile filter.',
      },
      {
        name: 'workspace',
        type: 'string',
        description: 'Workspace id or root returned by detect.',
      },
      {
        name: 'operation',
        type: '\'syntax\' | \'semantic\' | \'lint\' | \'format-check\' | \'format-write\' | \'test-compile\' | \'test\' | \'build\' | \'run\' | \'debug-compile\' | \'debug-test\' | \'debug-runtime\' | \'debug-race\' | \'package-install\' | \'package-add\' | \'package-remove\' | \'package-update\' | \'package-audit\' | \'package-outdated\'',
        description: 'Operation to preview when action=plan.',
      },
      {
        name: 'mode',
        type: '\'fast\' | \'standard\' | \'thorough\'',
        description: 'Planning mode.',
      },
      {
        name: 'options',
        type: 'object',
      },
    ],
    doNotUseWhen: ['You need to execute a compiler, test runner, formatter, or package manager.'],
    useInstead: ['exec', 'typecheck', 'lint', 'format', 'test', 'install'],
    notes: [
      'Use `detect` to find TypeScript/JavaScript, Go, Rust, PHP, and C# workspaces. Use `plan` to obtain an exact, validated argv plan before choosing an execution tool.',
    ],
  },
  'language': {
    longDescription:
      'Execute predefined language-specific checks, linters, formatters, tests, builds, and debugging evidence.',
    params: [
      {
        name: 'action',
        type: '\'check\' | \'lint\' | \'format\' | \'test\' | \'build\' | \'debug\'',
        required: true,
        description: 'Language operation to execute.',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Directory inside the project.',
      },
      {
        name: 'target',
        type: 'string',
        description: 'Optional target file for workspace selection.',
      },
      {
        name: 'language',
        type: '\'typescript\' | \'javascript\' | \'go\' | \'rust\' | \'php\' | \'csharp\' | \'python\' | \'java\' | \'ruby\' | \'c\' | \'cpp\' | \'swift\' | \'dart\' | \'elixir\' | \'deno\' | \'shell\'',
        description: 'Optional language filter.',
      },
      {
        name: 'workspace',
        type: 'string',
        description: 'Detected workspace id or root.',
      },
      {
        name: 'mode',
        type: '\'fast\' | \'standard\' | \'thorough\'',
      },
      {
        name: 'check',
        type: '\'syntax\' | \'semantic\' | \'all\'',
      },
      {
        name: 'formatCheck',
        type: 'boolean',
        description: 'Verify formatting without writing (default true).',
      },
      {
        name: 'filter',
        type: 'string',
        description: 'Validated test/debug filter passed to profile adapters.',
      },
      {
        name: 'coverage',
        type: 'boolean',
      },
      {
        name: 'noRun',
        type: 'boolean',
        description: 'Compile tests without running when supported.',
      },
      {
        name: 'debug',
        type: '\'compile\' | \'test\' | \'runtime\' | \'race\'',
      },
    ],
    doNotUseWhen: ['You only need workspace detection/planning, or need to modify dependencies.'],
    useInstead: ['language_info', 'install', 'audit', 'outdated'],
    notes: [
      'Use this instead of constructing compiler or test commands manually. The tool detects the workspace, builds an allowlisted argv plan, revalidates it, executes without a shell, and returns normalized diagnostics.',
    ],
  },
  'language_package': {
    longDescription:
      'Restore, mutate, audit, or report outdated packages via predefined ecosystem-specific plans.',
    params: [
      {
        name: 'operation',
        type: '\'install\' | \'add\' | \'remove\' | \'update\' | \'audit\' | \'outdated\'',
        required: true,
        description: 'Package management operation to perform.',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Directory inside the project.',
      },
      {
        name: 'language',
        type: '\'typescript\' | \'javascript\' | \'go\' | \'rust\' | \'php\' | \'csharp\' | \'python\' | \'java\' | \'ruby\' | \'c\' | \'cpp\' | \'swift\' | \'dart\' | \'elixir\' | \'deno\' | \'shell\'',
        description: 'Optional language profile filter.',
      },
      {
        name: 'workspace',
        type: 'string',
        description: 'Detected workspace id or root.',
      },
      {
        name: 'names',
        type: 'string[]',
        description: 'Validated package names. Required for add/remove/update; optional for install.',
      },
      {
        name: 'scope',
        type: '\'runtime\' | \'development\' | \'optional\'',
        description: 'Where to record the dependency (add/update).',
      },
      {
        name: 'dryRun',
        type: 'boolean',
        description: 'Preview the install without modifying the workspace.',
      },
      {
        name: 'allowScripts',
        type: 'boolean',
        description: 'Opt in to running package lifecycle scripts (preinstall/install/postinstall). Default false.',
      },
    ],
    doNotUseWhen: ['You only need to inspect or plan, or need to compile/test/lint without touching dependencies.'],
    useInstead: ['language_info', 'language', 'install', 'audit', 'outdated'],
    notes: [
      'Use this instead of the legacy `install`/`audit`/`outdated` tools. The tool detects the workspace, builds an allowlisted argv plan with lifecycle scripts disabled, runs it, and records manifest/lockfile changes.',
    ],
  },
  'install': {
    longDescription:
      'Install, update or manage packages using the detected package manager (pnpm/npm/yarn). Strongly preferred over raw shell commands for dependency management because it is structured and safer.',
    params: [
      {
        name: 'packages',
        type: 'string',
        description: 'Package(s) to install: single name, comma-separated list, or empty for all deps',
      },
      {
        name: 'save',
        type: '\'dependency\' | \'dev\' | \'optional\'',
        description: 'Where to save the package(s): "dependency", "devDependencies", or "optionalDependencies".',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory for the install command (must stay inside project).',
      },
      {
        name: 'dry_run',
        type: 'boolean',
        description: 'If true, show what would be installed without actually modifying package.json or node_modules.',
      },
      {
        name: 'global',
        type: 'boolean',
        description: 'Whether to perform a global install (use with caution).',
      },
      {
        name: 'lifecycleScripts',
        type: 'boolean',
        description: 'Opt in to running package lifecycle scripts (preinstall / install / postinstall / prepare / …). Default: false — installs pass --ignore-scripts so a malicious package cannot execute arbitrary code at install time. Set true to opt back in to the legacy npm/pnpm/yarn default.',
      },
    ],
    notes: [
      'Empty `packages` → normal `install` (respects lockfile).',
      'Provide names → adds/updates specific packages.',
      '`dry_run: true` for safe preview.',
    ],
  },
  'audit': {
    longDescription:
      'Run a security audit against project dependencies (using pnpm/npm audit). Reports known vulnerabilities with severity.',
    params: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
      {
        name: 'level',
        type: '\'low\' | \'moderate\' | \'high\' | \'critical\'',
        description: 'Minimum severity level to report',
      },
      {
        name: 'fix',
        type: 'boolean',
        description: 'Attempt to fix vulnerabilities (default: false)',
      },
      {
        name: 'packages',
        type: 'string',
        description: 'Specific package(s) to audit (comma-separated)',
      },
    ],
    notes: [
      'Run regularly and especially before any release.',
      'Use `level` to focus on high/critical issues.',
      '`fix` can attempt automatic remediation for some vulnerabilities.',
    ],
  },
  'outdated': {
    longDescription:
      'Check for outdated dependencies in the project. Reports current, wanted (semver range), and latest versions available.',
    params: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
      {
        name: 'format',
        type: '\'list\' | \'table\'',
        description: 'Output format (default: list)',
      },
      {
        name: 'include_deprecated',
        type: 'boolean',
        description: 'Include deprecated packages (default: false)',
      },
      {
        name: 'check',
        type: 'string',
        description: 'Specific package(s) to check (comma-separated)',
      },
    ],
    notes: [
      'Run periodically or before dependency-related work.',
      'Helps surface packages that may need updates for security or features.',
      'Hits the package registry over HTTP, so it is NOT purely local — flagged as mutating for the confirmation gate.',
    ],
  },
  'logs': {
    longDescription:
      'Read or stream logs from files, Docker containers, or systemd services. Useful for debugging running applications.',
    params: [
      {
        name: 'service',
        type: 'string',
        description: 'Service name for Docker or systemd journal',
      },
      {
        name: 'path',
        type: 'string',
        description: 'Path to log file (alternative to service)',
      },
      {
        name: 'lines',
        type: 'integer',
        description: 'Number of log lines to fetch (default: 100, 0 for all)',
      },
      {
        name: 'stream',
        type: 'boolean',
        description: 'Stream logs continuously (like tail -f) (default: false)',
      },
      {
        name: 'filter',
        type: 'string',
        description: 'Regex pattern to filter log lines',
      },
      {
        name: 'since',
        type: '\'1h\' | \'6h\' | \'24h\' | \'all\'',
        description: 'Only show logs since duration',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
    ],
    notes: [
      'Prefer `path` for local files or `service` for containers/systemd.',
      '`stream: true` = live tail (can be expensive).',
      'Always use `filter` (regex) when possible to reduce noise and token usage.',
    ],
  },
  'document': {
    longDescription:
      'DEPRECATED — use the `auto_doc` tool with `dryRun: true` instead. This tool is a read-only preview stub that returns `skipped` candidates without generating real docstrings.',
    params: [
      {
        name: 'target',
        type: '\'file\' | \'function\' | \'class\' | \'type\' | \'all\'',
        description: 'What to document',
      },
      {
        name: 'path',
        type: 'string',
        description: 'Specific file path to document',
      },
      {
        name: 'files',
        type: 'string',
        description: 'File(s) to process: single path, comma-separated list, or glob',
      },
      {
        name: 'style',
        type: '\'jsdoc\' | \'tsdoc\' | \'block\'',
        description: 'Documentation style (default: jsdoc)',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
    ],
    notes: [
      'Deprecated: prefer `auto_doc` with `dryRun: true` for previewing, or `auto_doc` without dryRun for writing. This tool only lists undocumented symbols with placeholder comments — it does not generate real JSDoc/TSDoc.',
    ],
  },
  'scaffold': {
    longDescription:
      'Generate new files and folder structures from built-in templates or custom definitions. This is the recommended way to bootstrap new packages, components, or modules instead of creating files one by one with `write`.',
    params: [
      {
        name: 'template',
        type: 'string',
        required: true,
        description: 'Template name (npm-package, cli-tool, react-component) or path to template directory',
      },
      {
        name: 'name',
        type: 'string',
        required: true,
        description: 'Project/component name (used in generated files)',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: cwd)',
      },
      {
        name: 'vars',
        type: 'object',
        description: 'Template variables for custom templates',
      },
      {
        name: 'dry_run',
        type: 'boolean',
        description: 'Preview generated files without creating (default: false)',
      },
    ],
    notes: [
      'Use built-in templates when they match your needs (e.g. react-component, npm-package).',
      'Supports `dry_run` so you can preview exactly what will be created.',
      'Has the powerful `fs.write.outside-project` capability — review paths carefully.',
    ],
  },
  'design': {
    longDescription:
      'Browse, load, customize, and enforce curated frontend/mobile UI design kits. Use BEFORE writing UI code to commit to one coherent, modern, responsive, dark/light, accessible design. Actions: "list" (menu), "use" (load+pin a kit for a stack), "foundations" (baseline), "set" (override kit colors/tokens), "materialize" (write the tokens to a real theme file — CSS @theme/OKLCH or native), "verify" (scan UI files for off-palette colors).',
    params: [
      {
        name: 'action',
        type: '\'list\' | \'use\' | \'foundations\' | \'set\' | \'materialize\' | \'verify\'',
        description: 'list = menu; use = load+pin a kit; foundations = baseline; set = override colors/tokens; materialize = write tokens to a theme file; verify = scan UI for off-palette colors. Default: list.',
      },
      {
        name: 'kit',
        type: 'string',
        description: 'Kit id (required for "use"), e.g. "minimal-clarity", "neo-brutalist".',
      },
      {
        name: 'stack',
        type: '\'web\' | \'react-native\' | \'flutter\' | \'swiftui\' | \'compose\'',
        description: 'Target stack — narrows guidance + materialize format. Default: web.',
      },
      {
        name: 'set',
        type: 'object',
        description: 'Token overrides for "set"/"use": { "primary": "oklch(…)", "dark.bg": "#111" }. Bare key = both themes; "light."/"dark." prefix = that theme only. Empty value clears an override.',
      },
      {
        name: 'out',
        type: 'string',
        description: 'Materialize output path (project-relative). Defaults to a per-stack convention.',
      },
      {
        name: 'force',
        type: 'boolean',
        description: 'Materialize: overwrite an existing file (default false — refuses to clobber).',
      },
      {
        name: 'files',
        type: 'string[]',
        description: 'Verify: explicit project-relative files to scan. Default: a bounded UI-file walk.',
      },
    ],
    notes: [
      'Flow: `design {action:"use", kit:"minimal-clarity", stack:"web"}` → optionally `design {action:"set", set:{primary:"oklch(62% 0.2 25)"}}` → `design {action:"materialize"}` to write tokens to disk → implement against them → `design {action:"verify"}`.',
    ],
  },
  'tool_search': {
    longDescription:
      'Search the catalog of available tools by name or description. Use this to discover which tool to use for a task. For the full schema and usage details of a specific tool, use `tool_help` instead.',
    params: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query for tool name or description',
      },
      {
        name: 'tags',
        type: 'string[]',
        description: 'Filter by tags (e.g. "filesystem", "network", "dev")',
      },
      {
        name: 'permission',
        type: '\'auto\' | \'confirm\' | \'deny\'',
        description: 'Filter by required permission level',
      },
      {
        name: 'mutating',
        type: 'boolean',
        description: 'Filter by mutating flag (true=filters that modify, false=read-only)',
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum results to return (default: 20)',
      },
    ],
    notes: [
      'Use when you need to find the right tool for a job.',
      '`query` searches names and descriptions.',
      'You can filter by `tags` (category), `permission`, or `mutating`.',
    ],
  },
  'tool_use': {
    longDescription:
      'Directly execute any registered tool by its exact name, bypassing normal discovery. This is a powerful meta-tool intended for cases where the agent has a clear plan and knows precisely which tool to invoke.',
    params: [
      {
        name: 'tool',
        type: 'string',
        required: true,
        description: 'The exact registered name of the tool to invoke (e.g. "bash", "read", "codebase-search").',
      },
      {
        name: 'input',
        type: 'object',
        description: 'The input object matching the target tool\'s inputSchema.',
      },
    ],
    notes: [
      'Only use when you are certain of the exact tool name and its expected input shape.',
      'Prefer using the normal tool calling mechanism when possible.',
      'Very useful in batch-tool-use or when orchestrating complex workflows programmatically.',
    ],
  },
  'batch_tool_use': {
    longDescription:
      'Execute a batch of tool calls either sequentially or in parallel. Returns structured results for every call.',
    params: [
      {
        name: 'calls',
        type: 'object[]',
        required: true,
        description: 'Array of tool calls to execute',
      },
      {
        name: 'stop_on_error',
        type: 'boolean',
        description: 'Stop execution on first error (default: false)',
      },
      {
        name: 'parallel',
        type: 'boolean',
        description: 'Execute calls in parallel (default: true)',
      },
    ],
    notes: [
      'Useful when you have a clear list of independent operations to perform.',
      '`parallel: true` (default) runs them concurrently for speed.',
      '`stop_on_error: true` makes it fail fast on the first error.',
    ],
  },
  'tool_help': {
    longDescription:
      'Get detailed help for a specific tool, including its full input schema and usage guidance. If you do not know which tool to use, search with `tool_search` first, then call this with the tool name.',
    params: [
      {
        name: 'tool',
        type: 'string',
        description: 'Specific tool name to get detailed help for. Omit to get a list of all tools.',
      },
      {
        name: 'format',
        type: '\'short\' | \'full\' | \'markdown\'',
        description: 'Level of detail: "short" (summary), "full" (with full schema), "markdown" (human readable).',
      },
      {
        name: 'include_examples',
        type: 'boolean',
        description: 'Whether to include example usage in the response.',
      },
    ],
    notes: [
      'Call with a specific `tool` name when you want the full schema and current usageHint.',
      'Omit `tool` to get an overview of all available tools.',
      'Different `format` options give you different levels of detail.',
    ],
  },
  'codebase-index': {
    longDescription:
      'Build or incrementally update the project-wide symbol index. This powers fast codebase search and understanding. By default it only processes files that have changed since the last indexing run.',
    params: [
      {
        name: 'force',
        type: 'boolean',
        description: 'Force a full reindex — clears the index first and reindexes all files.',
      },
      {
        name: 'langs',
        type: 'string[]',
        description: 'Limit reindex to specific languages: ts, tsx, js, jsx, go, py, rs',
      },
    ],
    notes: [
      'First run (or after major changes): consider `force: true` for a clean rebuild.',
      'Normal usage: call without arguments for fast incremental updates.',
      'Use `langs` to restrict to specific languages if you only care about certain parts of the project.',
    ],
  },
  'codebase-search': {
    longDescription:
      'Search code symbols using a fast SQLite+BM25 index, with optional LSP fallback. Much more powerful and structured than raw `grep` for finding code by name or concept. Set `preferLsp: true` for live precision when the LSP plugin is active (supersedes codebase-lsp-search).',
    params: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Search query — searches symbol names, signatures, and doc comments',
      },
      {
        name: 'kind',
        type: 'string',
        description: 'Filter by symbol kind: class, function, interface, method, const, let, var, property, type, enum',
      },
      {
        name: 'lang',
        type: 'string',
        description: 'Filter by language: ts, tsx, js, jsx',
      },
      {
        name: 'lspKind',
        type: 'integer',
        description: 'Filter by LSP SymbolKind number (e.g. 5=Class, 12=Function, 11=Interface, 10=Enum)',
      },
      {
        name: 'file',
        type: 'string',
        description: 'Filter to files matching this path substring',
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum results to return (default 20, max 100)',
      },
      {
        name: 'preferLsp',
        type: 'boolean',
        description: 'Prefer live LSP results over the index. Index-only when the LSP plugin is not active. When the LSP plugin is active and this is true, results come from live workspaceSymbol queries.',
      },
    ],
    notes: [
      'Use when you need to find where something is defined or used by name.',
      '`kind` filter is very useful (e.g. only functions or only interfaces).',
      'Combine with `file` filter to scope to a specific directory or module.',
    ],
  },
  'codebase-stats': {
    longDescription:
      'Return health and statistics about the current symbol index (total symbols, files, language/kind breakdown, size, last update). Useful to decide whether to re-index.',
    params: [],
    notes: [
      'Use to see if the index is up-to-date or needs a refresh.',
      'No arguments required.',
      'Helps avoid wasting tokens on searches against a stale index.',
    ],
  },
  'set_working_dir': {
    longDescription:
      'Change the current working directory for all subsequent file operations. The new directory must be inside the project root. Use this to navigate between subdirectories when working on files in different parts of the project.',
    params: [
      {
        name: 'path',
        type: 'string',
        description: 'Directory to navigate to. Can be relative (to projectRoot) or absolute. If omitted, returns the current working directory without changing it.',
      },
    ],
    notes: [
      'Change the working directory so relative paths in subsequent tool calls resolve from a different directory. Pass `path` to set a new directory, or omit to query the current one.',
    ],
  },
};
