# Dependency Audit — WrongStack

**Scan date:** 2026-06 (full rescan via /security-check)
**Tool:** pnpm audit (production dependencies)
**Scope:** All workspace packages (`packages/*`, `apps/*`), resolved via pnpm 11 lockfile.

## Summary

- **Advisories:** 0 (zero)
- **Vulnerabilities by severity:** info=0, low=0, moderate=0, high=0, critical=0
- **Production dependencies:** 210
- **Optional dependencies:** 3
- **Total resolved:** 213

**Verdict:** Excellent supply-chain hygiene. No known vulnerabilities in the production dependency tree.

## Key Observations

1. **Lockfile & Reproducibility**
   - Strong `pnpm-lock.yaml` committed.
   - `packageManager` field pinned to exact pnpm version + sha.
   - Workspace uses explicit `workspace:*` references between internal packages.

2. **Build / Lifecycle Script Controls**
   - Root `package.json` has `postinstall` that only sets git hooks path (`git config core.hooksPath .githooks`).
   - pnpm-workspace.yaml explicitly allows builds for a small set:
     ```yaml
     onlyBuiltDependencies:
       - "@biomejs/biome"
       - better-sqlite3
       - esbuild
     ```
   - `allowBuilds` also limited. This significantly reduces postinstall attack surface compared to default `npm install`.

3. **No High-Risk Native / Binary Packages in Core Paths**
   - better-sqlite3 is allowed (used by session/memory stores in core for local persistence).
   - No `node-gyp`, `fsevents`, or other heavy native packages in the critical agent path beyond the allowlist.

4. **Previous Scan Notes (verified)**
   - The 2026-05-31 scan also reported 0 advisories.
   - No new vulnerable packages introduced since the fixes for F-01–F-07.

## Recommendations (Low Priority)

- Continue running `pnpm audit` in CI (already part of release:check gate indirectly via tests).
- Consider adding `pnpm audit --audit-level=moderate` as an explicit step in `release:check` or GitHub Actions if not already strict.
- Review any new direct dependencies (especially those with `postinstall`/`prepare` scripts) before adding; the current onlyBuiltDependencies list is a good allowlist to maintain.

## Files Referenced

- `pnpm-lock.yaml` (root)
- `pnpm-workspace.yaml`
- Root `package.json` (scripts + devDeps only)
- Per-package `package.json` files (actual runtime deps live in `@wrongstack/*` packages)

**No action required.** Dependency risk is minimal and well-controlled.
