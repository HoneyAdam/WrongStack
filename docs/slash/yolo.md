# /yolo — Auto-Approve All Tool Calls

## What it does

`/yolo` toggles YOLO mode, which sets `DefaultPermissionPolicy.forceAllYolo = true`. When YOLO is on, every tool call is auto-approved without a permission prompt — including `destructive`-risk tools.

## Usage

| Usage | Effect |
|---|---|
| `/yolo` | Show current YOLO status |
| `/yolo on` | Enable YOLO mode |
| `/yolo off` | Disable YOLO mode |
| `/yolo toggle` | Toggle current state |

## Security model interaction

YOLO does **not** bypass the permission policy entirely — it sets a flag on `DefaultPermissionPolicy`:

```typescript
// When forceAllYolo is true, destructive tools still confirm
// unless --force-all-yolo CLI flag is also set
if (tool.riskTier === 'destructive' && !this.forceAllYolo) {
  return 'confirm';
}
```

So YOLO skips prompts for `low` and `medium` risk tools but `destructive` tools still need `--force-all-yolo` at CLI startup.

## Code reference

- `packages/cli/src/slash-commands/yolo.ts`
- `packages/core/src/security/permission-policy.ts` — `forceAllYolo` flag
- `packages/core/src/types/tool.ts` — risk tier definitions