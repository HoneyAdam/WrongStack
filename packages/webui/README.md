# @wrongstack/webui

React 19 + Vite browser client for WrongStack. The WebSocket and HTTP backend is
published separately as [`@wrongstack/webui-server`](../webui-server); the CLI
starts both surfaces with `wstack --webui` (equivalent to `wstack webui`).

## Development

From the workspace root:

```bash
pnpm --filter @wrongstack/webui dev
pnpm --filter @wrongstack/webui build
pnpm --filter @wrongstack/webui typecheck
pnpm --filter @wrongstack/webui test
pnpm --filter @wrongstack/webui test:coverage
```

The Vite development server serves the frontend. A functional agent session also
requires the WrongStack WebUI backend; use `wstack --webui` for the integrated
surface.

## Package boundaries

- `src/components/`, `src/hooks/`, and `src/stores/` implement the browser UI.
- `src/lib/` contains browser-side protocol and formatting utilities.
- `@wrongstack/webui-server` owns the Node.js server implementation used by the CLI.
- `src/server/index.ts` is a temporary compatibility re-export of
  `@wrongstack/webui-server`; it is not a second backend implementation.

See [TESTING.md](./TESTING.md) for the package test and coverage policy.

## License

MIT
