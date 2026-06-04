# Lifecycle Hooks

Hooks let you observe and **steer** the agent at well-defined lifecycle points —
block a tool call, rewrite its arguments, inject context, or run side effects.
Unlike the `EventBus` (which is observe-only), hooks can change what happens.

Two execution models:

- **Shell hooks** — declared in `config.hooks`. A command receives the hook
  payload as JSON on stdin and returns a JSON outcome on stdout (Claude-compatible).
- **In-process hooks** — registered programmatically by plugins via
  `api.registerHook(event, matcher, fn)`. No subprocess; fast and type-safe.

Both are driven by the same `HookRunner` and share the payload/outcome contract.

Disable everything for a session with `--no-hooks`.

## Events

| Event | When | Can block? | Can mutate / inject |
|---|---|---|---|
| `PreToolUse` | Before a tool runs, before the permission check | ✅ (tool not run) | rewrite tool input (`modifiedInput`) |
| `PostToolUse` | After a tool returns | — | append `additionalContext` to the result |
| `UserPromptSubmit` | Before a user turn is processed | ✅ (turn ends) | append `additionalContext` to the message |
| `SessionStart` | Once, on the first turn of the session | — | append `additionalContext` to the system prompt |
| `Stop` | At the end of every turn | — | side effects only |

`PreToolUse` runs **before** the permission policy, so a hook can veto a tool
that the trust file would otherwise auto-allow. A rewritten `modifiedInput` is
re-validated against the tool's input schema before the tool runs.

## Matchers

`PreToolUse` / `PostToolUse` entries take a `matcher`: a case-insensitive,
pipe-delimited list of exact tool names, or `*` for all. Examples: `"bash"`,
`"edit|write"`, `"*"`. Other events ignore the matcher.

## Payload (`HookInput`)

Written to a shell hook's stdin (and passed to in-process hooks):

```jsonc
{
  "event": "PreToolUse",
  "toolName": "bash",          // PreToolUse / PostToolUse
  "toolInput": { "command": "ls" },
  "toolResult": { "content": "...", "isError": false }, // PostToolUse only
  "prompt": "user text",       // UserPromptSubmit only
  "cwd": "/abs/project",
  "sessionId": "01J..."
}
```

## Outcome (`HookOutcome`)

A shell hook may print a JSON object to stdout; an in-process hook returns one
(or nothing). All fields optional:

```jsonc
{
  "decision": "block",          // or "allow" (omit = allow)
  "reason": "blocked: rm -rf",  // shown to the model on block
  "modifiedInput": { "command": "ls -la" },  // PreToolUse only
  "additionalContext": "note appended for the model"
}
```

**Shell shortcut:** exit code `2` forces `decision: "block"` (with stderr/stdout
as the reason), matching Claude's convention. Any other exit code with no JSON
on stdout is a no-op.

## Shell hook example

`config.json`:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "bash", "command": "./scripts/guard-bash.sh" }
    ]
  }
}
```

`scripts/guard-bash.sh`:

```bash
#!/usr/bin/env bash
input=$(cat)                              # HookInput JSON on stdin
cmd=$(printf '%s' "$input" | jq -r '.toolInput.command // ""')
if printf '%s' "$cmd" | grep -qE 'rm -rf|:\(\)\{'; then
  echo '{"decision":"block","reason":"dangerous command blocked"}'
  exit 0                                  # (or: exit 2)
fi
# allow (no output)
```

## In-process hook example (plugin)

```ts
export default {
  name: 'lint-after-edit',
  setup(api) {
    api.registerHook('PostToolUse', 'edit|write', async (input) => {
      const { stdout } = await runLint(input.toolInput);
      return stdout ? { additionalContext: `Lint:\n${stdout}` } : {};
    });
  },
};
```

The returned unregister function is called automatically when the plugin is
uninstalled.

## Security model

- Shell hooks run arbitrary commands you put in **your own** config — they are
  not model-controlled. Still, keep hook scripts in version control and review
  them like any other automation.
- `--no-hooks` disables both shell and in-process hooks for the session. Shell
  hooks are additionally gated by the runner's `allowShell` flag.
- Hooks are best-effort: a hook that throws, times out (default 5 s), or fails to
  spawn is logged and treated as a no-op — it never aborts the agent.
- Output is capped at 64 KiB per shell hook.

## Internals

- Types: `packages/core/src/types/hooks.ts` (`HookEvent`, `HookInput`, `HookOutcome`, …).
- Runtime: `packages/core/src/hooks/` (`HookRegistry`, `HookRunner`, `runShellHook`).
- Wiring: `PreToolUse`/`PostToolUse` in `ToolExecutor`; `UserPromptSubmit` as a
  `userInput` pipeline middleware; `SessionStart`/`Stop` as an `AgentExtension`
  (see `packages/cli/src/hooks-wiring.ts` and the boot path in `packages/cli/src/index.ts`).
- DI token: `TOKENS.HookRegistry`.
