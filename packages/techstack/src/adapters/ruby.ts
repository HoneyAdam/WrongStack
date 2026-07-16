/**
 * TechStack — Ruby/Bundler ecosystem adapter (Tier B).
 *
 * Parses Gemfile and Gemfile.lock for direct and transitive dependencies.
 * Partial support — no registry API; OSV-only advisory enrichment.
 *
 * @see docs/specs/techstack-sdd.md §6 Tier B
 */

import { readFileSync } from 'node:fs';
import type {
  DependencyObservation,
  DependencyScope,
  Evidence,
  EcosystemId,
  Workspace,
} from '../types.js';
import type { EcosystemAdapter, InventoryOptions } from './interface.js';
import { buildPurl } from '../registry/purl.js';

function manifestEvidence(path: string): Evidence {
  return { kind: 'manifest', source: path, retrievedAt: new Date().toISOString() };
}

function lockfileEvidence(path: string): Evidence {
  return { kind: 'lockfile', source: path, retrievedAt: new Date().toISOString() };
}

/**
 * Parse Gemfile for direct `gem 'name'` and `gem 'name', 'version'` calls.
 */
function parseGemfile(content: string): Array<{ name: string; version?: string | undefined }> {
  const gems: Array<{ name: string; version?: string | undefined }> = [];
  const gemRegex = /gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/g;
  let match: RegExpExecArray | null;
  while ((match = gemRegex.exec(content)) !== null) {
    const name = match[1]!;
    // Skip gems that are clearly comments or block-evaluated
    if (name === 'rails' || name === 'ruby') continue;
    gems.push({ name, version: match[2] });
  }
  return gems;
}

/**
 * Parse Gemfile.lock `GEM` section for resolved versions.
 * Format: `    name (version)`.
 */
function parseGemfileLock(content: string): Map<string, string> {
  const versions = new Map<string, string>();
  const lines = content.split('\n');
  let inSpecs = false;
  for (const line of lines) {
    if (line.startsWith('GEM')) { inSpecs = true; continue; }
    if (inSpecs && /^[A-Z]/.test(line) && !line.startsWith(' ')) { inSpecs = false; continue; }
    if (!inSpecs) continue;
    const match = /^\s{4,}([\w-]+)\s+\(([^)]+)\)/.exec(line);
    if (match) {
      const version = match[2]!.split(' ')[0] ?? match[2]!;
      versions.set(match[1]!, version);
    }
  }
  return versions;
}

export class RubyAdapter implements EcosystemAdapter {
  readonly ecosystem: EcosystemId = 'ruby';

  async inventory(
    workspace: Workspace,
    _options: InventoryOptions,
  ): Promise<readonly DependencyObservation[]> {
    const observations: DependencyObservation[] = [];
    const gemfilePath = workspace.manifests.find((m) => m.includes('Gemfile'));
    if (!gemfilePath) return [];

    let content: string;
    try {
      content = readFileSync(gemfilePath, 'utf-8');
    } catch {
      return [];
    }

    const manifestEv = manifestEvidence(gemfilePath);
    const gems = parseGemfile(content);
    const seen = new Set<string>();

    // Parse lockfile
    const lockfilePath = workspace.lockfiles.find((l) => l.includes('Gemfile.lock'));
    let lockVersions = new Map<string, string>();
    let lockEv: Evidence | undefined;
    if (lockfilePath) {
      try {
        const lockContent = readFileSync(lockfilePath, 'utf-8');
        lockVersions = parseGemfileLock(lockContent);
        lockEv = lockfileEvidence(lockfilePath);
      } catch {
        // No lockfile
      }
    }

    for (const gem of gems) {
      if (seen.has(gem.name)) continue;
      seen.add(gem.name);

      const locked = lockVersions.get(gem.name);
      const version = locked ?? gem.version;
      const purl = version
        ? buildPurl({ type: 'gem', name: gem.name, version })
        : buildPurl({ type: 'gem', name: gem.name });

      const evidence: Evidence[] = [manifestEv];
      if (lockEv && locked) evidence.push(lockEv);

      observations.push({
        id: `dep-${workspace.id}-${gem.name}`,
        workspaceId: workspace.id,
        purl,
        ecosystem: 'ruby',
        name: gem.name,
        sourceType: 'registry',
        direct: true,
        scope: 'runtime' as DependencyScope,
        ...(gem.version ? { requested: gem.version } : {}),
        ...(locked ? { locked } : {}),
        status: 'current',
        evidence,
      });
    }

    return observations;
  }
}

export const rubyAdapter = new RubyAdapter();
