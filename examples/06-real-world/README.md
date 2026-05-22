# 06 — Real-World Workflows

Practical recipes for daily development. Every command below has been
verified against the current CLI surface.

## Refactor a module

```bash
wrongstack "refactor src/auth.ts to use async/await instead of callbacks. Keep the public API the same."
```

The agent will: read the file → understand the pattern → propose
changes → apply edits (auto-approve in `--yolo`) → run tests to verify.

## Debug a failing test

```bash
wrongstack "the test 'should handle timeout' in src/timeout.test.ts is failing. Find and fix the root cause."
```

## Code review with a persona mode

```bash
wrongstack
```

```
/mode code-reviewer
review src/api.ts for security and error-handling issues
```

The other built-in personas: `default`, `code-auditor`, `architect`,
`debugger`, `tester`, `devops`, `refactorer`. List them with `/mode`.

## Add tests to uncovered code

```bash
wrongstack "add unit tests for parseArgs in arg-parser.ts. Cover empty input, unknown flags, mixed positional and flags."
```

## Security audit (single-shot)

```bash
wrongstack "scan packages/ for hardcoded secrets, SQL-injection vectors, and path traversal. Group findings by severity."
```

For a multi-agent fan-out, launch the director:

```bash
wrongstack --director "full security audit across packages/. Use subagents for each package; roll up to a single severity-sorted report."
```

## Dependency hygiene

```bash
wrongstack "check for outdated packages, assess the breaking-change risk for each, and update the safe ones."
wrongstack "run npm audit and walk me through fixing the high-severity advisories."
```

## Generate documentation

```bash
wrongstack "add JSDoc comments to every exported function in packages/core/src/kernel/"
```

## Stage + commit conventionally

```bash
wrongstack "stage all changes and create a conventional-commit message."
```

Or use the dedicated slash command (drafts the message via the
configured LLM, then asks for confirmation):

```
/commit
```

## Migration plan

```bash
wrongstack "this project migrated from Express to Fastify. Write a one-page migration guide covering the key concept differences."
```

## Performance audit

```bash
wrongstack "identify the slowest functions under src/ and suggest optimizations. Focus on hot paths."
```

## CI/CD scaffolding

```bash
wrongstack "create a GitHub Actions workflow that runs lint + typecheck + tests on PRs and a release workflow on tags."
```

## Monorepo housekeeping

```bash
wrongstack "verify every workspace package has a consistent version. Flag any cross-package dependency that doesn't use workspace:*."
```

## Combine flags for long-running work

```bash
# Fast iteration: TUI + YOLO + cheap-fast provider
wrongstack --tui --yolo --provider groq --model llama-3.3-70b-versatile \
  "add error boundaries to every React component under packages/webui/src/components"

# Director + eternal — runs indefinitely against the goal
wrongstack --director --eternal "migrate the test suite from Jest to Vitest one package at a time, verifying tests pass before moving on"

# Offline-only run (no MCP, no plugins, no models.dev fetch, no skills)
wrongstack --no-features --provider anthropic --model claude-opus-4-7 \
  "explain the kernel architecture using only what's in packages/core/src/"
```
