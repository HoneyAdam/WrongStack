# /hq — Connect to a WrongStack HQ command center

## What It Does

Points this TUI/REPL client at a WrongStack **HQ** command center so it streams
its live session + agents (and full chat transcript) there, and lets you inspect
the connection. HQ is the read-only dashboard started with `wstack --hq`; see
[`--hq`](../subcommands/hq.md) for the server side.

A locally running `wstack --hq` is **auto-discovered** (via `~/.wrongstack/hq/runtime.json`)
with no configuration. Use `/hq set` to point at an HQ on **another machine**.

## Usage

| Usage | Effect |
|---|---|
| `/hq` | Show connection status (resolved URL, token, source, reachability) |
| `/hq status` | Same as bare `/hq` |
| `/hq set <url> [token]` | Configure HQ URL + optional client token, e.g. `/hq set http://192.168.1.20:3499 my-client-token` |
| `/hq token <token>` | Set just the client token |
| `/hq on` | Enable HQ publishing |
| `/hq off` | Disable HQ publishing |
| `/hq clear` | Remove all HQ settings |

## Notes

- Settings persist to `~/.wrongstack/config.json` (global scope) under `hq`.
- Telemetry attaches on the **next session start** — an already-running session
  keeps its current connection. Run a new TUI/REPL to connect to a freshly-set HQ.
- The client token is for the `/ws/client` channel and is distinct from the HQ
  **browser** token (used to open the dashboard in a browser).
- `set` / `status` run a quick reachability probe against the HQ URL. A `401`
  still counts as *reachable* (the server is up, just token-gated).

## Resolution order

1. `WRONGSTACK_HQ_URL` / `WRONGSTACK_HQ_TOKEN` env vars (override the config file)
2. `config.json` → `hq.url` / `hq.token`
3. A locally running HQ (`~/.wrongstack/hq/runtime.json` marker)
4. Default fallback: `http://127.0.0.1:3499`

## Code Reference

- `packages/cli/src/slash-commands/hq.ts`
- `packages/core/src/hq/factory.ts` (`resolveHqConfig`)
- `packages/core/src/hq/session-bridge.ts` (telemetry stream)
- `packages/cli/src/hq-server.ts` (the `--hq` server)
