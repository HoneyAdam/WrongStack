# YOLO Mode

YOLO mode is WrongStack's broad auto-approval setting. When YOLO is on,
`DefaultPermissionPolicy` approves tool calls that were not blocked earlier by
explicit deny rules.

Current behavior:

- `--yolo` enables broad auto-approval.
- Clearly destructive calls still require explicit confirmation.
- `--confirm-destructive` is kept for compatibility; the destructive gate is
  on by default.
- `--yolo-destructive` and `--force-all-yolo` are accepted for compatibility,
  but they do not bypass destructive-operation confirmation.

## Quick Reference

| Surface | How to use it |
|---|---|
| CLI flag | `wrongstack --yolo` |
| Destructive confirmation | Always on for clearly destructive calls |
| Interactive prompt | Answer `Y` at the "YOLO mode?" prompt during boot; default is yes |
| Slash command | `/yolo`, `/yolo on`, `/yolo off`, `/yolo toggle` |
| Programmatic | `permissionPolicy.setYolo(true)` |

YOLO is off only when the user explicitly declines it at boot, persisted config
sets it off, or `/yolo off` is run.

## Permission Evaluation Order

Every tool call passes through `DefaultPermissionPolicy.evaluate()` before
execution. The first matching rule wins:

```text
1. Session soft deny          -> deny
2. Session soft allow         -> auto
3. Trust file deny pattern    -> deny
4. Tool default deny          -> deny
5. YOLO destructive gate      -> confirm
6. Trust file allow pattern   -> auto
7. Trust file auto flag       -> auto
8. YOLO                       -> auto
9. Smart bypass (write+read)  -> auto
10. Tool default              -> auto for non-mutating auto tools
11. Confirm prompt / event    -> confirm
```

This means trust-file deny rules and `permission: 'deny'` still win over YOLO,
while destructive calls are checked before trust-file allow rules.

## Destructive Confirmation

The destructive gate is active while YOLO is on, and it is **calibrated to
genuinely catastrophic, effectively irreversible destruction only** — the kind
that wipes the machine, a disk, or the user's home. The policy checks:

- `bash` / `shell` / `exec` commands that **recursively delete a top-level
  root**: the filesystem root (`rm -rf /`, `rm -rf /*`), a drive root
  (`rm -rf C:\`), the home directory (`rm -rf ~`, `rm -rf $HOME`), a system
  directory (`/etc`, `/usr`, `/home`, `C:\Windows`, `C:\Users`, …), or a bare
  `rm -rf` (whole-cwd wipe). Includes `del`/`rmdir /s`/`Remove-Item -Recurse`
  on those targets.
- **Disk / partition wipes**: `mkfs*`, `format C:`, `diskpart`, `dd of=/dev/…`,
  a redirect into a raw block device (`… > /dev/sda`), and the classic fork bomb.
- File mutation tools (`write`/`edit`) targeting paths **outside** the project root.
- Tools declared with `riskTier: 'destructive'`.

**Everything else auto-runs in YOLO with no prompt**, including destructive-but-
recoverable work: deleting a few files or an arbitrary sibling/parent directory
(`rm -rf ../other`, `rm -rf ~/cache`, `rm -rf /etc/hosts`), `git reset --hard`,
`git clean -xdf`, `DROP TABLE`/`DELETE FROM`, `chmod -R`, `shutdown`/`reboot`,
`curl … | sh`, writing a single file outside the project (`echo x > /etc/hosts`),
plus all reads/navigation (`pwd`, `dir C:\logs`, `cd ..`, `cat ../README.md`),
build/test commands, in-project edits, package installs, formatters, and network
fetch/search.

## Runtime Toggle

YOLO can be toggled during a REPL/TUI session:

```text
/yolo           show current status
/yolo on        enable YOLO
/yolo off       disable YOLO
/yolo toggle    flip current state
```

The slash command accepts these arguments:

| Argument | Effect |
|---|---|
| `on`, `enable`, `true`, `1` | Enable |
| `off`, `disable`, `false`, `0` | Disable |
| `toggle` | Flip |

## Source Values

Permission decisions can report these relevant sources:

| Source | Meaning |
|---|---|
| `yolo` | Auto-approved because YOLO mode is active |
| `yolo_destructive` | YOLO is active and a clearly destructive call needs approval |
| `trust` | Matched an allow rule or trust-file auto flag |
| `deny` | Explicitly denied by a pattern or tool declaration |
| `user` | User answered a permission prompt |
| `context` | Smart bypass, such as writing a file already read this session |
| `default` | Tool's own declared permission level |

## Session-Scoped Soft Rules

When the user answers a permission prompt, the policy can remember the answer
for the rest of the session:

| Answer | Effect |
|---|---|
| `y` | `allowOnce()` auto-approves this tool/pattern once for the immediate re-run |
| `n` | `denyOnce()` blocks this tool/pattern for the session |
| `a` | `trust()` writes a permanent allow rule to `trust.json` |
| `d` | `deny()` writes a permanent deny rule to `trust.json` |

The one-shot allow entry is consumed on first use. The session maps are also
cleared when the trust file is reloaded.

## Security Notes

| Concern | Mitigation |
|---|---|
| Accidental destructive commands | Destructive shell/exec/file operations prompt even in YOLO |
| Project-boundary escape | Outside-project file mutations prompt |
| YOLO left on unintentionally | TUI status and `/yolo` show the current state |
| Subagent privilege escalation | Subagents use `AutoApprovePermissionPolicy`, which denies dangerous capabilities, MCP tools, and legacy risky names by default |
| Trust file poisoning | Trust is per project at `~/.wrongstack/projects/<hash>/trust.json`; encrypted secrets are separate |

Example defensive trust rules:

```jsonc
// ~/.wrongstack/projects/<hash>/trust.json
{
  "bash": {
    "deny": [
      "rm -rf /*",
      "DROP TABLE*",
      "DELETE FROM*"
    ]
  },
  "write": {
    "deny": ["~/.ssh/*", "~/.gnupg/*", "/etc/*"]
  }
}
```

## Programmatic Usage

```ts
import { DefaultPermissionPolicy } from '@wrongstack/core';

const policy = new DefaultPermissionPolicy({
  trustFile: '/path/to/trust.json',
  yolo: true,
});

policy.setYolo(false);

const isYolo = policy.getYolo();
const destructiveGate = policy.getConfirmDestructive();
```

For subagents:

```ts
import { AutoApprovePermissionPolicy } from '@wrongstack/core';

const subagentPolicy = new AutoApprovePermissionPolicy();
```

## Code Reference

- `packages/core/src/security/permission-policy.ts`
- `packages/core/src/security/yolo-risk.ts`
- `packages/cli/src/arg-parser.ts`
- `packages/cli/src/slash-commands/yolo.ts`
