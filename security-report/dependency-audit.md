# Dependency Audit — WrongStack

_Phase 1b. Scan date: 2026-05-29._

## Summary

**Supply-chain posture: strong.** `pnpm audit --prod` → **No known vulnerabilities found.** Runtime dependency footprint is unusually lean for a project this size; `core`, `providers`, `mcp`, `runtime`, `telegram` carry **zero external runtime deps** (they use Node built-in `fetch`/`crypto`/`http`).

## External runtime dependencies (non-workspace)

| Package | Used by | Version | Notes |
|---|---|---|---|
| `ws` | cli, webui | ^8.20.1 / ^8.18.0 | WebSocket server/client. Keep >=8.17.1 (CVE-2024-37890 DoS via many headers fixed there). Both ranges satisfy. **Version skew** between cli (^8.20.1) and webui (^8.18.0) — align. |
| `react` / `react-dom` | tui (^18), webui (^19) | mixed | Major-version skew across packages (18 vs 19) — intentional? webui on 19, tui on 18. |
| `ink` | tui | ^5.0.1 | terminal React renderer |
| `vscode-languageserver-protocol` | plug-lsp | ^3.17.5 | LSP types |
| `@radix-ui/*`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `zustand` | webui | current | UI libs, browser-side |
| `react-markdown` + `remark-gfm` | webui | ^9 / ^4 | **renders Markdown — XSS surface** if raw-HTML rendering (rehype-raw / direct innerHTML) is enabled. Verify in WebUI hunt. |
| `typescript` | tools (runtime dep), root (dev) | ^5.9.3 | tools depends on `typescript` at runtime (for TS parsing in codebase-index) |

Dev-only: `@biomejs/biome`, `@vitest/*`, `tsup`, `@types/node`.

## Observations / risks

1. **Version skew** — `ws` (8.20.1 vs 8.18.0) and `react` (18 vs 19) differ across packages. Low security risk now but pin/align to avoid a future package picking up a vulnerable transitive resolution.
2. **`react-markdown`** in webui — confirm raw-HTML rendering is disabled (default-safe, but flag for the XSS pass).
3. **No lockfile-integrity / provenance enforcement noted** — consider `pnpm config set verify-store-integrity true` and npm provenance on publish (see CI/CD pass).
4. No transitive CVEs reported. Re-run `pnpm audit` in CI on a schedule (advisory DB updates).

_Note: `pnpm audit` reflects the advisory DB at scan time. This is a point-in-time result._
