# `wstack update` — Self-Update

## What it does

Checks the npm registry for a newer version of `wrongstack` and updates the global install with the matching package manager when possible.

## Behavior

```
wstack update
  → Fetch latest version from npm
  → Compare with current (API_VERSION from version.ts)
  → If newer: run the detected global package-manager update command
  → If current: "You are on the latest version"
  → If error: "Update check failed — check your internet connection"
```

By default the command detects `pnpm`, `yarn`, and `bun` from the runtime environment or install path, then falls back to npm. You can force a package manager:

```bash
wstack update --pm npm
wstack update --pm pnpm
wstack update --pm yarn
wstack update --pm bun
```

Equivalent manual commands:

```bash
npm install -g wrongstack@latest
pnpm add -g wrongstack@latest
yarn global add wrongstack@latest
bun add -g wrongstack@latest
```

`node-pty` is not a required global install dependency. The WebUI integrated terminal loads it only when present; this keeps `npm i -g wrongstack` from tripping npm's `allow-scripts` warning for `node-pty` on machines that only need the CLI/TUI.

## Code reference

- `packages/cli/src/subcommands/handlers/update.ts`
