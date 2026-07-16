/**
 * TechStack — Go ecosystem adapter.
 *
 * Parses go.mod manifests and go.sum to produce DependencyObservation[]
 * for Go workspaces.
 *
 * @see docs/specs/techstack-sdd.md §6 Tier A
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DependencyObservation,
  DependencyScope,
  Evidence,
  EcosystemId,
  Workspace,
} from '../types.js';
import type {
  EcosystemAdapter,
  InventoryOptions,
} from './interface.js';
import { buildPurl } from '../registry/purl.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function manifestEvidence(path: string): Evidence {
  return { kind: 'manifest', source: path, retrievedAt: new Date().toISOString() };
}

function lockfileEvidence(path: string): Evidence {
  return { kind: 'lockfile', source: path, retrievedAt: new Date().toISOString() };
}

function cleanGoVersion(v: string): string {
  return v.replace(/^v/i, '');
}

// ── go.mod parser

interface GoRequireStmt {
  readonly modulePath: string;
  readonly version: string;
  /** Indirect dependencies (// indirect comment) */
  readonly indirect?: boolean;
}

/**
 * Parse a go.mod file to extract require statements.
 * Handles:
 *   require module/path v1.2.3
 *   require (
 *       module/path v1.2.3
 *       module/other v0.5.0 // indirect
 *   )
 *   exclude, replace, retract are ignored.
 */
function parseGoMod(content: string): GoRequireStmt[] {
  const deps: GoRequireStmt[] = [];
  const lines = content.split('\n');
  let inRequireBlock = false;

  for (const raw of lines) {
    const line = raw.trim();

    // Skip comments and empty lines
    if (line === '' || line.startsWith('//')) continue;

    // Track require blocks
    if (line.startsWith('require (') && line.endsWith('(')) {
      inRequireBlock = true;
      continue;
    }
    if (line.startsWith('require ') && !line.includes('(')) {
      // Single-line require
      const m = line.match(/^require\s+(\S+)\s+(\S+)/);
      if (m) {
        const indirect = raw.includes('// indirect');
        deps.push({ modulePath: m[1]!, version: cleanGoVersion(m[2]!), indirect });
      }
      continue;
    }

    if (inRequireBlock) {
      if (line === ')') {
        inRequireBlock = false;
        continue;
      }
      // Module path v1.2.3 // indirect
      const m = line.match(/^(\S+)\s+(\S+)/);
      if (m) {
        const indirect = raw.includes('// indirect');
        deps.push({ modulePath: m[1]!, version: cleanGoVersion(m[2]!), indirect });
      }
      continue;
    }

    // Skip exclude/replace/retract blocks
    if (line.startsWith('exclude') || line.startsWith('replace') || line.startsWith('retract')) {
      continue;
    }
  }

  return deps;
}

/**
 * Parse go.sum to extract resolved versions.
 * Format: module_path version h1:hash
 * module_path version/go.mod h1:hash
 */
function parseGoSum(content: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // module_path version hash
    const m = line.match(/^(\S+)\s+(\S+)\s+\S+/);
    if (m) {
      const modulePath = m[1]!;
      const version = cleanGoVersion(m[2]!);
      // Only set if not already set (first occurrence wins)
      if (!versions.has(modulePath)) {
        // Skip pseudo-versions like v0.0.0-20240701012345-abcdef
        versions.set(modulePath, version);
      }
    }
  }
  return versions;
}

/**
 * Extract the module name from go.mod (go module statement).
 */
function parseGoModuleName(content: string): string | undefined {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^module\s+(\S+)/);
    if (m) return m[1]!;
  }
  return undefined;
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class GoAdapter implements EcosystemAdapter {
  readonly ecosystem: EcosystemId = 'go';

  async inventory(
    workspace: Workspace,
    _options: InventoryOptions,
  ): Promise<readonly DependencyObservation[]> {
    const observations: DependencyObservation[] = [];
    const root = workspace.relativeRoot || '.';
    const seen = new Set<string>();

    // Find go.mod
    const goModPath = workspace.manifests.find((m) => m.includes('go.mod'))
      || (this.fileExists(join(root, 'go.mod')) ? 'go.mod' : undefined);
    if (!goModPath) return [];

    const fullManifestPath = join(root, goModPath);
    let goModContent: string;
    try {
      goModContent = readFileSync(fullManifestPath, 'utf-8');
    } catch {
      return [];
    }

    const manifestEv = manifestEvidence(fullManifestPath);

    // Parse go.mod
    const requires = parseGoMod(goModContent);
    const modName = parseGoModuleName(goModContent);

    // Parse go.sum for locked versions
    const goSumPath = join(root, 'go.sum');
    let lockVersions = new Map<string, string>();
    let lockEv: Evidence | undefined;
    try {
      const sumContent = readFileSync(goSumPath, 'utf-8');
      lockVersions = parseGoSum(sumContent);
      lockEv = lockfileEvidence(goSumPath);
    } catch {
      // No go.sum
    }

    for (const req of requires) {
      if (seen.has(req.modulePath)) continue;
      seen.add(req.modulePath);

      // Skip the module itself if it appears (rare but possible)
      if (req.modulePath === modName) continue;

      // Determine scope
      // Go has no dev/prod distinction in go.mod — everything is runtime
      // unless marked indirect (which Go treats as transitive)
      const scope: DependencyScope = req.indirect ? 'transitive' : 'runtime';
      const direct = !req.indirect;

      // Resolve locked version
      const locked = lockVersions.get(req.modulePath) || req.version;

      // Go module paths work like: github.com/gorilla/mux
      // Build PURL with full module path as name
      const purl = buildPurl({ type: 'go', name: req.modulePath, version: locked });

      const evidence: Evidence[] = [manifestEv];
      if (lockEv && lockVersions.has(req.modulePath)) evidence.push(lockEv);

      observations.push({
        id: `dep-${workspace.id}-${req.modulePath}`,
        workspaceId: workspace.id,
        purl,
        ecosystem: 'go',
        name: req.modulePath,
        sourceType: 'registry',
        direct,
        scope,
        requested: req.version,
        ...(locked ? { locked } : {}),
        status: 'current',
        evidence,
      });
    }

    return observations;
  }

  private fileExists(filePath: string): boolean {
    try {
      readFileSync(filePath, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Default singleton instance.
 */
export const goAdapter = new GoAdapter();
