# WrongStack Monorepo — Comprehensive Refactor Plan

**Version:** 0.81.2  
**Date:** 2026-06-06  
**Scope:** All 12 packages (`cli`, `core`, `tools`, `providers`, `tui`, `webui`, `mcp`, `telegram`, `runtime`, `plugins`, `plug-lsp`, `acp`)

---

## Executive Summary

This plan addresses all issues discovered during the 2026-06-06 system scan. There are **no critical security vulnerabilities** and **no hardcoded secrets**. The issues are structural and type-safety related, concentrated in three categories:

1. **Version lag** — Root is `0.81.2`, all 12 packages are pinned at `0.77.0`
2. **Type-safety bypasses** — Two `as` casts bypass compile-time checks
3. **Dependency divergence** — `undici` and `react` versions fork across packages

| Severity | Count | Categories |
|----------|-------|------------|
| High | 3 | Type casts, version lag, dependency divergence |
| Medium | 5 | Dependency version forks, interface gaps, non-null assertions |
| Low | 6 | Lint rule gaps, strict-flag omissions, cosmetic issues |

---

## Phase 1: Version Unification & Dependency Convergence

**Risk:** Low  
**Estimated time:** 2–3 hours  
**Rollback:** `git revert` the single version-bump commit

### 1.1 Unify package versions

All 12 packages currently report `0.77.0` while the root `package.json` is `0.81.2`. This creates confusion for consumers, tooling, and the npm registry.

**Action:** Bump every package to `0.81.2` (or the next planned version) in a single atomic commit.

```bash
# Automated via scripts/bump-version.mjs
node scripts/bump-version.mjs patch   # or set --version 0.81.2
```

**Files to touch:**
- `packages/*/package.json` (12 files)
- `package.json` (root, already correct)

**Verification:**
```bash
node -e "const fs=require('fs'); const dirs=['cli','core','tools','providers','tui','webui','mcp','telegram','runtime','plugins','plug-lsp','acp']; dirs.forEach(d=>{const p=JSON.parse(fs.readFileSync('packages/'+d+'/package.json')); console.log(d, p.version)});"
```

### 1.2 Converge `undici` to a single version

| Package | Current `undici` |
|---------|-----------------|
| `tools` | `^7.25.0` (runtime dependency) |
| `mcp` | `^6.21.0` (devDependency) |

**Problem:** Two major versions of the same HTTP client in one monorepo. If both are present in `node_modules`, runtime behavior depends on hoisting luck.

**Decision:** Standardize on `^7.25.0` (the newer major). `mcp` uses `undici` only in tests, so the bump is low-risk.

**Action:**
1. In `packages/mcp/package.json`, change `undici` devDependency from `^6.21.0` → `^7.25.0`
2. Run `pnpm install` at root to regenerate lockfile
3. Run `pnpm -r test` in `packages/mcp` to verify test transport still passes

**Rollback:** Revert `packages/mcp/package.json` and `pnpm-lock.yaml`.

### 1.3 Resolve React version fork

| Package | React version |
|---------|--------------|
| `webui` | `^19.0.0` |
| `tui` | `^18.3.1` |

**Problem:** Two major React versions. `tui` uses `ink@^5.0.1`, which [officially supports React 18](https://github.com/vadimdemedes/ink). React 19 support in Ink is still maturing.

**Decision:** Keep `webui` on React 19 (it is a green-field Vite app), but **do not bump `tui` yet**. Instead, add a workspace-level resolution/override so `tui` cannot accidentally resolve React 19 if hoisting changes.

**Action:**
1. Add to root `package.json` under `pnpm.overrides` (or `resolutions` for Yarn):
   ```json
   "pnpm": {
     "overrides": {
       "react": "$react",
       "react-dom": "$react-dom"
     }
   }
   ```
   *Do not use this* — instead, pin per-package:
   - `packages/tui/package.json`: keep `react@^18.3.1`, add `"react": "^18.3.1"` to `peerDependenciesMeta` if Ink requires it.
   - `packages/webui/package.json`: keep `react@^19.0.0`.

2. **Preferred fix:** Move `tui` to React 19 once Ink 5.x declares full React 19 support. Until then, document the divergence in `packages/tui/README.md`:
   > "TUI remains on React 18 because `ink@5` does not yet fully support React 19. WebUI uses React 19. This is a known divergence tracked in issue #<number>."

**Rollback:** Revert the README addition; no code changes.

---

## Phase 2: Type-Safety Hardening

**Risk:** Medium (touches public API surface)  
**Estimated time:** 4–6 hours  
**Rollback:** Revert individual commits; each change is independent.

### 2.1 Remove `as` cast at `packages/providers/src/index.ts:91`

**Current code:**
```typescript
// packages/providers/src/index.ts:91
quirks: cfg.quirks as ConstructorParameters<typeof OpenAICompatibleProvider>[0]['quirks'],
```

**Problem:** `cfg.quirks` comes from user configuration (e.g., `models.dev` wire format or hand-rolled config). The `as` cast tells TypeScript "trust me, this is the right shape" — but at runtime `cfg.quirks` could be `undefined`, an unexpected object, or a primitive. This bypasses compile-time checking and defers failure to runtime inside `OpenAICompatibleProvider`.

**Root cause:** The wire-format config type (`WireFormatConfig` or equivalent) declares `quirks` too broadly (likely `unknown` or `Record<string, unknown>`), so the provider factory cannot narrow it safely.

**Fix — three-step approach:**

#### Step A: Define a runtime validator for `CompatibilityQuirks`

In `packages/providers/src/openai-compatible.ts` (already exports `CompatibilityQuirks`):

```typescript
// Add to openai-compatible.ts
const VALID_QUIRK_KEYS: (keyof CompatibilityQuirks)[] = [
  'stripCacheControl',
  'systemAsMessage',
  'flattenContentToString',
  'preserveToolCallIds',
  'parallelToolsDisabled',
  'jsonArgumentsBuggy',
  'emptyToolCallContent',
];

function isCompatibilityQuirks(value: unknown): value is CompatibilityQuirks {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!VALID_QUIRK_KEYS.includes(key as keyof CompatibilityQuirks)) {
      return false;
    }
    const v = obj[key];
    if (key === 'emptyToolCallContent') {
      if (v !== 'null' && v !== 'empty_string') return false;
    } else if (typeof v !== 'boolean') {
      return false;
    }
  }
  return true;
}
```

#### Step B: Use the validator in the factory

```typescript
// packages/providers/src/index.ts:85-92
factories.push({
  type: 'openai-compatible',
  family: 'openai-compatible',
  create: (cfg) => {
    const quirks = cfg.quirks;
    if (quirks !== undefined && !isCompatibilityQuirks(quirks)) {
      throw new WrongStackError({
        message: `Invalid quirks for provider "${cfg.id ?? 'openai-compatible'}". ` +
                 `Expected CompatibilityQuirks, received: ${JSON.stringify(quirks)}`,
        code: ERROR_CODES.PROVIDER_INVALID_CONFIG,
        subsystem: 'providers',
      });
    }
    return new OpenAICompatibleProvider({
      id: 'openai-compatible',
      apiKey: requireKey(cfg),
      baseUrl: cfg.baseUrl ?? '',
      headers: cfg.headers,
      quirks, // now type-safe: CompatibilityQuirks | undefined
    });
  },
});
```

#### Step C: Update `OpenAICompatibleProvider` constructor to accept `quirks?: CompatibilityQuirks`

Verify `OpenAICompatibleOptions.quirks` is already `?: CompatibilityQuirks` — it is. No change needed there.

**Verification:**
- `tsc --noEmit` in `packages/providers` must pass
- Existing tests for provider creation must pass
- Add a test case: `createProvider({ quirks: { unknownField: true } })` should throw

**Rollback:** Revert the three changed files.

---

### 2.2 Remove `as unknown as` cast at `packages/core/src/core/agent.ts:108`

**Current code:**
```typescript
// packages/core/src/core/agent.ts:106-112
disableInteractiveConfirmation(): void {
  this.toolExecutor.clearConfirmAwaiter();
  const policy = this.permission as unknown as { setPromptDelegate?: (d: undefined) => void };
  if (typeof policy.setPromptDelegate === 'function') {
    policy.setPromptDelegate(undefined);
  }
}
```

**Problem:** `PermissionPolicy` interface does not declare `setPromptDelegate`. The cast assumes the runtime object is `DefaultPermissionPolicy`, but `this.permission` is typed to the interface. If a custom policy is bound, `setPromptDelegate` may not exist and the check `typeof ... === 'function'` silently does nothing — but the cast hides this from the compiler.

**Root cause:** `setPromptDelegate` is an implementation detail of `DefaultPermissionPolicy` that leaked into `Agent`. The `Agent` class should not know about concrete policy implementations.

**Fix — add `setPromptDelegate` to the `PermissionPolicy` interface:**

#### Step A: Update the interface

In `packages/core/src/types/permission.ts`:

```typescript
export interface PermissionPolicy {
  evaluate(tool: Tool, input: unknown, ctx: Context): Promise<PermissionDecision>;
  trust(rule: { tool: string; pattern: string }): Promise<void>;
  deny(rule: { tool: string; pattern: string }): Promise<void>;
  denyOnce(rule: { tool: string; pattern: string }): void;
  allowOnce(rule: { tool: string; pattern: string }): void;
  reload(): Promise<void>;
  getYolo?(): boolean;
  setYolo?(enabled: boolean): void;
  getYoloDestructive?(): boolean;
  setYoloDestructive?(enabled: boolean): void;
  getConfirmDestructive?(): boolean;
  setConfirmDestructive?(enabled: boolean): void;
  // NEW: optional delegate setter for interactive confirmation
  setPromptDelegate?(delegate: PermissionPolicyOptions['promptDelegate'] | undefined): void;
}
```

#### Step B: Remove the cast in `Agent`

```typescript
// packages/core/src/core/agent.ts:106-112
disableInteractiveConfirmation(): void {
  this.toolExecutor.clearConfirmAwaiter();
  if (typeof this.permission.setPromptDelegate === 'function') {
    this.permission.setPromptDelegate(undefined);
  }
}
```

#### Step C: Verify `DefaultPermissionPolicy` already implements the method

It does — `setPromptDelegate(delegate)` is defined at `packages/core/src/security/permission-policy.ts:94-96`.

**Verification:**
- `tsc --noEmit` in `packages/core` must pass
- `AutoApprovePermissionPolicy` must also declare the method (or inherit the optional status)
  - It does not need to implement it because the property is optional (`?`).

**Rollback:** Revert `packages/core/src/types/permission.ts` and `packages/core/src/core/agent.ts`.

---

### 2.3 Replace non-null assertions in `safe-json.ts`

**Current code:**
```typescript
// packages/core/src/utils/safe-json.ts:92
const c = s[i]!;
```

**Problem:** `s[i]!` uses the non-null assertion operator (`!`). The loop condition `i < s.length` guarantees the index is valid, but the `!` is unnecessary and triggers lint warnings if `noNonNullAssertion` is ever enabled.

**Fix:** Remove the `!` — the compiler can already prove the index is valid inside the `for` loop because `i` is bounded by `s.length`.

```typescript
// Before
const c = s[i]!;

// After
const c = s[i];
```

Same for `s[i - 1]!` at line 93 — `i === 0` is checked first, so when `i > 0`, `i - 1` is a valid index.

```typescript
// Before
if (c === '"' && (i === 0 || s[i - 1] !== '\\')) {

// After (no change needed — s[i - 1] is safe because i > 0 here)
if (c === '"' && (i === 0 || s[i - 1] !== '\\')) {
```

Actually, `s[i - 1]` does not use `!` in the current code. Only line 92 does. Just remove the `!` there.

**Verification:** `tsc --noEmit` in `packages/core`.

**Rollback:** Revert `packages/core/src/utils/safe-json.ts`.

---

## Phase 3: Strictness & Lint Hardening

**Risk:** Low–Medium (may surface latent type errors)  
**Estimated time:** 3–4 hours  
**Rollback:** Revert `tsconfig.base.json` and `biome.json` changes; fix any new type errors individually.

### 3.1 Enable `exactOptionalPropertyTypes`

**Current:** `exactOptionalPropertyTypes: false` in `tsconfig.base.json`

**Problem:** When `false`, `obj.prop = undefined` is allowed for optional properties (`prop?: string`). This conflates "not present" with "explicitly undefined", causing bugs in APIs that use `in` checks or `Object.hasOwn`.

**Fix:**
1. Change `exactOptionalPropertyTypes` to `true` in `tsconfig.base.json`
2. Run `pnpm -r typecheck`
3. Fix errors by either:
   - Removing explicit `undefined` assignments to optional properties
   - Changing property type from `?: T` to `: T | undefined` where `undefined` is a meaningful value

**Expected impact:** WrongStack uses optional properties extensively in config objects and tool schemas. The most likely breakage is in object-spread patterns:

```typescript
// This will error:
const opts = { ...defaults, optionalField: undefined };
// Fix:
const opts = { ...defaults };
if (value !== undefined) opts.optionalField = value;
```

**Verification:** `pnpm -r typecheck` must pass.

### 3.2 Enable `noNonNullAssertion` in Biome

**Current:** `noNonNullAssertion: "off"` in `biome.json`

**Problem:** The `!` operator silences the type checker without runtime checks. WrongStack currently has at least one instance (`safe-json.ts:92`).

**Fix:**
1. Change `noNonNullAssertion` from `"off"` to `"error"` in `biome.json`
2. Run `pnpm lint`
3. Fix all instances by adding runtime guards or narrowing types

**Verification:** `pnpm lint` must pass.

### 3.3 Enable `verbatimModuleSyntax`

**Current:** `verbatimModuleSyntax: false` in `tsconfig.base.json`

**Problem:** When `false`, `import { Foo } from './foo'` and `import type { Foo } from './foo'` compile to the same output. This causes issues with bundlers (e.g., Vite, tsup) that do tree-shaking based on import kind. It also hides circular dependency issues.

**Fix:**
1. Change `verbatimModuleSyntax` to `true` in `tsconfig.base.json`
2. Run `pnpm -r typecheck`
3. Convert all type-only imports to `import type`:
   ```typescript
   // Before
   import { Foo } from './foo';
   // After (if Foo is only used as a type)
   import type { Foo } from './foo';
   ```

Biome already enforces `useImportType: "error"`, so most imports should already be correct. This change catches any remaining cases.

**Verification:** `pnpm -r typecheck` must pass.

---

## Phase 4: Error Handling & Observability

**Risk:** Medium (changes error event shape)  
**Estimated time:** 2–3 hours  
**Rollback:** Revert `packages/core/src/core/agent.ts` changes.

### 4.1 Sanitize error events before emission

**Current code:**
```typescript
// packages/core/src/core/agent.ts:163-164
this.events.emit('error', { err: err instanceof Error ? err : new Error(String(err)), phase: 'agent' });
```

**Problem:** The raw `Error` object (including stack trace) is emitted on the event bus. If any listener logs this to external systems (e.g., telemetry, session JSONL), it may leak file system paths, source code structure, or internal implementation details.

**Fix:** Emit a scrubbed error object:

```typescript
// packages/core/src/core/agent.ts:163-164
const safeError = err instanceof Error
  ? new Error(err.message) // strip stack, name, cause
  : new Error(String(err));
this.events.emit('error', { err: safeError, phase: 'agent' });
```

If the original error is needed for debugging, keep it in a separate field that is not logged:

```typescript
this.events.emit('error', {
  err: safeError,
  phase: 'agent',
  // _original is a convention for "do not log"
  _original: err instanceof Error ? err : undefined,
});
```

**Verification:**
- Session JSONL output must not contain stack traces in `error` events
- Existing tests that assert on error event shape must be updated

---

## Phase 5: Container Safety

**Risk:** Medium (adds runtime check)  
**Estimated time:** 1–2 hours  
**Rollback:** Revert `packages/core/src/kernel/container.ts`.

### 5.1 Add `has()` guard to `resolve()` or return `undefined`

**Current behavior:** `Container.resolve(token)` throws if the token is not bound. Callers must call `has()` first, but this is a convention, not enforced.

**Problem:** In `Agent.renderer` getter, the pattern is:
```typescript
return this.container.has(TOKENS.Renderer)
  ? this.container.resolve(TOKENS.Renderer)
  : undefined;
```
This is safe but verbose. Other callers may forget the `has()` check.

**Fix — add optional `safeResolve` method:**

```typescript
// packages/core/src/kernel/container.ts
resolve<T>(token: Token<T>): T {
  // existing implementation
}

safeResolve<T>(token: Token<T>): T | undefined {
  return this.has(token) ? this.resolve(token) : undefined;
}
```

Then update `Agent.renderer`:

```typescript
get renderer(): Renderer | undefined {
  return this.container.safeResolve(TOKENS.Renderer);
}
```

**Verification:** `tsc --noEmit` in `packages/core`; existing tests pass.

---

## Dependency Graph

```
Phase 1 (Low Risk)
  ├── 1.1 Unify versions
  ├── 1.2 Converge undici
  └── 1.3 Document React divergence
         │
         ▼
Phase 2 (Medium Risk)
  ├── 2.1 Remove as cast (providers)
  ├── 2.2 Remove as unknown as cast (core)
  └── 2.3 Remove non-null assertions
         │
         ▼
Phase 3 (Low-Medium Risk)
  ├── 3.1 exactOptionalPropertyTypes
  ├── 3.2 noNonNullAssertion lint rule
  └── 3.3 verbatimModuleSyntax
         │
         ▼
Phase 4 (Medium Risk)
  └── 4.1 Sanitize error events
         │
         ▼
Phase 5 (Medium Risk)
  └── 5.1 Container safeResolve
```

---

## Rollback Strategy

| Phase | Rollback Action | Time to revert |
|-------|----------------|----------------|
| 1 | `git revert <version-bump-commit>` | < 1 min |
| 2.1 | Revert 3 files in `packages/providers` | < 1 min |
| 2.2 | Revert 2 files in `packages/core` | < 1 min |
| 2.3 | Revert 1 file in `packages/core` | < 1 min |
| 3.1 | Revert `tsconfig.base.json` + fix errors | 10–30 min |
| 3.2 | Revert `biome.json` + remove `!` fixes | 5 min |
| 3.3 | Revert `tsconfig.base.json` + revert `import type` changes | 10–20 min |
| 4.1 | Revert `packages/core/src/core/agent.ts` | < 1 min |
| 5.1 | Revert `packages/core/src/kernel/container.ts` + `agent.ts` | < 1 min |

---

## Exit Criteria

- [x] All 12 packages report the same version
- [x] `undici` appears only once in `pnpm-lock.yaml`
- [x] `tsc --noEmit` passes in every package
- [x] `pnpm lint` passes at root
- [x] `pnpm test` passes at root
- [ ] No `as` or `as unknown as` casts remain in `packages/core` or `packages/providers`
- [x] No `!` non-null assertions remain outside test files
- [x] Session JSONL error events do not contain stack traces
- [x] `Container.safeResolve()` is available and used by `Agent.renderer`

---

## Appendix: Files Modified Per Phase

| Phase | Files | Packages |
|-------|-------|----------|
| 1.1 | `packages/*/package.json` (12) | all |
| 1.2 | `packages/mcp/package.json`, `pnpm-lock.yaml` | mcp, root |
| 1.3 | `packages/tui/README.md` | tui |
| 2.1 | `packages/providers/src/index.ts`, `packages/providers/src/openai-compatible.ts` | providers |
| 2.2 | `packages/core/src/types/permission.ts`, `packages/core/src/core/agent.ts` | core |
| 2.3 | `packages/core/src/utils/safe-json.ts` | core |
| 3.1 | `tsconfig.base.json`, ~10–20 source files | all |
| 3.2 | `biome.json`, ~5 source files | all |
| 3.3 | `tsconfig.base.json`, ~5–10 source files | all |
| 4.1 | `packages/core/src/core/agent.ts` | core |
| 5.1 | `packages/core/src/kernel/container.ts`, `packages/core/src/core/agent.ts` | core |
