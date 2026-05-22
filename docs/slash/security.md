# /security — Security Scanner

## What it does

`/security` runs an LLM-powered security scan using `defaultOrchestrator.run()`. It detects the tech stack, runs targeted checks, and produces a report.

## Subcommands

| Usage | Effect |
|---|---|
| `/security scan` | Full scan (depth: standard, includes secrets/injection/config) |
| `/security scan --depth deep` | Deeper scan with more thorough checks |
| `/security scan --format html` | Output as HTML instead of markdown |
| `/security audit` | Dependency audit + security scan combined |
| `/security report` | List all saved reports |
| `/security report <id>` | View a specific report (by number or id substring match) |

## How it works

1. **Tech stack detection** — probes the project for package.json, Cargo.toml, go.mod, etc.
2. **LLM-driven analysis** — the orchestrator calls the active provider with a security skill prompt, generating vulnerability findings
3. **Report generation** — markdown/JSON/HTML output saved to `security-reports/`
4. **Report list** — stored reports sorted by date, latest first

## Report output

```
# Security Scan Complete

**Project:** /path/to/project
**Tech Stack:** node-typescript
**Scanned Files:** 247
**Duration:** 3800ms

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 4 |
| 🟢 Low | 7 |

**Status:** ⚠️ Found 13 issues
**Report:** security-reports/security-report-2026-05-22.md
```

## Code reference

- `packages/cli/src/slash-commands/security.ts`
- `packages/core/src/security-scanner/` — orchestrator, scanner, detectors
- `packages/core/skills/security-scanner/SKILL.md`