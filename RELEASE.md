# Release Checklist

Step-by-step guide for publishing a WrongStack release.

---

## Pre-release

- [ ] All tests pass: `pnpm test`
- [ ] Typecheck clean: `pnpm typecheck`
- [ ] Lint clean: `pnpm lint`
- [ ] Build clean: `pnpm build`
- [ ] Publish dry-run: `pnpm -r publish --dry-run --no-git-checks`

## Version bump

```bash
# Pick the right bump (patch / minor / major)
node scripts/bump-version.mjs minor

# Verify
git diff --stat
```

- [ ] Version bumped in all workspace packages
- [ ] CHANGELOG.md updated with release date and highlights

## Commit and tag

```bash
git commit -am 'release: 0.5.0'
git tag v0.5.0
git push --follow-tags
```

- [ ] Commit message follows `release: X.Y.Z` format
- [ ] Tag pushed (triggers the Release workflow)

## Verify CI

- [ ] GitHub Actions Release workflow passes
- [ ] Ubuntu and Windows CI jobs are green
- [ ] npm packages published successfully

## Post-release

- [ ] Verify packages on npm: `npm info @wrongstack/core`
- [ ] Test install: `npm install -g wrongstack && wrongstack version`
- [ ] Create or verify the GitHub Release and generated notes
- [ ] Update README.md "What's new" section if major release

## Hotfix process

If a critical bug is found after release:

```bash
git checkout v0.5.0
git checkout -b hotfix/0.5.1
# fix the bug
node scripts/bump-version.mjs patch
git commit -am 'release: 0.5.1'
git tag v0.5.1
git push --follow-tags
```

---

## Release workflow

The `.github/workflows/release.yml` automates:

1. Browser runtime smoke test, topological build, typecheck, and test gates on Ubuntu
2. Version tag verification (tag must match `package.json`)
3. Main-ancestry verification (the tagged commit must be contained in `origin/main`)
4. npm publication for validated tags, or a package dry-run for manual runs on `main`

**Trigger**: Push a tag matching `v*`, or manually run the workflow from `main`
for a dry-run. Manual workflow runs cannot publish.

**Required secrets**:
- `NPM_TOKEN` — npm authentication token with publish access

**Pre-release tags**: Tags containing `-` (e.g. `v1.0.0-beta.1`) are marked as pre-release on GitHub.

---

## npm publish dry run

To see exactly what would be published without actually publishing:

```bash
pnpm -r publish --dry-run --no-git-checks
```
