/**
 * TechStack — Maven ecosystem adapter (Tier B).
 *
 * Parses pom.xml for direct dependencies. Partial support — no lockfile
 * parsing (Maven has no standardized lockfile); version resolution
 * requires `mvn dependency:tree` which is not invoked here.
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

interface MavenDependency {
  readonly groupId: string;
  readonly artifactId: string;
  readonly version?: string | undefined;
  readonly scope?: string | undefined;
}

function manifestEvidence(path: string): Evidence {
  return { kind: 'manifest', source: path, retrievedAt: new Date().toISOString() };
}

/**
 * Minimal XML parser for `<dependency>` blocks inside pom.xml.
 * Does not handle inheritance/dependencyManagement — this is Tier B partial.
 */
function parsePomDependencies(xml: string): MavenDependency[] {
  const deps: MavenDependency[] = [];
  const depRegex = /<dependency>\s*([\s\S]*?)<\/dependency>/g;
  let match: RegExpExecArray | null;
  while ((match = depRegex.exec(xml)) !== null) {
    const block = match[1]!;
    const groupId = block.match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim();
    const artifactId = block.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim();
    const version = block.match(/<version>([^<]+)<\/version>/)?.[1]?.trim();
    const scope = block.match(/<scope>([^<]+)<\/scope>/)?.[1]?.trim();
    if (groupId && artifactId) {
      deps.push({ groupId, artifactId, version, scope });
    }
  }
  return deps;
}

function mavenScopeToScope(scope: string | undefined): DependencyScope {
  switch (scope) {
    case 'test': return 'development';
    case 'provided': return 'optional';
    case 'runtime': return 'runtime';
    case 'compile': return 'runtime';
    default: return 'runtime';
  }
}

export class MavenAdapter implements EcosystemAdapter {
  readonly ecosystem: EcosystemId = 'maven';

  async inventory(
    workspace: Workspace,
    _options: InventoryOptions,
  ): Promise<readonly DependencyObservation[]> {
    const observations: DependencyObservation[] = [];
    const pomPath = workspace.manifests.find((m) => m.includes('pom.xml'));
    if (!pomPath) return [];

    let content: string;
    try {
      content = readFileSync(pomPath, 'utf-8');
    } catch {
      return [];
    }

    const manifestEv = manifestEvidence(pomPath);
    const deps = parsePomDependencies(content);
    const seen = new Set<string>();

    for (const dep of deps) {
      const name = `${dep.groupId}:${dep.artifactId}`;
      if (seen.has(name)) continue;
      seen.add(name);

      const purl = dep.version
        ? buildPurl({ type: 'maven', name, version: dep.version })
        : buildPurl({ type: 'maven', name });

      observations.push({
        id: `dep-${workspace.id}-${name}`,
        workspaceId: workspace.id,
        purl,
        ecosystem: 'maven',
        name,
        sourceType: 'registry',
        direct: true,
        scope: mavenScopeToScope(dep.scope),
        ...(dep.version ? { requested: dep.version } : {}),
        status: 'current',
        evidence: [manifestEv],
      });
    }

    return observations;
  }
}

export const mavenAdapter = new MavenAdapter();
