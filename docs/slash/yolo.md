# /yolo — Auto-Approve Normal Project Work

## What it does

`/yolo on` sets `DefaultPermissionPolicy.setYolo(true)`. This auto-approves normal in-project tool calls without a permission prompt, including simple shell commands. Clearly destructive calls can still require confirmation unless the CLI session was started with `--yolo-destructive`.

`--force-all-yolo` is still accepted as a deprecated compatibility alias for `--yolo-destructive`.

## Usage

| Usage | Effect |
|---|---|
| `/yolo` | Show current YOLO status |
| `/yolo on` | Enable YOLO mode (auto-approve normal project work) |
| `/yolo off` | Disable YOLO mode (restore permission prompts) |
| `/yolo toggle` | Toggle current state |

## Security model interaction

YOLO mode does **not** bypass the permission policy entirely. The policy is input-aware: powerful tools such as `bash` may still auto-approve when the actual command is routine project work, but clearly destructive commands remain gated.

```typescript
// In YOLO mode, simple bash is normal project work:
bash({ command: 'echo hello' }) // auto, source: 'yolo'

// Clearly destructive bash still confirms unless --yolo-destructive is active:
bash({ command: 'rm -rf /' }) // confirm, source: 'yolo_destructive'
```

**Summary:**

| Scenario | Result |
|---|---|
| `/yolo on` (no extra flag) | Normal in-project work auto-approved; clearly destructive calls still prompt |
| `wrongstack --yolo --yolo-destructive` | YOLO also auto-approves destructive-gated calls |
| `/yolo off` | Permission prompts are active |

## CLI flags

| Flag | Effect |
|---|---|
| `--yolo` | Enable YOLO mode at startup for normal project work |
| `--yolo-destructive` | Allow clearly destructive calls in YOLO mode (combine with `--yolo`) |
| `--force-all-yolo` | Deprecated alias for `--yolo-destructive` |

## Code reference

- `packages/cli/src/slash-commands/yolo.ts`
- `packages/core/src/security/permission-policy.ts` — `yolo`, `yoloDestructive` flags and input-aware destructive gating
- `packages/core/src/types/tool.ts` — risk tier definitions
