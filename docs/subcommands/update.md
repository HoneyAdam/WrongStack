# `wstack update` — Self-Update

## What it does

Checks the npm registry for a newer version of `wrongstack` and prompts to upgrade. Falls back to `npm install -g wrongstack` for the actual upgrade.

## Behavior

```
wstack update
  → Fetch latest version from npm
  → Compare with current (API_VERSION from version.ts)
  → If newer: prompt to upgrade
  → If current: "You are on the latest version"
  → If error: "Update check failed — check your internet connection"
```

## Code reference

- `packages/cli/src/subcommands/handlers/update.ts`