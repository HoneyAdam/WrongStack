# YOLO Mode

YOLO (*You Only Live Once*) mode is WrongStack's **auto-approve** setting for normal project work. When YOLO is on, routine in-project tool calls — including simple shell commands — should not stop for confirmation. Calls that are clearly destructive, escape the project, or affect broad external state can still require confirmation unless the session was started with `--yolo-destructive`.

`--force-all-yolo` remains as a deprecated compatibility alias for `--yolo-destructive`.

---

## Quick reference

| Surface | How to enable |
|---|---|
| CLI flag | `wrongstack --yolo` or `wrongstack --tui --yolo` |
| Destructive override | `wrongstack --yolo --yolo-destructive` |
| Interactive prompt | Answer **Y** at the "YOLO mode?" prompt during boot (default is Y) |
| Slash command | `/yolo on`, `/yolo off`, `/yolo toggle`, `/yolo` (status) |
| Programmatic | `permissionPolicy.setYolo(true)` on a `DefaultPermissionPolicy` instance |

YOLO is **off** only when the user explicitly declines it at the interactive prompt or runs `/yolo off`.

---

## How it works

### Permission evaluation pipeline

Every tool call passes through `DefaultPermissionPolicy.evaluate()` before execution. The evaluation is a priority chain — the first match wins:

```
 1. Session soft deny          → deny   (user pressed 'n' earlier this session)
 2. Session soft allow         → auto   (user pressed 'y' earlier this session)
 3. Trust file deny pattern    → deny   (trust.json deny[])
 4. Tool default deny          → deny   (tool.permission === 'deny')
 5. Trust file allow pattern   → auto   (trust.json allow[])
 6. Trust file auto flag       → auto   (trust.json auto: true)
 7. ★ YOLO                     → auto for normal project work; confirm for clearly destructive calls unless yolo-destructive
 8. Smart bypass (write+read)  → auto   (file was already read this session)
 9. Tool default               → auto   (tool.permission === 'auto' and non-mutating)
10. Confirm prompt / event     → confirm (CLI prompt or tool.confirm_needed event)
```

When YOLO is active, step 7 catches every tool call that was not already handled by trust rules or tool defaults. Most in-project work returns `source: 'yolo'`. Clearly destructive calls return `source: 'yolo_destructive'` and still prompt unless `--yolo-destructive` is active.

The key design choice is **input-aware risk**. A tool can be broadly powerful (`bash` is still declared as destructive), but the policy looks at the actual command before deciding whether YOLO should pause. For example, `echo hello` and `pnpm test` are normal project work; `rm -rf /`, `git reset --hard`, `DROP TABLE`, or shell commands targeting paths outside the project are destructive-gated.

### The `source` field

Every `PermissionDecision` carries a `source` discriminator:

```ts
type PermissionSource =
  | 'default'
  | 'trust'
  | 'yolo'
  | 'yolo_destructive'
  | 'user'
  | 'deny'
  | 'context';
```

- **`yolo`** — auto-approved because YOLO mode is active and the call is normal project work
- **`yolo_destructive`** — YOLO is active, but the call is clearly destructive and still needs approval unless `--yolo-destructive` is enabled
- **`trust`** — matched a rule in `trust.json`
- **`user`** — the user answered a prompt (yes/no/always/deny)
- **`context`** — smart bypass (write tool after the file was already read)
- **`default`** — tool's own declared permission level
- **`deny`** — explicitly denied by a pattern or the tool declaration

---

## Runtime toggle

YOLO can be toggled mid-session without restarting:

```
/yolo           → shows current status
/yolo on        → enable (auto-approve normal project work)
/yolo off       → disable (restore permission prompts)
/yolo toggle    → flip the current state
```

The slash command calls `permissionPolicy.setYolo(state)` under the hood. The change is immediate — the next tool call respects the new setting.

Aliases accepted by `/yolo`:

| Argument | Effect |
|---|---|
| `on`, `enable`, `true`, `1` | Enable |
| `off`, `disable`, `false`, `0` | Disable |
| `toggle` | Flip |

---

## CLI boot flow

```
1. parseArgs(argv)         → flags.yolo = true if --yolo was passed
2. bootConfig(flags)       → config loaded
3. runLaunchPrompts()      → if flags.yolo is undefined, ask "YOLO mode? [Y/n]"
                             default is YES (press Enter = YOLO on)
4. permissionPolicy = new DefaultPermissionPolicy({
                             yolo: resolvedYolo,
                             yoloDestructive: flags['yolo-destructive'] === true
                           })
5. execute({ getYolo: () => policy.getYolo(), ... })
```

Key points:

- **`--yolo` enables normal auto-approval**, not a weak safe-only mode.
- **`--yolo-destructive` enables the destructive override** for clearly destructive calls.
- **`--force-all-yolo` is deprecated** but still accepted as an alias for existing scripts.
- The interactive prompt defaults to **Y** — users must explicitly type `n` to disable YOLO.
- `--goal` mode does **not** force YOLO; the user's choice at the prompt is respected.

---

## What still prompts in YOLO

YOLO should not prompt for routine work inside the project folder. It may still prompt when a call is clearly destructive or outside the project boundary.

Examples that are destructive-gated by default:

- Recursive/force deletion: `rm -rf /`, `rm -rf ../build`, `rmdir /s`, `Remove-Item -Recurse -Force`
- Broad git rollback/cleanup: `git reset --hard`, `git clean -xdf`
- Database destruction: `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE`, `DELETE FROM ...`
- Disk/system operations: `mkfs`, `format`, `diskpart`, `shutdown`, `reboot`
- Pipe-to-shell installers: `curl ... | sh`, `wget ... | bash`
- Commands that change directory or target paths outside the project root

If the user wants those calls to auto-approve too, they can start with `--yolo-destructive`.

---

## Subagent permission model

Subagents (spawned by the Director or via `/spawn`) use a separate policy class:

```ts
class AutoApprovePermissionPolicy implements PermissionPolicy {
  async evaluate(tool: Tool): Promise<PermissionDecision> {
    const blocked =
      tool.permission === 'deny' ||
      hasDangerousCapabilityForSubagents(tool) ||
      isLegacyRiskyToolName(tool.name) ||
      tool.name.startsWith('mcp__');

    if (blocked) {
      return { permission: 'deny', source: 'subagent_guard' };
    }
    return { permission: 'auto', source: 'yolo' };
  }
}
```

This means:

- Subagents run non-interactively, so allowed tools are auto-approved.
- Tools declared with `permission: 'deny'`, dangerous capabilities, legacy risky names (`bash`, `exec`, `install`, file mutation tools), and MCP tools are denied by the subagent guard unless the leader explicitly grants a narrower tool slice.
- `trust()` / `deny()` / `allowOnce()` / `denyOnce()` are no-ops — subagent decisions are ephemeral and do not pollute the leader's trust file.
- The user implicitly authorized delegation when they started the leader session, but delegation is not a blanket bypass for dangerous tools.

---

## Trust file interaction

YOLO and the trust file (`trust.json`) coexist. The trust file is evaluated **before** YOLO, so explicit deny rules always win:

```jsonc
// ~/.wrongstack/projects/<hash>/trust.json
{
  "bash": {
    "deny": ["rm -rf *"]      // ← always denied, even in YOLO mode
  },
  "write": {
    "allow": ["src/**"]       // ← auto-approved regardless of YOLO
  }
}
```

Priority summary:

| Scenario | Result |
|---|---|
| YOLO on + trust deny match | **deny** (trust wins) |
| YOLO on + trust allow match | **auto** (trust wins, source: 'trust') |
| YOLO on + normal in-project call + no trust match | **auto** (source: 'yolo') |
| YOLO on + clearly destructive call + no trust match | **confirm** (source: 'yolo_destructive') unless `--yolo-destructive` |
| YOLO off + no trust match | **confirm** (prompt user) |

---

## Session-scoped soft rules

When the user answers a permission prompt (YOLO off or destructive-gated YOLO):

| Answer | Effect |
|---|---|
| **y** (yes) | `allowOnce()` — auto-approve this tool+pattern for the rest of the session |
| **n** (no) | `denyOnce()` — block this tool+pattern for the rest of the session |
| **a** (always) | `trust()` — write to trust.json permanently |
| **d** (deny) | `deny()` — write deny rule to trust.json permanently |

These session-scoped maps (`sessionAllowed`, `sessionDenied`) are cleared on `reload()` (when the trust file is re-read).

---

## Observability

YOLO-approved calls are logged with `source: 'yolo'` in the session JSONL. This allows:

- **Audit**: filter `permission.decision` events where `source === 'yolo'` to see what was auto-approved, or `source === 'yolo_destructive'` to see destructive calls that YOLO did not silently approve.
- **Cost analysis**: YOLO calls bypass the human confirmation bottleneck, so they tend to accumulate faster — the token/cost chips in the TUI status bar reflect this in real time.
- **Post-hoc review**: the trust file + session log together give a complete picture of what was allowed and why.

---

## Security considerations

| Concern | Mitigation |
|---|---|
| Accidental destructive commands | Clearly destructive calls still prompt in YOLO unless `--yolo-destructive` is active; trust file deny patterns are evaluated **before** YOLO |
| Project-boundary escape | Commands and file mutations that target outside the project root are treated as destructive-gated |
| YOLO left on unintentionally | The TUI status bar shows `YOLO` when active; `/yolo` shows current state |
| Subagent privilege escalation | `AutoApprovePermissionPolicy` denies `tool.permission === 'deny'`, dangerous capabilities, MCP tools, and legacy risky tool names by default |
| Trust file poisoning | Trust file is per-project (`~/.wrongstack/projects/<hash>/trust.json`), AES-256-GCM encrypted secrets are separate |

### Recommended deny patterns for YOLO users

```jsonc
// ~/.wrongstack/projects/<hash>/trust.json
{
  "bash": {
    "deny": [
      "rm -rf /*",
      "DROP TABLE*",
      "DELETE FROM*",
      ":(){ :|:& };:"
    ]
  },
  "write": {
    "deny": ["~/.ssh/*", "~/.gnupg/*", "/etc/*"]
  }
}
```

---

## TUI integration

The TUI status bar reflects YOLO state. When active, the boot message shows:

```
  ▶ Launching in TUI mode (YOLO)
```

The `getYolo` callback is passed to the execution layer so the TUI can query the live state:

```ts
// In execution.ts
getYolo?: () => boolean;
```

---

## Programmatic usage

```ts
import { DefaultPermissionPolicy } from '@wrongstack/core';

const policy = new DefaultPermissionPolicy({
  trustFile: '/path/to/trust.json',
  yolo: true,              // auto-approve normal project work
  yoloDestructive: false,  // keep clearly destructive calls gated
});

// Toggle at runtime
policy.setYolo(false);
policy.setYoloDestructive(true);

// Query current state
const isYolo = policy.getYolo(); // false
const destructiveOverride = policy.getYoloDestructive(); // true
```

For subagent contexts:

```ts
import { AutoApprovePermissionPolicy } from '@wrongstack/core';

const subagentPolicy = new AutoApprovePermissionPolicy();
// Allowed tools are auto-approved; dangerous capabilities, MCP tools,
// and legacy risky tool names are denied by the subagent guard.
```

---

## Summary

YOLO mode removes the permission prompt bottleneck for normal project work while keeping clearly destructive or project-escaping calls gated by default. It sits at priority level 7 in the leader permission chain — above tool defaults but below explicit trust/deny rules. It can be toggled at any time via `/yolo` and defaults to on at boot. Use `--yolo-destructive` only when you want YOLO to auto-approve destructive-gated calls too.
