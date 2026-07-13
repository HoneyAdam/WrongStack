# WebUI Testing Guidelines

## Coverage Ratchet Policy

Every new store or utility test file merged to `main` **must increase** the
coverage thresholds in `vitest.config.ts` by **+1** on each metric that the new
tests improve.

### Why?

Without a ratchet, thresholds stagnate and provide no signal. The policy
ensures coverage keeps pace with new code.

### How to apply it

1. Run `pnpm --filter @wrongstack/webui test:coverage` locally.
2. Note the new aggregate values for `statements`, `branches`, `functions`, `lines`.
3. Set each threshold to `Math.floor(measured_value)`. This is the floor — CI
   will fail if coverage drops below this.
4. If a new test lands and coverage improves past a whole number
   (e.g. 19.2% → 20.1%), set the threshold to that whole number.
5. Commit message: `test(webui): tighten coverage thresholds`

### Current measured coverage

| Metric    | Measured | Threshold |
|-----------|----------|-----------|
| statements | 19.21%  | 19        |
| branches  | 16.87%  | 16        |
| functions | 17.81%  | 17        |
| lines     | 19.83%  | 19        |

### What counts as a "store/utility test"

- Files matching `stores/*.test.ts`
- Files matching `**/slash-commands.test.ts`
- Files matching `**/code-detect.test.ts`
- Any new test file targeting a previously uncovered module

### Files excluded from coverage

The configured exclusions in `vitest.config.ts` are bootstrap or declaration files:

- `src/env.d.ts`
- `src/main.tsx`
- `src/lib/core-browser-shim.ts`
- `src/server/entry.ts`

All other `src/**/*.{ts,tsx}` files contribute to the aggregate ratchet, including
components and WebSocket utilities.

## Running Tests

```bash
# Unit tests (vitest workspace — includes webui via workspace projects)
pnpm test

# WebUI-only tests with coverage
pnpm --filter @wrongstack/webui test:coverage

# E2E tests (requires WebUI server running)
pnpm test:e2e

# Full release gate
pnpm release:check
```

## Adding E2E Tests

E2E tests live in `e2e/*.spec.ts` and use Playwright.

```bash
# Run E2E tests
pnpm test:e2e

# Add new component tests in `e2e/<component>.spec.ts`
```
