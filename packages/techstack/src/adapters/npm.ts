/**
 * TechStack — npm ecosystem adapter.
 *
 * Parses package.json manifests and pnpm-lock.yaml (or package-lock.json /
 * yarn.lock) to produce DependencyObservation[] for Node.js workspaces.
 *
 * Supports: pnpm, npm, yarn, bun — determined by lockfile presence.
 *
 * @see docs/specs/techstack-sdd.md §6 Tier A
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DependencyObservation,
  DependencyScope,
  DependencyStatus,
  Evidence,
  EcosystemId,
  Workspace,
} from '../types.js';
import type {
  EcosystemAdapter,
  InventoryOptions,
} from './interface.js';
import { buildPurl } from '../registry/purl.js';

// ── Lockfile types ───────────────────────────────────────────────────────

type LockfileKind = 'pnpm' | 'npm' | 'yarn' | 'bun' | 'none';

interface LockfileInfo {
  readonly kind: LockfileKind;
  readonly path: string;
}

// ── package.json shape ───────────────────────────────────────────────────

interface PackageJsonDeps {
  readonly [packageName: string]: string;
}

interface PackageJson {
  readonly name?: string | undefined;
  readonly dependencies?: PackageJsonDeps | undefined;
  readonly devDependencies?: PackageJsonDeps | undefined;
  readonly peerDependencies?: PackageJsonDeps | undefined;
  readonly optionalDependencies?: PackageJsonDeps | undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function detectLockfile(workspaceRoot: string): LockfileInfo {
  const candidates: Array<{ file: string; kind: LockfileKind }> = [
    { file: 'pnpm-lock.yaml', kind: 'pnpm' },
    { file: 'package-lock.json', kind: 'npm' },
    { file: 'yarn.lock', kind: 'yarn' },
    { file: 'bun.lockb', kind: 'bun' },
  ];
  for (const c of candidates) {
    try {
      readFileSync(join(workspaceRoot, c.file), 'utf-8');
      return { kind: c.kind, path: join(workspaceRoot, c.file) };
    } catch {
      // not found
    }
  }
  return { kind: 'none', path: '' };
}

/**
 * Parse pnpm-lock.yaml to extract resolved versions.
 * Uses a minimal line-based parser — no YAML dependency.
 */
function parsePnpmLockVersions(lockContent: string): Map<string, string> {
  const versions = new Map<string, string>();

  // pnpm-lock v9 format: packages section with entries like:
  //   /react@19.1.0:
  //     resolution: ...
  //     engines: ...
  //     dependencies: ...
  // The key line starts with optional indentation, then `/name@version:`.
  // We must allow leading whitespace because the packages are indented under the `packages:` key.
  const packageBlockRegex = /^\s+\/(.+?)@([^@\n]+):$/gm;
  let match: RegExpExecArray | null;
  while ((match = packageBlockRegex.exec(lockContent)) !== null) {
    const name = match[1]!;
    const version = match[2]!;
    versions.set(name, version);
  }

  return versions;
}

/**
 * Parse package-lock.json (npm) to extract resolved versions.
 */
function parseNpmLockVersions(lockContent: string): Map<string, string> {
  const versions = new Map<string, string>();
  try {
    const lock = JSON.parse(lockContent);
    // npm v3: lock.dependencies
    const deps = lock.dependencies ?? {};
    for (const [name, info] of Object.entries(deps)) {
      const depInfo = info as { version?: string };
      if (depInfo.version) {
        // Strip version prefixes like ^, ~, >=
        const cleanVersion = depInfo.version.replace(/^[^0-9]+/, '');
        versions.set(name, cleanVersion);
      }
    }
    // npm v2 (lockfileVersion 2+): lock.packages
    const packages = lock.packages ?? {};
    for (const key of Object.keys(packages)) {
      const pkgInfo = packages[key] as { version?: string };
      if (pkgInfo.version) {
        // Key format: "node_modules/package-name" or "node_modules/@scope/package-name"
        const name = key.replace(/^node_modules\//, '');
        if (!versions.has(name)) {
          versions.set(name, pkgInfo.version);
        }
      }
    }
  } catch {
    // Malformed lockfile — return empty map
  }
  return versions;
}

/**
 * Create a manifest evidence entry.
 */
function manifestEvidence(path: string): Evidence {
  return {
    kind: 'manifest',
    source: path,
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * Create a lockfile evidence entry.
 */
function lockfileEvidence(path: string): Evidence {
  return {
    kind: 'lockfile',
    source: path,
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * Determine the dependency scope from the manifest section it appears in.
 */
function scopeForSection(section: string): DependencyScope {
  switch (section) {
    case 'dependencies':
      return 'runtime';
    case 'devDependencies':
      return 'development';
    case 'peerDependencies':
      return 'peer';
    case 'optionalDependencies':
      return 'optional';
    default:
      return 'runtime';
  }
}

/**
 * Determine status: local_path for file: / link: / workspace:,
 * git_dependency for git+ / github: / git:, registry otherwise.
 */
function statusForSpec(spec: string): DependencyStatus {
  if (spec.startsWith('file:') || spec.startsWith('link:') || spec.startsWith('workspace:')) {
    return 'local_path';
  }
  if (spec.startsWith('git+') || spec.startsWith('github:') || spec.startsWith('git:')) {
    return 'git_dependency';
  }
  return 'current';
}

/**
 * Check if a spec is a local/git reference (not resolvable to a registry version).
 */
function isRegistrySpec(spec: string): boolean {
  return (
    !spec.startsWith('file:') &&
    !spec.startsWith('link:') &&
    !spec.startsWith('workspace:') &&
    !spec.startsWith('git+') &&
    !spec.startsWith('github:') &&
    !spec.startsWith('git:')
  );
}

// ── Adapter ──────────────────────────────────────────────────────────────

export class NpmAdapter implements EcosystemAdapter {
  readonly ecosystem: EcosystemId = 'npm';

  async inventory(
    workspace: Workspace,
    _options: InventoryOptions,
  ): Promise<readonly DependencyObservation[]> {
    const observations: DependencyObservation[] = [];
    const root = workspace.relativeRoot || '.';
    const manifestPath = join(root, workspace.manifests[0] ?? 'package.json');

    // Read package.json
    let pkg: PackageJson;
    let manifestContent: string;
    try {
      manifestContent = readFileSync(manifestPath, 'utf-8');
      pkg = JSON.parse(manifestContent) as PackageJson;
    } catch {
      return []; // Can't read manifest — no dependencies
    }

    const manifestEv = manifestEvidence(manifestPath);

    // Read lockfile for resolved versions
    const lockInfo = detectLockfile(root);
    const resolvedVersions = new Map<string, string>();
    let lockEv: Evidence | undefined;
    if (lockInfo.kind === 'pnpm') {
      try {
        const lockContent = readFileSync(lockInfo.path, 'utf-8');
        const parsed = parsePnpmLockVersions(lockContent);
        for (const [k, v] of parsed) resolvedVersions.set(k, v);
        lockEv = lockfileEvidence(lockInfo.path);
      } catch {
        // ignore
      }
    } else if (lockInfo.kind === 'npm') {
      try {
        const lockContent = readFileSync(lockInfo.path, 'utf-8');
        const parsed = parseNpmLockVersions(lockContent);
        for (const [k, v] of parsed) resolvedVersions.set(k, v);
        lockEv = lockfileEvidence(lockInfo.path);
      } catch {
        // ignore
      }
    }

    // Process each dependency section
    const sections: Array<{ name: string; deps: PackageJsonDeps | undefined }> = [
      { name: 'dependencies', deps: pkg.dependencies },
      { name: 'devDependencies', deps: pkg.devDependencies },
      { name: 'peerDependencies', deps: pkg.peerDependencies },
      { name: 'optionalDependencies', deps: pkg.optionalDependencies },
    ];

    const seen = new Set<string>(); // dedup within workspace

    for (const section of sections) {
      if (!section.deps) continue;
      const scope = scopeForSection(section.name);

      for (const [name, requested] of Object.entries(section.deps)) {
        const dedupKey = `${name}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const isRegistry = isRegistrySpec(requested);
        const status = statusForSpec(requested);

        // Resolve locked version from lockfile
        const locked = resolvedVersions.get(name);

        // Build PURL for registry deps
        const purl = isRegistry && locked
          ? buildPurl({ type: 'npm', name, version: locked })
          : isRegistry
            ? buildPurl({ type: 'npm', name })
            : undefined;

        const evidence: Evidence[] = [manifestEv];
        if (lockEv && locked) evidence.push(lockEv);

        observations.push({
          id: `dep-${workspace.id}-${name}`,
          workspaceId: workspace.id,
          ...(purl ? { purl } : {}),
          ecosystem: 'npm' as const,
          name,
          sourceType: isRegistry ? 'registry' : status === 'local_path' ? 'path' : 'git',
          direct: true,
          scope,
          requested,
          ...(locked ? { locked } : {}),
          status,
          evidence,
        });
      }
    }

    // Parse transitive dependencies from lockfile if requested
    // (Phase 1 enhancement: includeTransitive option)

    return observations;
  }
}

/**
 * Default singleton instance.
 */
export const npmAdapter = new NpmAdapter();
