# /yolo — Auto-Approve All Tool Calls

## What it does

`/yolo on` sets `DefaultPermissionPolicy.setYolo(true)`. This auto-approves every **non-destructive** tool call without a permission prompt. **Destructive** tools (`riskTier: 'destructive'`) still require `--force-all-yolo` at CLI startup to be auto-approved.

## Usage

| Usage | Effect |
|---|---|
| `/yolo` | Show current YOLO status |
| `/yolo on` | Enable YOLO mode (auto-approve non-destructive tools) |
| `/yolo off` | Disable YOLO mode (restore permission prompts) |
| `/yolo toggle` | Toggle current state |

## Security model interaction

YOLO mode does **not** bypass the permission policy entirely. Destructive tools are gated independently:

```typescript
// Even with yolo=true, destructive tools still confirm
// unless --force-all-yolo was set at CLI startup
if (tool.riskTier === 'destructive' && !this.forceAllYolo) {
  return 'confirm';
}
```

**Summary:**

| Scenario | Result |
|---|---|
| `/yolo on` (no flag) | Non-destructive tools auto-approved; destructive tools still prompt |
| `wrongstack --yolo --force-all-yolo` | All tools auto-approved including destructive |
| `/yolo off` | All tools require explicit confirmation |

## CLI flags

| Flag | Effect |
|---|---|
| `--yolo` | Enable YOLO mode at startup (non-destructive only) |
| `--force-all-yolo` | Allow destructive tools in YOLO mode (combine with `--yolo`) |

## Code reference

- `packages/cli/src/slash-commands/yolo.ts`
- `packages/core/src/security/permission-policy.ts` — `yolo`, `forceAllYolo` flags
- `packages/core/src/types/tool.ts` — risk tier definitions