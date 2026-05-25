import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_SRC = path.resolve(process.cwd(), 'packages/core/src');

/**
 * Allowed self-imports when scanning for @wrongstack/* workspace imports.
 * @wrongstack/core is always allowed (re-export barrel).
 * @wrongstack/kernel and @wrongstack/observability will be added once extracted.
 */
const ALLOWED_SELF_IMPORTS = new Set(['@wrongstack/core']);

/**
 * Core subdirectories that form the internal layer graph.
 * Listed from lowest level (kernel) to highest (application).
 */
const LAYERS = [
  'kernel',
  'types',
  'infrastructure',
  'core',
  'models',
  'security',
  'registry',
  'execution',
  'storage',
  'coordination',
  'plugin',
  'extension',
  'observability',
  'sdd',
  'skills',
] as const;

type LayerName = (typeof LAYERS)[number];

function layerOf(filePath: string): LayerName | null {
  const rel = path.relative(CORE_SRC, filePath);
  const seg = rel.split(path.sep)[0];
  return (LAYERS as readonly string[]).includes(seg) ? (seg as LayerName) : null;
}

/**
 * Matches import specifiers: `from '...'`, `import '...'`, `import(...)`.
 * Captures the specifier string (without quotes).
 */
const IMPORT_RE = /(?:from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

/**
 * Returns the import specifier if the match is a relative internal import
 * (starts with '../'), otherwise null.
 */
function relativeImport(spec: string): string | null {
  return spec.startsWith('../') ? spec : null;
}

/**
 * Given a relative import path like '../types/errors.js', resolves it to the
 * source subdirectory name (e.g. 'types'). Returns null if it cannot be
 * determined.
 */
function importTargetDir(relativePath: string): string | null {
  // '../types/errors.js' → 'types'
  const segments = relativePath.replace(/^\.\.\//, '').split('/');
  return segments[0] ?? null;
}

/**
 * Checks whether an import line uses `import type` (type-only import).
 * Type-only imports are erased at runtime and do not create runtime coupling.
 */
function isTypeOnlyImport(line: string): boolean {
  // Remove comments first to avoid false positives
  const withoutComments = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return /\bimport\s+type\b/.test(withoutComments);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ── Cross-package boundary tests ───────────────────────────────────────────────

describe('core cross-package boundaries', () => {
  const FORBIDDEN_WORKSPACE_IMPORT =
    /(?:from\s+['"]|import\s+['"]|import\s*\(\s*['"])(@wrongstack\/[^'"]+)/g;

  it('does not import higher-level WrongStack packages', async () => {
    const files = await walk(CORE_SRC);
    const violations: string[] = [];

    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(FORBIDDEN_WORKSPACE_IMPORT)) {
        const specifier = match[1];
        if (!specifier || ALLOWED_SELF_IMPORTS.has(specifier)) continue;
        violations.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

// ── Internal layer rule tests ──────────────────────────────────────────────────

/**
 * Internal layer dependency rules (from docs/architecture-rules.md):
 *
 * Rule 2  kernel/  may import runtime values only from types/.
 *           All other imports from other subdirs must be `import type`.
 *           Exception: WrongStackError from types/ is a permitted runtime import.
 *
 * Rule 3  core/    may not import runtime values from execution/,
 *           storage/, or coordination/.
 *
 * Rule 4  observability/ may not import runtime values from core/,
 *           execution/, storage/, or coordination/.
 *
 * Rule 5  security/ may not import from execution/, storage/, or coordination/.
 *
 * Rule 6  registry/ may not import from execution/, storage/, or coordination/.
 *
 * "Runtime import" means an import that is NOT `import type`.
 * `import type` from any subdir is always allowed (type-only imports
 * are erased at compile time and create no runtime coupling).
 */

describe('core internal layer rules', () => {
  /**
   * Collects all violations for a single file. A violation is a runtime import
   * from a forbidden subdirectory, given the file's own layer.
   */
  async function collectViolations(file: string): Promise<string[]> {
    const myLayer = layerOf(file);
    if (!myLayer) return [];

    const text = await fs.readFile(file, 'utf8');
    const violations: string[] = [];
    const importLines: Array<{ line: string; spec: string }> = [];

    // Collect import lines for context
    for (const importLine of text.split('\n')) {
      IMPORT_RE.lastIndex = 0;
      for (const match of importLine.matchAll(IMPORT_RE)) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (!spec) continue;
        const rel = relativeImport(spec);
        if (!rel) continue;
        importLines.push({ line: importLine.trim(), spec: rel });
      }
    }

    for (const { line, spec } of importLines) {
      const targetDir = importTargetDir(spec);
      if (!targetDir) continue;
      const targetLayer = (LAYERS as readonly string[]).includes(targetDir)
        ? (targetDir as LayerName)
        : null;
      if (!targetLayer) continue;
      if (targetLayer === myLayer) continue; // same subdir — always ok

      const typeOnly = isTypeOnlyImport(line);

      // ── Rule 2: kernel/ ───────────────────────────────────────────────────
      if (myLayer === 'kernel') {
        // Only WrongStackError from types/ is allowed as a runtime import.
        // All other cross-samedir imports must be type-only.
        if (!typeOnly && targetLayer !== 'types') {
          violations.push(
            `kernel imports runtime value from '${targetDir}/' — only 'types/' (WrongStackError) is permitted`,
          );
        }
        if (!typeOnly && targetLayer === 'types' && !line.includes('WrongStackError')) {
          // Example: kernel importing something else from types/ as a value
          // WrongStackError is explicitly allowed; other value imports are violations
          violations.push(
            `kernel imports runtime value '${targetDir}/' — only WrongStackError from types/ is permitted`,
          );
        }
        continue;
      }

      // ── Rule 3: core/ ─────────────────────────────────────────────────────
      if (myLayer === 'core') {
        const forbidden = new Set<LayerName>(['execution', 'storage', 'coordination']);
        if (forbidden.has(targetLayer) && !typeOnly) {
          violations.push(`core/ imports runtime value from '${targetDir}/' — forbidden by Rule 3`);
        }
        continue;
      }

      // ── Rule 4: observability/ ────────────────────────────────────────────
      if (myLayer === 'observability') {
        const forbidden = new Set<LayerName>(['core', 'execution', 'storage', 'coordination']);
        if (forbidden.has(targetLayer) && !typeOnly) {
          violations.push(`observability/ imports runtime value from '${targetDir}/' — forbidden by Rule 4`);
        }
        continue;
      }

      // ── Rule 5: security/ ─────────────────────────────────────────────────
      if (myLayer === 'security') {
        const forbidden = new Set<LayerName>(['execution', 'storage', 'coordination']);
        if (forbidden.has(targetLayer) && !typeOnly) {
          violations.push(`security/ imports runtime value from '${targetDir}/' — forbidden by Rule 5`);
        }
        continue;
      }

      // ── Rule 6: registry/ ─────────────────────────────────────────────────
      if (myLayer === 'registry') {
        const forbidden = new Set<LayerName>(['execution', 'storage', 'coordination']);
        if (forbidden.has(targetLayer) && !typeOnly) {
          violations.push(`registry/ imports runtime value from '${targetDir}/' — forbidden by Rule 6`);
        }
        continue;
      }

      // ── Rule 7: infrastructure/ ────────────────────────────────────────────
      // infrastructure/ is the system integration layer (logger, token counter,
      // path resolver, etc.). It must not reach into domain/execution/storage/
      // coordination layers at runtime level. Type-only imports from any layer
      // are always fine.
      if (myLayer === 'infrastructure') {
        const forbidden = new Set<LayerName>([
          'core',
          'models',
          'security',
          'registry',
          'execution',
          'storage',
          'coordination',
          'plugin',
          'extension',
          'observability',
          'sdd',
          'skills',
        ]);
        if (forbidden.has(targetLayer) && !typeOnly) {
          violations.push(
            `infrastructure/ imports runtime value from '${targetDir}/' — forbidden by Rule 7`,
          );
        }
        continue;
      }

      // ── Rule 8: models/ ───────────────────────────────────────────────────
      // models/ (ModelSelector, ModelsRegistry, ModeStore) must not import
      // runtime values from execution/, storage/, or coordination/.
      if (myLayer === 'models') {
        const forbidden = new Set<LayerName>(['execution', 'storage', 'coordination']);
        if (forbidden.has(targetLayer) && !typeOnly) {
          violations.push(`models/ imports runtime value from '${targetDir}/' — forbidden by Rule 8`);
        }
        continue;
      }

      // ── Rule 9: extension/ ─────────────────────────────────────────────────
      // extension/ (ExtensionRegistry) must not import runtime values from
      // execution/, storage/, or coordination/.
      if (myLayer === 'extension') {
        const forbidden = new Set<LayerName>(['execution', 'storage', 'coordination']);
        if (forbidden.has(targetLayer) && !typeOnly) {
          violations.push(`extension/ imports runtime value from '${targetDir}/' — forbidden by Rule 9`);
        }
        continue;
      }

      // ── Bidirectional coupling check ─────────────────────────────────────
      // A bidirectional runtime coupling means two layers depend on each
      // other's implementation — a design smell even if each individual
      // import is layer-correct. Flag A→B when B→A already exists.
      // We detect this by tracking which layer pairs have runtime imports
      // in the current file-set, then assert no pair is bidirectional.
      if (myIdx < targetIdx && !typeOnly) {
        // This is a forward (lower→higher) runtime import.
        // Check if the reverse edge is also present anywhere in the codebase.
        // (The full bidirectional check is done in the dedicated test below.)
        violations.push(
          `layer '${myLayer}' imports runtime value from '${targetDir}/' (higher layer) — general upward-import violation`,
        );
      }
    }

    return violations;
  }

  it('kernel/ only imports runtime values from types/ (WrongStackError)', async () => {
    const kernelFiles = (await walk(CORE_SRC)).filter((f) => layerOf(f) === 'kernel');
    const allViolations: string[] = [];

    for (const file of kernelFiles) {
      const violations = await collectViolations(file);
      for (const v of violations) {
        allViolations.push(`${path.relative(process.cwd(), file)}: ${v}`);
      }
    }

    expect(allViolations).toEqual([]);
  });

  it('core/ does not import runtime values from execution/, storage/, or coordination/', async () => {
    const coreFiles = (await walk(CORE_SRC)).filter((f) => layerOf(f) === 'core');
    const allViolations: string[] = [];

    for (const file of coreFiles) {
      const violations = await collectViolations(file);
      for (const v of violations) {
        allViolations.push(`${path.relative(process.cwd(), file)}: ${v}`);
      }
    }

    expect(allViolations).toEqual([]);
  });

  it('observability/ does not import runtime values from core/, execution/, storage/, or coordination/', async () => {
    const obsFiles = (await walk(CORE_SRC)).filter((f) => layerOf(f) === 'observability');
    const allViolations: string[] = [];

    for (const file of obsFiles) {
      const violations = await collectViolations(file);
      for (const v of violations) {
        allViolations.push(`${path.relative(process.cwd(), file)}: ${v}`);
      }
    }

    expect(allViolations).toEqual([]);
  });

  it('security/ does not import runtime values from execution/, storage/, or coordination/', async () => {
    const secFiles = (await walk(CORE_SRC)).filter((f) => layerOf(f) === 'security');
    const allViolations: string[] = [];

    for (const file of secFiles) {
      const violations = await collectViolations(file);
      for (const v of violations) {
        allViolations.push(`${path.relative(process.cwd(), file)}: ${v}`);
      }
    }

    expect(allViolations).toEqual([]);
  });

  it('registry/ does not import runtime values from execution/, storage/, or coordination/', async () => {
    const regFiles = (await walk(CORE_SRC)).filter((f) => layerOf(f) === 'registry');
    const allViolations: string[] = [];

    for (const file of regFiles) {
      const violations = await collectViolations(file);
      for (const v of violations) {
        allViolations.push(`${path.relative(process.cwd(), file)}: ${v}`);
      }
    }

    expect(allViolations).toEqual([]);
  });

  it('infrastructure/ does not import runtime values from domain/execution/storage/coordination layers', async () => {
    const infraFiles = (await walk(CORE_SRC)).filter((f) => layerOf(f) === 'infrastructure');
    const allViolations: string[] = [];

    for (const file of infraFiles) {
      const violations = await collectViolations(file);
      for (const v of violations) {
        allViolations.push(`${path.relative(process.cwd(), file)}: ${v}`);
      }
    }

    expect(allViolations).toEqual([]);
  });

  it('models/ does not import runtime values from execution/, storage/, or coordination/', async () => {
    const modelFiles = (await walk(CORE_SRC)).filter((f) => layerOf(f) === 'models');
    const allViolations: string[] = [];

    for (const file of modelFiles) {
      const violations = await collectViolations(file);
      for (const v of violations) {
        allViolations.push(`${path.relative(process.cwd(), file)}: ${v}`);
      }
    }

    expect(allViolations).toEqual([]);
  });

  it('extension/ does not import runtime values from execution/, storage/, or coordination/', async () => {
    const extFiles = (await walk(CORE_SRC)).filter((f) => layerOf(f) === 'extension');
    const allViolations: string[] = [];

    for (const file of extFiles) {
      const violations = await collectViolations(file);
      for (const v of violations) {
        allViolations.push(`${path.relative(process.cwd(), file)}: ${v}`);
      }
    }

    expect(allViolations).toEqual([]);
  });
});

// ── Bidirectional coupling detection ─────────────────────────────────────────

type DirectedEdge = `${LayerName}→${LayerName}`;

/**
 * Scans all files in CORE_SRC and builds a map of all directed runtime
 * import edges between layers. An edge A→B means at least one file in
 * layer A has a runtime (non-type-only) import from layer B.
 */
async function buildRuntimeEdgeSet(): Promise<Set<DirectedEdge>> {
  const edges = new Set<DirectedEdge>();
  const files = await walk(CORE_SRC);

  for (const file of files) {
    const myLayer = layerOf(file);
    if (!myLayer) continue;

    const text = await fs.readFile(file, 'utf8');
    const importLines: Array<{ line: string; spec: string }> = [];

    for (const importLine of text.split('\n')) {
      IMPORT_RE.lastIndex = 0;
      for (const match of importLine.matchAll(IMPORT_RE)) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (!spec) continue;
        const rel = relativeImport(spec);
        if (!rel) continue;
        importLines.push({ line: importLine.trim(), spec: rel });
      }
    }

    for (const { line, spec } of importLines) {
      const targetDir = importTargetDir(spec);
      if (!targetDir) continue;
      const targetLayer = (LAYERS as readonly string[]).includes(targetDir)
        ? (targetDir as LayerName)
        : null;
      if (!targetLayer) continue;
      if (targetLayer === myLayer) continue;
      if (isTypeOnlyImport(line)) continue; // type-only = no runtime edge

      const edge = `${myLayer}→${targetLayer}` as DirectedEdge;
      edges.add(edge);
    }
  }

  return edges;
}

describe('core bidirectional coupling', () => {
  /**
   * layers excluded from the bidirectional check:
   *
   * types/    — public-type barrel for the whole package. Its index.ts
   *              re-exports from nearly every other layer (e.g. types/index.ts
   *              → execution/tool-executor.js). Treating those re-exports as
   *              "types → X" edges produces false positives: every layer that
   *              imports from types/ would appear to have a reverse edge back
   *              through the barrel. types/ is the shared contract surface,
   *              not a domain layer.
   *
   * defaults/  — convenience re-export barrel for default implementations.
   *              Same situation as types/: its index.ts pulls in concrete classes
   *              from execution/, storage/, etc. Those forward edges would all
   *              appear bidirectional when checked against the barrel.
   */
  const EXCLUDED = new Set<LayerName>(['types', 'defaults']);

  it('no two layers should have mutual runtime dependencies', async () => {
    const edges = await buildRuntimeEdgeSet();
    const violations: string[] = [];

    for (const edge of edges) {
      const [from, to] = edge.split('→') as [LayerName, LayerName];
      if (EXCLUDED.has(from) || EXCLUDED.has(to)) continue;
      const reverse = `${to}→${from}` as DirectedEdge;
      if (edges.has(reverse)) {
        violations.push(`${from} ↔ ${to}: bidirectional runtime coupling detected`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no layer cycle should exist in the runtime dependency graph', async () => {
    const edges = await buildRuntimeEdgeSet();

    // Build adjacency list: node → Set of outgoing neighbours
    const adj = new Map<LayerName, Set<LayerName>>();
    for (const edge of edges) {
      const [from, to] = edge.split('→') as [LayerName, LayerName];
      if (EXCLUDED.has(from) || EXCLUDED.has(to)) continue;
      if (!adj.has(from)) adj.set(from, new Set());
      adj.get(from)!.add(to);
    }

    // DFS with three colours: white=unvisited, gray=in-current-path, black=done.
    // Any gray→gray edge during DFS signals a cycle.
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const colour = new Map<LayerName, number>();
    for (const node of adj.keys()) colour.set(node, WHITE);

    const cycles: string[] = [];
    function dfs(node: LayerName, path: LayerName[]): void {
      if (colour.get(node) === GRAY) {
        const cycleStart = path.indexOf(node);
        const cycle = [...path.slice(cycleStart), node];
        cycles.push(cycle.join(' → '));
        return;
      }
      if (colour.get(node) === BLACK) return;
      colour.set(node, GRAY);
      for (const neighbour of adj.get(node) ?? []) {
        dfs(neighbour, [...path, node]);
      }
      colour.set(node, BLACK);
    }

    for (const node of adj.keys()) {
      if (colour.get(node) === WHITE) dfs(node, []);
    }

    expect(cycles).toEqual([]);
  });
});
