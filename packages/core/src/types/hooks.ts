/**
 * Lifecycle hook types — the pure, serializable contract shared by the config
 * layer, the in-process plugin API, and the shell-hook executor.
 *
 * These types intentionally avoid referencing the live `Context` (which lives
 * in `core/`, a higher layer) so `types/config.ts` can import them without
 * creating a layering cycle. The runtime pieces (`hooks/registry`,
 * `hooks/runner`, `hooks/shell-executor`) translate live run state into the
 * serializable `HookInput` below.
 */

/** Lifecycle phases a hook can subscribe to. */
export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'SessionStart' | 'Stop';

/**
 * Tool-name matcher for `PreToolUse`/`PostToolUse` hooks. A pipe-delimited
 * list of exact tool names, or `*` for all tools. Examples: `"Bash"`,
 * `"edit|write"`, `"*"`. Ignored (treated as `*`) for non-tool events.
 */
export type HookMatcher = string;

/**
 * The JSON payload handed to a hook. For shell hooks this is serialized to
 * stdin; for in-process hooks it is passed as the sole argument. Kept flat and
 * serializable so both transports see the same shape.
 */
export interface HookInput {
  event: HookEvent;
  /** Present for PreToolUse / PostToolUse. */
  toolName?: string;
  /** Tool arguments (PreToolUse / PostToolUse). */
  toolInput?: unknown;
  /** Tool result preview (PostToolUse only). */
  toolResult?: { content: string; isError: boolean };
  /** The submitted user text (UserPromptSubmit only). */
  prompt?: string;
  /** Absolute working directory of the session. */
  cwd: string;
  /** Active session id, when known. */
  sessionId?: string;
}

/**
 * What a hook returns. Every field is optional — an empty object (or a hook
 * that returns nothing) is a no-op "allow".
 */
export interface HookOutcome {
  /**
   * `block` stops the action (PreToolUse → tool not run; UserPromptSubmit →
   * turn short-circuited). `allow` is the explicit no-op. Omitted = allow.
   */
  decision?: 'block' | 'allow';
  /** Human-readable reason, surfaced to the model when blocking. */
  reason?: string;
  /**
   * PreToolUse only: replacement tool arguments. The executor swaps these in
   * and RE-VALIDATES them against the tool's input schema before running.
   */
  modifiedInput?: Record<string, unknown>;
  /**
   * Extra context to fold back to the model — appended to the tool_result
   * (PostToolUse), the user message (UserPromptSubmit), or the system preamble
   * (SessionStart).
   */
  additionalContext?: string;
}

/** An in-process hook function (registered via the plugin API). */
export type InProcessHook = (input: HookInput) => HookOutcome | void | Promise<HookOutcome | void>;

/**
 * A shell-command hook (declared in `config.hooks`). Claude-compatible: the
 * `HookInput` JSON is written to the command's stdin; a JSON `HookOutcome` may
 * be printed to stdout, and exit code 2 forces `decision: 'block'`.
 */
export interface ShellHook {
  /** Command line run via the platform shell. */
  command: string;
  /** Tool-name matcher (defaults to `*`). */
  matcher?: HookMatcher;
  /** Per-invocation timeout in ms (default 5000). */
  timeoutMs?: number;
}

/** A registered hook entry, discriminated by transport. */
export type HookEntry =
  | {
      kind: 'inprocess';
      event: HookEvent;
      matcher: HookMatcher;
      hook: InProcessHook;
      owner?: string;
    }
  | { kind: 'shell'; event: HookEvent; matcher: HookMatcher; command: string; timeoutMs?: number };
