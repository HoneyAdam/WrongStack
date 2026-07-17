/**
 * TechStack — Rust ecosystem adapter.
 *
 * Parses Cargo.toml manifests and Cargo.lock lockfiles to produce
 * DependencyObservation[] for Rust workspaces.
 *
 * @see docs/specs/techstack-sdd.md §6 Tier A
 */

import { readFileSync } from 'node:fs';
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
import { resolveIn, workspaceRoot } from './paths.js';
import { buildPurl } from '../registry/purl.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function manifestEvidence(path: string): Evidence {
  return { kind: 'manifest', source: path, retrievedAt: new Date().toISOString() };
}

function lockfileEvidence(path: string): Evidence {
  return { kind: 'lockfile', source: path, retrievedAt: new Date().toISOString() };
}

// ── Minimal TOML parser (line-based, sufficient for Cargo.toml + Cargo.lock) ──

interface TomlSection {
  readonly name: string;
  readonly lines: string[];
}

function parseTomlSections(content: string): TomlSection[] {
  const sections: TomlSection[] = [];
  let currentSection = '__header__';
  let currentLines: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#') || line === '') continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      if (currentLines.length > 0) sections.push({ name: currentSection, lines: currentLines });
      currentSection = sectionMatch[1]!;
      currentLines = [];
    } else {
      currentLines.push(raw);
    }
  }
  if (currentLines.length > 0) sections.push({ name: currentSection, lines: currentLines });
  return sections;
}

/**
 * Parse a key = value pair from a TOML line.
 * Handles: key = "string", key = { inline = "table" }
 * Returns undefined for lines that are continuations of inline tables.
 */
function parseTomlKeyValue(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  // Skip inline table continuation lines that start with a key
  if (trimmed.startsWith('#')) return undefined;
  const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
  if (!match) return undefined;
  return { key: match[1]!, value: match[2]!.trim() };
}

/**
 * Extract simple string key-value pairs from a TOML section.
 * Returns { name, version } for entries like `serde = "1.0"` or `serde = { version = "1.0", ... }`.
 * Handles both simple and inline-table formats.
 */
function extractTomlDeps(sectionLines: string[]): Array<{ name: string; version: string | undefined }> {
  const deps: Array<{ name: string; version: string | undefined }> = [];
  for (const raw of sectionLines) {
    const line = raw.trim();
    if (line.startsWith('#') || line === '') continue;

    // Check if it's an inline table: serde = { version = "1.0", features = [...] }
    const tableMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{\s*(.*?)\s*\}$/);
    if (tableMatch) {
      const name = tableMatch[1]!;
      const inner = tableMatch[2]!;
      const versionMatch = inner.match(/version\s*=\s*"([^"]+)"/);
      deps.push({ name, version: versionMatch ? versionMatch[1]! : undefined });
      continue;
    }

    // Simple key = "value"
    const simpleMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"$/);
    if (simpleMatch) {
      deps.push({ name: simpleMatch[1]!, version: simpleMatch[2]! || undefined });
      continue;
    }

    // Try partial inline table (may span lines)
    const partialMatch = parseTomlKeyValue(line);
    if (partialMatch && !partialMatch.value.startsWith('{') && !partialMatch.value.startsWith('"')) {
      // Might be a path or git dep: serde = { path = "../foo" }
      // Ignore these for now
    }
  }
  return deps;
}

/**
 * Parse Cargo.lock format for package entries.
 * Cargo.lock uses TOML format with [[package]] array entries.
 */
function parseCargoLock(content: string): Map<string, string> {
  const versions = new Map<string, string>();
  const lines = content.split('\n');
  let currentName: string | undefined;
  let currentVersion: string | undefined;
  let inPackage = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#') || line === '') continue;

    if (line.startsWith('[[') && line.includes('package')) {
      // Save previous
      if (inPackage && currentName && currentVersion) {
        versions.set(currentName, currentVersion);
      }
      currentName = undefined;
      currentVersion = undefined;
      inPackage = true;
      continue;
    }

    if (inPackage) {
      if (line.startsWith('name')) {
        const m = line.match(/^name\s*=\s*"([^"]+)"/);
        if (m) currentName = m[1]!;
      } else if (line.startsWith('version')) {
        const m = line.match(/^version\s*=\s*"([^"]+)"/);
        if (m) currentVersion = m[1]!;
      }
    }
  }

  // Save last
  if (inPackage && currentName && currentVersion) {
    versions.set(currentName, currentVersion);
  }

  return versions;
}

// ── Scope mapping ─────────────────────────────────────────────────────────

function scopeForCargoSection(section: string): DependencyScope {
  switch (section) {
    case 'dependencies':
      return 'runtime';
    case 'dev-dependencies':
      return 'development';
    case 'build-dependencies':
      return 'build';
    default:
      return 'runtime';
  }
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class RustAdapter implements EcosystemAdapter {
  readonly ecosystem: EcosystemId = 'rust';

  async inventory(
    workspace: Workspace,
    options: InventoryOptions,
  ): Promise<readonly DependencyObservation[]> {
    const observations: DependencyObservation[] = [];
    const root = workspaceRoot(workspace, options);
    const seen = new Set<string>();

    // Find manifests
    const cargoTomlPath = workspace.manifests.find((m) => m.includes('Cargo.toml'))
      || (this.fileExists(resolveIn(root, 'Cargo.toml')) ? 'Cargo.toml' : undefined);

    if (!cargoTomlPath) return [];

    const fullManifestPath = resolveIn(root, cargoTomlPath);
    let cargoContent: string;
    try {
      cargoContent = readFileSync(fullManifestPath, 'utf-8');
    } catch {
      return [];
    }

    const manifestEv = manifestEvidence(fullManifestPath);

    // Find lockfile
    const cargoLockPath = resolveIn(root, 'Cargo.lock');
    let lockVersions = new Map<string, string>();
    let lockEv: Evidence | undefined;
    try {
      const lockContent = readFileSync(cargoLockPath, 'utf-8');
      lockVersions = parseCargoLock(lockContent);
      lockEv = lockfileEvidence(cargoLockPath);
    } catch {
      // No lockfile — that's OK
    }

    // Parse dependency sections from Cargo.toml
    const sections = parseTomlSections(cargoContent);
    const depSections = ['dependencies', 'dev-dependencies', 'build-dependencies'];

    for (const section of sections) {
      // Cargo.toml has [dependencies], [dev-dependencies], [build-dependencies]
      // Also [target.'cfg(...)'.dependencies] patterns
      const sectionName = section.name;
      let matchedScope: string | undefined;

      for (const depSec of depSections) {
        if (sectionName === depSec || sectionName.endsWith(`.${depSec}`)) {
          matchedScope = depSec;
          break;
        }
      }

      if (!matchedScope) continue;

      const scope = scopeForCargoSection(matchedScope);
      const deps = extractTomlDeps(section.lines);

      for (const dep of deps) {
        if (seen.has(dep.name)) continue;
        seen.add(dep.name);

        const locked = lockVersions.get(dep.name) || dep.version;
        const isRegistry = !dep.version || (
          !dep.version.startsWith('path=') &&
          !dep.version.startsWith('git=') &&
          !dep.version.startsWith('../')
        );

        const purl = isRegistry && locked
          ? buildPurl({ type: 'rust', name: dep.name, version: locked })
          : isRegistry
            ? buildPurl({ type: 'rust', name: dep.name })
            : undefined;

        const evidence: Evidence[] = [manifestEv];
        if (lockEv && locked && lockVersions.has(dep.name)) evidence.push(lockEv);

        const status: DependencyObservation['status'] =
          dep.version && (dep.version.startsWith('path=') || dep.version.startsWith('git='))
            ? dep.version.startsWith('git=')
              ? 'git_dependency'
              : 'local_path'
            : 'current';

        observations.push({
          id: `dep-${workspace.id}-${dep.name}`,
          workspaceId: workspace.id,
          ...(purl ? { purl } : {}),
          ecosystem: 'rust',
          name: dep.name,
          sourceType: isRegistry ? 'registry' : status === 'local_path' ? 'path' : 'git',
          direct: true,
          scope,
          ...(dep.version ? { requested: dep.version } : {}),
          ...(locked ? { locked } : {}),
          status,
          evidence,
        });
      }
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
export const rustAdapter = new RustAdapter();
