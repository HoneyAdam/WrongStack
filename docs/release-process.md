# Release Process

WrongStack's root manifest provides a full release command, a dry-run command,
and a narrow plugin invariant suite. Publication is currently maintainer-run:
there is no checked-in npm release workflow.

## Full gate — `release:check`

A broad correctness sweep run before anything goes to npm:

```bash
pnpm release:check
# ↪ pnpm audit --audit-level=moderate
#   pnpm build
#   node scripts/check-package-contracts.mjs
#   pnpm check:node-pty
#   pnpm lint:i18n
#   pnpm typecheck
#   pnpm test
```

**What it catches**: moderate-or-higher dependency audit findings (subject to the checked-in audit policy), build/type/test failures, package export/file contract drift, an unusable optional `node-pty`, and incomplete WebUI translations. Full `pnpm lint` and browser smoke are not part of this script.

**Caveat**: it runs the *full* vitest suite. A single broken
test anywhere in the monorepo blocks the release. That's by
design — we don't ship if anything is red.

## Narrow plugin guard — `prepublishOnly` / `test:guard`

The root manifest maps `prepublishOnly` to `pnpm test:guard`. It is useful when the root package lifecycle is invoked or when run explicitly, but it must not be described as a guaranteed hook for every recursively published child package: the public workspace package manifests do not each declare it. The full `pnpm release:check` remains the actual repository-wide gate.

```bash
pnpm prepublishOnly
# ↪ pnpm test:guard
#   ↪ vitest run packages/plugins/tests/catalog.test.ts
#           packages/plugins/tests/plugin-teardown.test.ts
#           packages/plugins/tests/smoke.test.ts
```

**What it guards**:

| File | Why it matters |
|------|-----------------|
| `packages/plugins/tests/catalog.test.ts` | The plugin catalog must list every plugin exported from `src/index.ts`. A mismatch means `spec-linker` (or any other consumer) will be stale on day one. |
| `packages/plugins/tests/plugin-teardown.test.ts` | Lifecycle expectations are checked across the 63 entries in `PLUGIN_CATALOG`. |
| `packages/plugins/tests/smoke.test.ts` | All 8 historic plugin files (the original 8 from the pre-catalog era) must still import and register. Catches broken barrel exports. |

**Why a separate script?** It gives maintainers focused feedback on catalog,
lifecycle, and barrel regressions. Avoid fixed timing claims: duration varies by
machine and the full suite is much larger than this three-file selection.

## When each layer runs

| Command | What runs |
|---------|-----------|
| `pnpm release` | `release:check`, then recursive public publish |
| `pnpm release:dry` | Recursive publish dry-run only; run `release:check` separately |
| `pnpm release:check` | Full repository release gate, no publication |
| `pnpm test:guard` / `pnpm prepublishOnly` | Three focused plugin tests only |
| `pnpm test` | Root Vitest suite, then the WebUI package test script |
| Tag push | No npm release action in the current repository |

## Adding a new guard

When the catalog grows (e.g. a new invariants test, a new
contract test) the guard list in `package.json` should be
extended:

```jsonc
{
  "scripts": {
    "test:guard": "vitest run packages/plugins/tests/catalog.test.ts packages/plugins/tests/plugin-teardown.test.ts packages/plugins/tests/smoke.test.ts packages/plugins/tests/<new-guard>.test.ts"
  }
}
```

The pattern: a guard test is **fast** (sub-second each), **specific**
(catches one well-defined class of regression), and **independent**
(doesn't depend on the plugin lifecycle state). The three
existing guards — catalog, H1 teardown, smoke — are the
baseline; new ones should match the same shape.

> The H1 teardown test enumerates every entry in
> `packages/plugins/src/catalog.ts`. The catalog itself enforces
> kebab-case names + uniqueness at module load, so any future plugin
> added to the index must also be added to the catalog — the
> `plugin-teardown.test.ts` guard catches a drift between the two.

## Why keep the focused guard

| Concern | `release:check` | `test:guard` |
|---------|-----------------|--------------|
| Type/build/audit/package-contract/i18n failures | ✅ | ❌ |
| Full test suite | ✅ | ❌ |
| Focused catalog/lifecycle/barrel feedback | Covered by full tests | ✅ |
| Guaranteed for each recursively published child | N/A | ❌ — child manifests do not declare this hook |

Do not bypass `pnpm release` on the assumption that a recursive publish will
run the root hook. For dry runs, use `pnpm release:check && pnpm release:dry`.
For a real release, `pnpm release` encodes the required ordering.

## Cross-references

- [`packages/plugins/src/catalog.ts`](../packages/plugins/src/catalog.ts) — what the catalog test guards
- [`docs/feature-matrix.md`](feature-matrix.md) — the 63 plugins the H1 teardown test covers
- [`packages/plugins/README.md`](../packages/plugins/README.md) — the plugin contract
- [`../RELEASE.md`](../RELEASE.md) — maintainer checklist, version bump, tagging, publication, and current automation status
- [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) — website deployment only; not an npm release workflow
