# Testing — WrongStack (Compact)

Writes and reviews tests for WrongStack TypeScript code (vitest, pnpm workspaces).

## Rules

1. Co-locate tests: `src/foo.ts` → `tests/foo.test.ts` (same package).
2. Always test public API surfaces — don't test internals.
3. Use `vi.mock()` for external deps; never mock internal modules.
4. Every async test needs a timeout: `test(..., { timeout: 5000 })`.
5. Mock time with `vi.useFakeTimers()` for debounce/throttle tests.
6. Coverage gate: new code must have ≥70% coverage.
7. Don't commit test-only deps — test deps go in `devDependencies`.
8. Tests must be isolated — each test cleans up its mocks/state.

## Key patterns

- **Unit**: Pure logic, parsing, transformations.
- **Integration**: API calls, file I/O, tool chains.
- **E2E**: Full command flow, CLI smoke tests.
- Mock `node:fs/promises` with `vi.mock()`, use `vi.mocked(fs.readFile).mockResolvedValue()`.
- Use `afterEach(() => { vi.restoreAllMocks(); })` for isolation.