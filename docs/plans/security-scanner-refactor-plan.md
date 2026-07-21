# Security Scanner — Deep-Dive Refactor Plan

> **Package**: `packages/security-scanner` (`@wrongstack/security-scanner`)  
> **Version**: 0.295.0  
> **Date**: 2026-07-21  
> **Scope**: Architecture, code quality, test coverage, and capability gaps

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture](#2-current-architecture)
3. [Findings & Recommendations](#3-findings--recommendations)
   - 3.1 [Critical](#31-critical)
   - 3.2 [High](#32-high)
   - 3.3 [Medium](#33-medium)
   - 3.4 [Low](#34-low)
4. [Dependency Graph](#4-dependency-graph)
5. [Phased Execution Plan](#5-phased-execution-plan)
6. [Verification & Acceptance Criteria](#6-verification--acceptance-criteria)

---

## 1. Executive Summary

The `@wrongstack/security-scanner` package is a standalone security scanning tool extracted from `@wrongstack/core`. It detects tech stacks, generates project-specific security skills (via LLM or static patterns), scans source files for vulnerabilities using both regex patterns and LLM-assisted analysis, and produces reports in markdown, JSON, or HTML formats.

The current codebase is **well-structured with clean module boundaries** and has **excellent test coverage** (11 test files including edge-case coverage for the `lastIndex` regex bug fix and XSS escaping in HTML reports). The LLM orchestration layer has robust retry, abort, and fallback logic.

However, several structural issues have accumulated:

| Category | Count | Key Issue |
|----------|-------|-----------|
| **Critical** | 3 | Fragile category heuristic, duplicated file gathering, OS-specific path bug |
| **High** | 4 | No dependency parsing, unused option, fake audit command, regex JSON parsing |
| **Medium** | 4 | Dynamic import, no confidence scoring, sequential IO, stubbed dependency |
| **Low** | 3 | Dead code branches, naming clarity, hardcoded constants |

**Estimated effort**: ~3-5 days for a single developer to address all findings.

---

## 2. Current Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│   TechStackDetector │────▶│    SkillGenerator     │
│   (static detect)   │     │  (static patterns)    │
└─────────┬───────────┘     └──────────┬────────────┘
          │                            │
          ▼                            ▼
┌─────────────────────────────────────────────┐
│         SecurityScannerOrchestrator          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ LLM Sk.  │  │LLM Scan  │  │LLM Report │  │
│  │ Generate │─▶│  Batch   │─▶│ Synthesize│  │
│  └──────────┘  └────┬─────┘  └─────┬─────┘  │
│                     │              │         │
│  ┌──────────────────▼──────────────▼──────┐  │
│  │        Fallback Chain per step         │  │
│  │  (static skill / basic report / [] )   │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
          │                            │
          ▼                            ▼
┌──────────────────┐     ┌──────────────────────┐
│   ReportGenerator │     │    GitignoreUpdater   │
│ (md/json/html)    │     │  (.gitignore mgmt)    │
└──────────────────┘     └──────────────────────┘
```

### 2.1 Module Responsibilities

| Module | Responsibility | Lines | Dependencies |
|--------|---------------|-------|--------------|
| `types.ts` | Shared type definitions | 98 | None |
| `detector.ts` | Tech stack detection via file signatures | 294 | `node:fs/promises` |
| `skill-generator.ts` | Static pattern generation per stack | 496 | None |
| `scanner.ts` | Regex-based file scanning | 256 | `node:fs/promises` |
| `orchestrator.ts` | LLM-powered orchestration + retry + fallback | 769 | `@wrongstack/core` |
| `report-generator.ts` | Report rendering (3 formats) | 316 | `@wrongstack/core` |
| `slash-command.ts` | `/security` CLI interface | 271 | `@wrongstack/core` |
| `gitignore-updater.ts` | `.gitignore` management | 70 | `@wrongstack/core` |
| `_compat-types.ts` | Type compat shims | 39 | `@wrongstack/core` |

### 2.2 Data Flow

```
SecurityScannerOrchestrator.run(ctx, options)
  │
  ├─ 1. TechStackDetector.detect(projectRoot)
  │      → DetectionResult { detectedStacks, isMonorepo, ... }
  │      Error: ConfigError("No supported tech stack") if empty
  │
  ├─ 2. generateSkillLLM(provider, model, ...)
  │      → GeneratedSkill { patterns, metadata, ... }
  │      Fallback: generateFallbackSkill() → static patterns, confidence=0.5
  │
  ├─ 3. scanWithLLM(provider, model, skill, ...)
  │      → ScanResult { findings[], summary, scannedFiles, ... }
  │      Sub-steps: gatherFiles → batch(10) → scanFileBatchLLM → aggregate
  │      Fallback: empty findings
  │
  ├─ 4. synthesizeReportLLM(provider, model, ...)
  │      → string (markdown report)
  │      Fallback: generateBasicReport() → markdown table
  │
  ├─ 5. writeReport(content, options)
  │      → reportPath (file on disk)
  │
  └─ 6. gitignoreUpdater.update()
         → { added, existing, errors }
```

---

## 3. Findings & Recommendations

### 3.1 Critical

#### 🔴 C1 — `matchesCategory()` Relies on Fragile Substring Heuristic

**File**: `scanner.ts:210-226`  
**Severity**: 🔴 Critical  
**Risk**: Category misclassification, incorrect inclusion/exclusion of patterns  
**Test coverage**: Tested indirectly via edge tests (`scanner-edge.test.ts`), but not explicitly for the heuristic

```typescript
// Current — brittle substring matching
private matchesCategory(pattern: SecurityPattern): boolean {
  if (pattern.id.includes('secret') || pattern.id.includes('npmrc') || pattern.id.includes('env')) {
    return this.options.includeSecrets;
  }
  if (pattern.id.includes('injection') || pattern.id.includes('sql') || pattern.id.includes('command') || pattern.id.includes('eval')) {
    return this.options.includeInjection;
  }
  if (pattern.id.includes('config') || pattern.id.includes('tls') || pattern.id.includes('debug')) {
    return this.options.includeConfig;
  }
  return true; // ← dependency patterns fall here without any check
}
```

**Problems**:
- Pattern IDs are chosen at definition time — a substring like `"config"` in `"firewall-config-injection"` would match the wrong branch (first match wins: `injection` because `".includes('injection')"` matches before config)
- `"dependency"`-categorized patterns fall through to `return true` regardless of `includeDependencies`
- No unit test directly exercises this method; only integration tests through `scan()` cover it

**Recommendation**: Add an explicit `category` field to `SecurityPattern`:

```typescript
interface SecurityPattern {
  // ... existing fields
  category?: Finding['category']; // explicit override; falls back to getCategoryFromPattern
}
```

Replace the heuristic with a direct switch:
```typescript
private matchesCategory(pattern: SecurityPattern): boolean {
  const cat = pattern.category ?? this.inferCategoryFromId(pattern.id);
  switch (cat) {
    case 'secrets':     return this.options.includeSecrets;
    case 'injection':   return this.options.includeInjection;
    case 'config':      return this.options.includeConfig;
    case 'dependency':  return this.options.includeDependencies;
    default:            return true; // 'filesystem' etc.
  }
}
```

**Effort**: ~1 hour  
**Risk**: Low — purely additive, old heuristic remains as fallback

---

#### 🔴 C2 — Duplicated `gatherFiles()` Implementations

**Files**: `scanner.ts:103-138` and `orchestrator.ts:649-703`  
**Severity**: 🔴 Critical  
**Risk**: Bug divergence, maintenance burden, inconsistent behaviour

Both `SecurityScanner` and `SecurityScannerOrchestrator` implement their own recursive file gathering with subtle differences:

| Aspect | `SecurityScanner` | `SecurityScannerOrchestrator` |
|--------|-------------------|-------------------------------|
| Exclude logic | `excludePaths` option (dir name match) | Hardcoded: node_modules, dist, build, .git, coverage, `.`-prefixed dirs |
| Extension source | From `skill.patterns[*].fileExtensions` | Hardcoded list `['.ts', '.js', '.jsx', '.tsx', '.py', '.go', '.java', '.cs', '.rs']` |
| Depth var | `maxDepth` | `maxDepth` (identical) |
| Error handling | Silent catch | Silent catch |
| `shouldExclude` | Separated method | Inline in loop |

**Recommendation**: Extract to a shared utility module, e.g. `src/file-gathering.ts`:

```typescript
// New shared module
export interface GatherFilesOptions {
  root: string;
  extensions: string[];
  maxDepth: number;
  excludePatterns?: string[];       // directory names to exclude
  excludeHidden?: boolean;           // skip dot-prefixed directories
}

export async function gatherFiles(options: GatherFilesOptions): Promise<string[]> { ... }
export function shouldExcludeDir(name: string, excludePatterns: string[]): boolean { ... }
```

**Effort**: ~2 hours  
**Risk**: Low — pure extraction, no behavioural change

---

#### 🔴 C3 — `Finding.id` Contains OS-Specific Absolute Path

**File**: `scanner.ts:190`  
**Severity**: 🔴 Critical  
**Risk**: Non-deterministic IDs across platforms, `process.cwd()` dependency

```typescript
// Line 190
id: `${pattern.id}-${filePath}-${lineNum}`,
// `filePath` here is the absolute path from gatherFiles
```

Additionally, line 195:
```typescript
file: relative(process.cwd(), filePath),
// Depends on mutable process.cwd() which can change at runtime
```

**Problems**:
- `Finding.id` uses the full absolute path — on Windows this embeds backslashes, on Unix forward slashes. Cross-platform comparison fails.
- `process.cwd()` can be changed by `process.chdir()` at runtime — the relative path becomes stale.
- `id` is used for deduplication in consumers; non-deterministic IDs cause duplicate entries.

**Recommendation**:
```typescript
// Normalize the file path for ID computation
const normalizedPath = relativePath.replace(/\\/g, '/');
id: `${pattern.id}-${normalizedPath}-${lineNum}`,
file: normalizedPath,
```

Where `relativePath` is computed once at the `scan()` level from the known `projectRoot`:
```typescript
// In scan(), pass projectRoot down instead of relying on process.cwd()
const relativePath = relative(projectRoot, filePath).replace(/\\/g, '/');
```

**Effort**: ~30 minutes  
**Risk**: Low — pure path normalization

---

### 3.2 High

#### 🟠 H1 — No Real Dependency Parsing

**File**: `detector.ts`  
**Severity**: 🟠 High  
**Risk**: `TechStackInfo.dependencies` is always `[]`, weakening both skill generation and reporting

The `TechStackDetector` identifies the stack type and package manager but never parses the actual manifest files:

```typescript
// detector.ts:236-242
return {
  stack: signature.stack,
  packageManager: signature.packageManager,
  manifestFile: manifestMatch,
  dependencies: [],             // ← always empty
  projectPath: '',
};
```

The orchestrator compensates by reading `package.json` as raw text for the LLM (`gatherProjectInfo`, lines 609-644), but the structured `dependencies` field remains unused. This means:
1. The `SkillGenerator` receives empty dependencies — its confidence calculation never gets the +0.1 bonus
2. The LLM skill generation prompt receives dependency info only as free-text, not structured
3. No dependency vulnerability scanning is possible without parsing

**Recommendation**: Add a lightweight manifest parser:

```typescript
// New file: src/manifest-parser.ts or extend detector.ts
export function parseNodeDependencies(content: string): DetectedDependency[] { ... }
export function parsePythonDependencies(content: string): DetectedDependency[] { ... }
export function parseRustDependencies(content: string): DetectedDependency[] { ... }
// etc.
```

For a minimal implementation, parse the top-level `dependencies` and `devDependencies` from `package.json` (the most common case). Other ecosystems can be added incrementally.

**Effort**: ~3-4 hours  
**Risk**: Low to Medium — needs careful edge-case handling (malformed JSON, circular deps, etc.)

---

#### 🟠 H2 — `ScanOptions.includeDependencies` Is Never Checked

**File**: `scanner.ts:210-226`  
**Severity**: 🟠 High  
**Risk**: Dead option in public API, users expect it to work

The `ScanOptions` interface (scanner.ts:37-45) declares:
```typescript
export interface ScanOptions {
  includeDependencies: boolean;
  // ...
}
```

But `matchesCategory()` has no branch for dependency category — patterns with dependency-related IDs fall through to `return true`. The option is silently ignored.

Two possible fixes:
1. (Recommended) Add the dependency branch to `matchesCategory()` as described in **C1**
2. (Minimal) Remove the field from the interface if it's never intended to filter

**Effort**: ~15 minutes  
**Risk**: Low

---

#### 🟠 H3 — `/security audit` Does Not Perform Real Auditing

**Files**: `slash-command.ts:130-177` and `orchestrator.ts:137-217`  
**Severity**: 🟠 High  
**Risk**: Misleading UX — users expect dependency audit, get same scan

The `/security audit` command:
```typescript
async function handleAudit(ctx: Context) {
  const result = await defaultOrchestrator.run(providerInfo, {
    projectRoot,
    reportOptions: { format: 'markdown' },
  });
  // ^^ Exactly the same call as handleScan
}
```

It runs the exact same pipeline as `/security scan`. No `npm audit`, `pnpm audit`, or any package-manager vulnerability database is consulted.

**Recommendation**: Run real package manager audit:

```typescript
async function handleAudit(ctx: Context) {
  // Step 1: Run package manager audit
  const auditResult = await runPackageAudit(projectRoot);
  
  // Step 2: Run security scan (optional, or deep scan)
  const scanResult = await defaultOrchestrator.run(providerInfo, { ... });
  
  // Step 3: Merge results
  return { audit: auditResult, scan: scanResult };
}

async function runPackageAudit(root: string): Promise<PackageAuditResult> {
  // Detect package manager from existing files
  // Run: pnpm audit --json or npm audit --json
  // Parse JSON output
  // Return structured vulnerability data
}
```

**Effort**: ~2-3 hours  
**Risk**: Medium — `pnpm audit --json` output parsing, retry handling, offline fallback

---

#### 🟠 H4 — LLM JSON Parsing via Regex Is Fragile

**File**: `orchestrator.ts:272-276, 417-420`  
**Severity**: 🟠 High  
**Risk**: LLM output changes cause silent parse failures, findings lost

```typescript
// Skill generation
const jsonMatch = text.match(/\{[\s\S]*\}/);

// Batch scan
const jsonMatch = text.match(/\[[\s\S]*\]/);
```

Both use a greedy `[\s\S]*` that matches the **first** `{…}` or `[…\]` pair. Problems:
- Nested objects: `{"outer": {"inner": "value"}}` — the regex captures from the first `{` to the last `}`, which works for flat JSON but fails with balanced-brace requirements
- Markdown-wrapped responses: If the LLM returns `` ```json … ``` ``, the regex may capture too much or too little
- Multiple JSON blocks: Only the first match is used

**Recommendation**: Use a proper streaming parser or at minimum a balanced-brace extractor:

```typescript
// Option A: Extract from markdown code fence first
function extractJsonBlock(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) return fenceMatch[1];
  // Fallback to brace matching
  return extractBalancedBrace(text);
}

// Option B: Balanced brace matching
function extractBalancedBrace(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (start === -1) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
```

**Effort**: ~1 hour  
**Risk**: Low — no behavioural change for valid JSON, improves resilience

---

### 3.3 Medium

#### 🟡 M1 — `ReportGenerator` Uses Unnecessary Dynamic Import

**File**: `report-generator.ts:57`  
**Severity**: 🟡 Medium  
**Risk**: Code smell, minor performance impact

```typescript
const { mkdir } = await import('node:fs/promises');
```

`node:fs/promises` is already imported at the top of the file (line 1), and `mkdir` is the only function used from this dynamic import. The top-level import only imports `stat`, but `mkdir` could be added there:

```typescript
// Line 1 — already has stat
import { stat, mkdir } from 'node:fs/promises';
```

Then remove the dynamic import on line 57 and the `await import(...)` wrapper.

**Effort**: ~5 minutes  
**Risk**: None

---

#### 🟡 M2 — `confidence: 'high'` for All Regex Matches

**File**: `scanner.ts:200`  
**Severity**: 🟡 Medium  
**Risk**: Consumers cannot distinguish high-confidence from low-confidence findings

```typescript
findings.push({
  // ...
  confidence: 'high',  // ← always 'high'
});
```

All regex matches get `confidence: 'high'` regardless of:
- Pattern specificity (a generic `/password\s*=/` vs an explicit `/ghp_[a-zA-Z0-9]{36}/`)
- Context (test file vs production code)
- False-positive marker proximity

**Recommendation**: Add pattern-level confidence:
```typescript
interface SecurityPattern {
  // ... existing
  confidence?: 'high' | 'medium' | 'low';  // default 'medium'
}
```

When creating findings, propagate the pattern's declared confidence:
```typescript
confidence: pattern.confidence ?? 'medium',
```

Then tag patterns:
- High: specific token regexes (`ghp_`, `-----BEGIN.*PRIVATE KEY-----`)
- Medium: generic patterns (`password\s*=`, `api_key\s*=`)
- Low: heuristics (`debug\s*=\s*true`, `TODO` matches)

**Effort**: ~30 minutes  
**Risk**: Low

---

#### 🟡 M3 — No Parallel or Incremental File Scanning

**Files**: `scanner.ts:73-82`, `orchestrator.ts:334-340`  
**Severity**: 🟡 Medium  
**Risk**: Slow scans on large codebases

Both scanners process files sequentially:
- `SecurityScanner.scan()` reads each file one at a time with `await readFile`
- `SecurityScannerOrchestrator.scanWithLLM()` batches but the batches are sequential

For a codebase with thousands of files, this is unnecessarily slow on modern multi-core hardware.

**Recommendation**: Use `Promise.allSettled` with a concurrency limiter:

```typescript
// For regex scanner (I/O bound)
async function scanFiles(
  files: string[],
  scanFn: (content: string, path: string) => Finding[],
  concurrency = 10,
): Promise<Finding[]> {
  const results: Finding[][] = [];
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (file) => {
        const content = await readFile(file, 'utf-8');
        return scanFn(content, file);
      }),
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }
  return results.flat();
}
```

**Effort**: ~1-2 hours  
**Risk**: Low — careful error handling already present

---

#### 🟡 M4 — `TechStackDetector` Caching Ignores File Changes

**File**: `detector.ts:170-207`  
**Severity**: 🟡 Medium  
**Risk**: Stale detection results after project changes

The detector caches results in a `Map<string, DetectionResult>` with no expiry or invalidation. If the project's manifest files change between calls, the old result is returned.

**Recommendation**: Add TTL-based or file-mtime-based invalidation:
```typescript
private cachedResults: Map<string, { result: DetectionResult; timestamp: number }> = new Map();
private readonly cacheTTL = 30_000; // 30 seconds

async detect(projectRoot: string): Promise<DetectionResult> {
  const cached = this.cachedResults.get(projectRoot);
  if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
    return cached.result;
  }
  // ... detect
  this.cachedResults.set(projectRoot, { result, timestamp: Date.now() });
  return result;
}
```

**Effort**: ~15 minutes  
**Risk**: None

---

### 3.4 Low

#### 🟢 L1 — `skill-generator.ts` Confidence Is Never Consumed

**File**: `skill-generator.ts:485-493`  
**Severity**: 🟢 Low

`calculateConfidence()` returns a value (0.7–1.0) stored in `GeneratedSkill.metadata.confidence`, but no consumer reads this field. It's stored and serialized but never acted upon.

**Recommendation**: Either remove the field and calculation (saving ~10 lines) or use it in `orchestrator.ts` to influence severity thresholds or reporting. If kept, document the intended consumer.

**Effort**: ~10 minutes  
**Risk**: None

---

#### 🟢 L2 — `SecurityScanner` Exclude Paths Only Match Exact Names

**File**: `scanner.ts:140-144`  
**Severity**: 🟢 Low

```typescript
private shouldExclude(name: string): boolean {
  return this.options.excludePaths.some(
    (exclude) => name === exclude || name.startsWith(exclude + '/') || name.startsWith(exclude + '\\')
  );
}
```

This only works for **directory names** at the current recursion level, not for nested paths like `**/dist/**`. A path like `packages/foo/dist/bar` is not excluded unless `dist` matches at the current depth. However, since `gatherFilesRecursive` recurses into each directory, it effectively skips the `dist` directory when encountered — so this works in practice for typical cases. The comment documents the limitation adequately.

**Recommendation**: Minor — add glob-style exclude support if users need patterns like `**/__pycache__/**`.

**Effort**: ~30 minutes for glob support  
**Risk**: Low

---

#### 🟢 L3 — Orchestrator Batch Size Is Hardcoded

**File**: `orchestrator.ts:333`  
**Severity**: 🟢 Low

```typescript
const batchSize = 10;
```

This constant works well for most cases but could be configurable for extreme projects (very large files → smaller batch, many small files → larger batch).

**Recommendation**: Expose as an optional `ScanOptions` parameter:
```typescript
export interface SecurityScannerOptions {
  // ...
  scanOptions?: {
    // ...
    llmBatchSize?: number;    // default 10
    fileConcurrency?: number; // default 10
  };
}
```

**Effort**: ~15 minutes  
**Risk**: None

---

## 4. Dependency Graph

```
Phase 1 (Low Risk / Quick Wins)
├── C3 — Finding path normalization        [~30m]
├── H2 — includeDependencies branch        [~15m]  ← blocked on C1
├── M1 — Remove dynamic import             [~5m]
├── M4 — Cache TTL                         [~15m]
├── L1 — Remove unused confidence calc     [~10m]
├── L3 — Configurable batch size           [~15m]
└── H4 — Balanced-brace JSON extraction    [~1h]

Phase 2 (Medium Risk / Consolidation)
├── C1 — Explicit category on SecurityPattern  [~1h]  ← blocks H2
├── C2 — Shared gatherFiles utility            [~2h]
├── M2 — Pattern-level confidence              [~30m]
├── M3 — Parallel file scanning                [~1-2h]
└── L2 — Glob-style exclude (optional)         [~30m]

Phase 3 (Larger Features)
├── H1 — Real dependency parsing           [~3-4h]
├── H3 — Real pnpm/npm audit integration   [~2-3h]
└── M2 extended — confidence scoring       [~1h]
```

**Total estimated effort**: ~1 day for phases 1+2, ~1.5 additional days for phase 3.

---

## 5. Phased Execution Plan

### Phase 1 — Quick Wins (Estimated: ~3 hours)

| Step | Task | Files | Risk |
|------|------|-------|------|
| 1.1 | Normalize `Finding.id` & `Finding.file` to use `projectRoot`-relative, forward-slash paths | `scanner.ts` | 🟢 |
| 1.2 | Remove unnecessary dynamic `import()` in report-generator | `report-generator.ts` | 🟢 |
| 1.3 | Add TTL-based cache invalidation to TechStackDetector | `detector.ts` | 🟢 |
| 1.4 | Implement balanced-brace JSON extraction for LLM parsing | `orchestrator.ts` | 🟢 |
| 1.5 | Add `llmBatchSize` and `fileConcurrency` to scan options | `orchestrator.ts`, `types.ts` | 🟢 |
| 1.6 | Remove unused `calculateConfidence()` or add consumer | `skill-generator.ts` | 🟢 |
| 1.7 | Write/add tests for all Phase 1 changes | Various test files | 🟢 |

### Phase 2 — Structural Improvements (Estimated: ~4-5 hours)

| Step | Task | Files | Risk |
|------|------|-------|------|
| 2.1 | Add explicit `category` field to `SecurityPattern` + update `matchesCategory()` | `types.ts`, `scanner.ts`, `skill-generator.ts` | 🟡 |
| 2.2 | Wire `includeDependencies` branch in `matchesCategory()` | `scanner.ts` | 🟢 |
| 2.3 | Extract shared `gatherFiles()` to `src/file-gathering.ts` | New file, `scanner.ts`, `orchestrator.ts` | 🟡 |
| 2.4 | Add pattern-level confidence scoring | `types.ts`, `scanner.ts`, `skill-generator.ts` | 🟢 |
| 2.5 | Parallelize regex file scanning with concurrency control | `scanner.ts` | 🟡 |
| 2.6 | Run full test suite + typecheck after changes | — | 🟢 |

### Phase 3 — Feature Gaps (Estimated: ~5-6 hours)

| Step | Task | Files | Risk |
|------|------|-------|------|
| 3.1 | Parse `package.json` dependencies in `TechStackDetector` | `detector.ts` or new `manifest-parser.ts` | 🟡 |
| 3.2 | Add `pnpm audit` / `npm audit` integration for `/security audit` | `slash-command.ts`, new `package-audit.ts` | 🟠 |
| 3.3 | Enhance confidence scoring with context analysis | `scanner.ts` | 🟡 |
| 3.4 | Integration test for Phase 3 features | Orchestrator flow tests | 🟡 |

---

## 6. Verification & Acceptance Criteria

### 6.1 Verification Gates

Every phase must pass:

```bash
# TypeScript strict typecheck
pnpm --filter @wrongstack/security-scanner typecheck

# Full test suite (all 11 test files)
pnpm --filter @wrongstack/security-scanner test

# Lint
pnpm --filter @wrongstack/security-scanner lint

# Coverage (existing: excellent; new code should maintain ≥80%)
pnpm --filter @wrongstack/security-scanner test -- --coverage
```

### 6.2 Acceptance Criteria

| ID | Criterion | How to verify |
|----|-----------|---------------|
| AC1 | `matchesCategory()` uses explicit `SecurityPattern.category` over substring heuristic | Unit test: pattern with ambiguous ID but explicit category is correctly routed |
| AC2 | `gatherFiles()` is a single shared implementation with consistent exclude behaviour | Both `SecurityScanner` and `Orchestrator` call the same function |
| AC3 | `Finding.id` and `Finding.file` use forward-slash normalized paths relative to `projectRoot` | Cross-platform: run tests on both Unix and Windows CI |
| AC4 | `includeDependencies` toggle actually filters dependency patterns | Unit test: `includeDependencies: false` excludes dependency-category patterns |
| AC5 | `/security audit` runs real `pnpm audit` and includes results | Integration test: mock `exec` and verify parsed audit results in output |
| AC6 | LLM JSON parsing handles markdown-wrapped responses | Unit test: `` ```json\n{"key":"value"}\n``` `` extracts correctly |
| AC7 | No regression in existing findings count or severity distribution | Run the same test fixtures before and after changes |
| AC8 | HTML reports remain XSS-safe after any changes to `report-generator.ts` | Existing XSS regression test suite must pass |

### 6.3 Rollback Plan

Each phase is independently revertible via git:

```bash
# Phase 1 revert
git revert <phase-1-merge-commit>

# Phase 2 revert
git revert <phase-2-merge-commit>
```

Phases should be merged as separate PRs with at least one review cycle between them. Phase 3 depends on Phase 2 (specifically C1 for dependency parsing integration).

---

## 7. Implementation Result

**Status**: Implemented locally on 2026-07-21.

| Phase | Result |
|-------|--------|
| Phase 1 — Quick Wins | Complete |
| Phase 2 — Structural Improvements | Complete |
| Phase 3 — Feature Gaps | Complete |

The implementation includes explicit pattern categories and confidence, normalized project-relative finding IDs, shared file gathering with glob exclusions, bounded file concurrency, TTL-based detector caching, balanced LLM JSON extraction, Node manifest parsing, and real `pnpm`/`npm` package audit execution. Dependency audit results remain available when no LLM provider is configured or when the optional source scan fails.

### Verification Result

```text
Source typecheck:       passed
Test source typecheck:  passed
Build:                  passed
Biome lint:             passed
Tests:                  218 passed (20 files)
Statements:             94.59%
Branches:               82.30%
Functions:              88.41%
Lines:                  95.57%
```

All acceptance criteria have automated coverage, including the end-to-end package-audit path from an injected command executor through JSON parsing to `/security audit` output. Path normalization passed locally on Windows; the same platform-neutral assertions should remain enabled in Unix CI to complete the cross-platform environment gate in AC3.

---

## Appendix A: Test Coverage Analysis (Current)

| Test file | Tests | Branch coverage | Notes |
|-----------|-------|----------------|-------|
| `scanner.test.ts` | 8 | ~85% | Missing: explicit `matchesCategory` unit test, `getCategoryFromPattern` dependency branch |
| `scanner-edge.test.ts` | 11 | ~95% | Excellent edge coverage: injection/config/dependency branches, sort, FP markers |
| `detector.test.ts` | 12 | ~90% | All major stacks covered, caching tested |
| `skill-generator.test.ts` | 12 | ~85% | Per-stack generation, options, target files |
| `orchestrator-flow.test.ts` | 12 | ~90% | Full flow, LLM failures, retry policy, abort signal |
| `report-generator.test.ts` | 11 | ~95% | All formats, XSS escaping, error handling |
| `slash-command.test.ts` | 10 | ~90% | All subcommands, flag parsing, error states |
| `slash-command-edge.test.ts` | 4 | ~100% | Empty dir, boolean flags, readdir failures |
| `gitignore-updater.test.ts` | 7 | ~90% | Create/append/skip/error branches |

**Total**: ~87 tests, ~90% average branch coverage.

## Appendix B: Key Files Reference

| Path | Role | Change frequency |
|------|------|-----------------|
| `packages/security-scanner/src/types.ts` | Type definitions | Low |
| `packages/security-scanner/src/detector.ts` | Stack detection | Low |
| `packages/security-scanner/src/skill-generator.ts` | Pattern generation | Medium (when adding patterns) |
| `packages/security-scanner/src/scanner.ts` | Regex scanning | Medium |
| `packages/security-scanner/src/orchestrator.ts` | LLM orchestration | Medium |
| `packages/security-scanner/src/report-generator.ts` | Report rendering | Low |
| `packages/security-scanner/src/slash-command.ts` | CLI interface | Low |
| `packages/security-scanner/src/gitignore-updater.ts` | .gitignore management | Very low |
| `packages/security-scanner/src/_compat-types.ts` | Type shims | Very low |
| `packages/core/instructions/security-scanner/*.md` | LLM prompts | Low |
| `packages/core/skills/security-scanner/SKILL.md` | Skill definition | Very low |
