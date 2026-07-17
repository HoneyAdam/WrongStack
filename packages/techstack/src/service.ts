/**
 * TechStack — Public service API.
 *
 * Wires together inventory, online enrichment (registry + OSV + native audit),
 * status classification, and persistence into a single async job flow.
 *
 * @see docs/specs/techstack-sdd.md §4.2
 */

import { randomUUID } from 'node:crypto';
import type {
  Coverage,
  DependencyObservation,
  EcosystemId,
  Evidence,
  Finding,
  Snapshot,
  TechStackJob,
  TechStackJobProgress,
  TechStackJobStatus,
  Workspace,
} from './types.js';
import type { EcosystemAdapter } from './adapters/interface.js';
import { lookupRegistry } from './registry/client.js';
import type { RegistryEntry } from './registry/client.js';
import { queryOsvBatch } from './advisory/osv.js';
import { classifyStatus } from './policy/status.js';
import type { RegistryStatusData, AdvisoryStatusData } from './policy/status.js';
import type { TechStackStore } from './store/sqlite.js';
import { discoverWorkspaces } from './discovery/workspace.js';
import { triageCandidates } from './research/triage.js';
import type { TechStackResearcher } from './research/types.js';

// ── Types ─────────────────────────────────────────────────────────────────

export interface EnrichOptions {
  /** Skip network calls; use only cached/offline data. */
  readonly online?: boolean | undefined;
  /** Abort signal for cancellation. */
  readonly signal?: AbortSignal | undefined;
  /** Force re-fetch registry data (ignore cache). */
  readonly forceRegistryRefresh?: boolean | undefined;
}

export interface AnalyzeOptions {
  /** Where to start the analysis. */
  readonly targetRoot: string;
  /** Session ID for job tracking. */
  readonly sessionId?: string | undefined;
  /** Requesting entity. */
  readonly requestedBy?: string | undefined;
  /** Enable online enrichment (registry + advisory). */
  readonly online?: boolean | undefined;
  /** Auto-deliver report when complete. */
  readonly autoDeliver?: boolean | undefined;
  /** Optional caller-assigned id so HTTP/WS clients can track the job immediately. */
  readonly jobId?: string | undefined;
  /** Abort signal used by cancel endpoints. */
  readonly signal?: AbortSignal | undefined;
  /** Progress callback for WebSocket projection. */
  readonly onProgress?: ((phase: string, completed: number, total: number) => void) | undefined;
  /**
   * LLM interpretation stage. Omit it and `analyze()` stays a purely
   * deterministic tool — research is strictly additive enrichment.
   *
   * @see docs/specs/techstack-sdd.md §31
   */
  readonly researcher?: TechStackResearcher | undefined;
  /** Cap on packages sent to research. Defaults to `DEFAULT_TRIAGE_LIMIT`. */
  readonly researchLimit?: number | undefined;
}

// ── Adapter registry ───────────────────────────────────────────────────────

import { npmAdapter } from './adapters/npm.js';
import { pythonAdapter } from './adapters/python.js';
import { rustAdapter } from './adapters/rust.js';
import { goAdapter } from './adapters/go.js';
import { dotNetAdapter } from './adapters/dotnet.js';
import { phpAdapter } from './adapters/php.js';
import { dartAdapter } from './adapters/dart.js';
import { mavenAdapter } from './adapters/maven.js';
import { rubyAdapter } from './adapters/ruby.js';
import { elixirAdapter } from './adapters/elixir.js';
import { cppAdapter } from './adapters/cpp.js';

function getAdapter(ecosystem: EcosystemId): EcosystemAdapter | undefined {
  switch (ecosystem) {
    case 'npm': return npmAdapter;
    case 'python': return pythonAdapter;
    case 'rust': return rustAdapter;
    case 'go': return goAdapter;
    case 'dotnet': return dotNetAdapter;
    case 'php': return phpAdapter;
    case 'dart': return dartAdapter;
    // Tier B — partial support
    case 'maven': return mavenAdapter;
    case 'gradle': return mavenAdapter; // reuse Maven adapter (same manifest family)
    case 'ruby': return rubyAdapter;
    case 'swift': return undefined; // no adapter yet
    case 'elixir': return elixirAdapter;
    // Tier C — best-effort
    case 'cpp': return cppAdapter;
    default: return undefined;
  }
}

// ── Version constant ───────────────────────────────────────────────────────

const ADAPTER_VERSION = '0.1.0';

// ── TechStack Engine ───────────────────────────────────────────────────────

export class TechStackEngine {
  private store: TechStackStore;

  constructor(store: TechStackStore) {
    this.store = store;
  }

  // ── Inventory ─────────────────────────────────────────────────────────

  /**
   * Run an offline inventory: discover workspaces and parse dependencies
   * from manifests and lockfiles. No network calls.
   *
   * Returns a Snapshot with workspace and dependency data but no
   * registry/advisory enrichment.
   */
  async inventory(
    projectId: string,
    targetRoot: string,
    _jobId?: string,
    onProgress?: (phase: string, completed: number, total: number) => void,
  ): Promise<Snapshot> {
    const snapshotId = randomUUID();

    // Phase 1: Discover workspaces
    onProgress?.('discovering', 0, 1);
    const rawWorkspaces = await discoverWorkspaces(targetRoot);

    // Map into our Workspace type
    const workspaces: Workspace[] = rawWorkspaces.map((w) => ({
      id: w.id,
      relativeRoot: w.relativeRoot,
      ecosystem: w.ecosystem,
      packageManager: w.packageManager,
      manifests: [...w.manifests],
      lockfiles: [...w.lockfiles],
      confidence: w.confidence,
      coverage: w.coverage as Coverage,
    }));

    // Phase 2: Inventory per workspace
    onProgress?.('inventorying', 0, workspaces.length);
    const allDependencies: DependencyObservation[] = [];
    let totalCoverage: Coverage = 'full';

    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i]!;
      const adapter = getAdapter(ws.ecosystem);
      let deps: readonly DependencyObservation[] = [];

      if (adapter) {
        try {
          // `targetRoot` is the absolute base every adapter resolves
          // `ws.relativeRoot` against. Without it they fall back to
          // `process.cwd()` and silently inventory nothing.
          deps = await adapter.inventory(ws, { projectRoot: targetRoot });
        } catch {
          deps = [];
        }
      }

      // Track coverage
      if (ws.coverage === 'unsupported') {
        totalCoverage = 'partial';
      }

      allDependencies.push(...deps);
      onProgress?.('inventorying', i + 1, workspaces.length);
    }

    // Compute fingerprint
    const fingerprint = computeFingerprint(allDependencies);

    const snapshot: Snapshot = {
      id: snapshotId,
      projectId,
      targetRoot,
      fingerprint,
      createdAt: new Date().toISOString(),
      workspaces,
      dependencies: allDependencies,
      findings: [],
      coverage: totalCoverage,
      adapterVersion: ADAPTER_VERSION,
    };

    // Persist
    this.store.saveSnapshot(snapshot);

    return snapshot;
  }

  // ── Enrichment ─────────────────────────────────────────────────────────

  /**
   * Enrich a snapshot with registry metadata and advisory data.
   *
   * This is the online pass: fetches latest versions, licenses, deprecation
   * status from registries, and queries OSV for advisories.
   *
   * Key contracts:
   * - 404/401 → status `private_or_unresolved` (never `dead` or `deprecated`)
   * - Network failure → status `unknown` with evidence detail (never `current`)
   */
  async enrich(
    snapshot: Snapshot,
    options: EnrichOptions = {},
  ): Promise<Snapshot> {
    const isOnline = options.online !== false;
    if (!isOnline || options.signal?.aborted) {
      return snapshot;
    }

    // Group dependencies by ecosystem for batch lookups
    const byEcosystem = new Map<EcosystemId, DependencyObservation[]>();
    for (const dep of snapshot.dependencies) {
      // Skip local/git deps — they have no registry metadata
      if (dep.sourceType === 'path' || dep.sourceType === 'git') continue;
      if (!dep.purl) continue;

      const list = byEcosystem.get(dep.ecosystem);
      if (list) {
        list.push(dep);
      } else {
        byEcosystem.set(dep.ecosystem, [dep]);
      }
    }

    // Enrich each ecosystem
    const enrichedDeps = new Map<string, DependencyObservation>();
    const allFindings: Finding[] = [...snapshot.findings];

    for (const [ecosystem, deps] of byEcosystem) {
      // ── Registry lookup ──────────────────────────────────────────────
      const names = [...new Set(deps.map((d) => d.name))];

      for (const name of names) {
        const lookupOpts: { signal?: AbortSignal; force?: boolean } = {};
        if (options.signal) lookupOpts.signal = options.signal;
        if (options.forceRegistryRefresh) lookupOpts.force = true;

        let registryEntry: RegistryEntry | undefined;
        let registryStatus: RegistryStatusData | undefined;

        try {
          registryEntry = await lookupRegistry(ecosystem, name, lookupOpts);

          if (registryEntry) {
            // Successful lookup
            registryStatus = {
              latestStable: registryEntry.latestStable,
              deprecated: registryEntry.deprecated,
              yanked: registryEntry.yanked,
              evidence: [
                {
                  kind: 'registry',
                  source: registryEntry.source,
                  retrievedAt: registryEntry.retrievedAt,
                  detail: `latestStable: ${registryEntry.latestStable ?? 'N/A'}, license: ${registryEntry.license ?? 'N/A'}`,
                },
              ],
            };
          } else {
            // 401/403/404 — private or unresolved
            registryStatus = {
              privateOrUnresolved: true,
              evidence: [
                {
                  kind: 'registry',
                  source: `${ecosystem} registry for ${name}`,
                  retrievedAt: new Date().toISOString(),
                  detail: 'Package returned 404/401 — private or unresolved',
                },
              ],
            };
          }
        } catch (err) {
          // Network error / timeout / offline
          registryStatus = {
            lookupFailed: true,
            evidence: [
              {
                kind: 'registry',
                source: `${ecosystem} registry for ${name}`,
                retrievedAt: new Date().toISOString(),
                detail: err instanceof Error ? err.message : 'Registry lookup failed',
              },
            ],
          };
        }

        // ── OSV advisory ───────────────────────────────────────────────
        let advisoryStatus: AdvisoryStatusData | undefined;

        try {
          // Build PURL for OSV query
          const depList = deps.filter((d) => d.name === name);
          const purls = depList
            .map((d) => d.purl)
            .filter((p): p is string => !!p);

          if (purls.length > 0) {
            const osvResult = await queryOsvBatch(purls, { signal: options.signal });

            const hasAdvisory = [...osvResult.advisories.values()].some(
              (advisories) => advisories.length > 0,
            );

            if (hasAdvisory) {
              advisoryStatus = {
                hasAdvisory: true,
              };
            }
          }
        } catch {
          // OSV failure — don't block enrichment, just skip advisory
        }

        // ── Apply status classification to matching deps ────────────────
        for (const dep of deps) {
          if (dep.name !== name) continue;

          const newStatus = classifyStatus(dep, registryStatus, advisoryStatus);
          const newEvidence: Evidence[] = [
            ...dep.evidence,
            ...(registryStatus?.evidence ?? []),
            ...(advisoryStatus?.evidence ?? []),
          ];

          enrichedDeps.set(dep.id, {
            ...dep,
            latestStable: registryEntry?.latestStable ?? dep.latestStable,
            license: registryEntry?.license ?? dep.license,
            deprecated: registryEntry?.deprecated ?? dep.deprecated,
            yanked: registryEntry?.yanked ?? dep.yanked,
            status: newStatus,
            evidence: newEvidence,
          });

          // Generate findings for non-current statuses
          if (newStatus !== 'current' && newStatus !== 'local_path' && newStatus !== 'git_dependency') {
            allFindings.push(
              createFindingForStatus(dep.id, newStatus, registryEntry?.license),
            );
          }
        }
      }
    }

    // Build enriched dependency list, preserving un-enriched deps
    const finalDependencies = snapshot.dependencies.map(
      (dep) => enrichedDeps.get(dep.id) ?? dep,
    );

    return {
      ...snapshot,
      dependencies: finalDependencies,
      findings: allFindings,
    };
  }

  // ── Research ───────────────────────────────────────────────────────────

  /**
   * Interpret an enriched snapshot with the LLM: triage the problem cases,
   * research them, and append the resulting findings.
   *
   * Additive by construction. Two invariants hold here, and they are the whole
   * reason this is a separate pass rather than part of `enrich()`:
   *
   * 1. **`snapshot.dependencies` is returned untouched.** Version facts come
   *    only from registry evidence — the LLM cannot fabricate a `latestStable`
   *    because `Finding` has nowhere to put one (SDD §472).
   * 2. **Failure is not fatal.** No researcher, no candidates, a provider
   *    outage, a dry web search — every one of them returns the input snapshot
   *    unchanged. A deterministic report is the floor, never a casualty of the
   *    optional stage above it.
   *
   * @see docs/specs/techstack-sdd.md §31, §472
   */
  async research(
    snapshot: Snapshot,
    options: {
      researcher?: TechStackResearcher | undefined;
      researchLimit?: number | undefined;
      signal?: AbortSignal | undefined;
      /** Only ever emits the two research phases — narrow so callers can feed
       * `updateJob` without casting. */
      onProgress?:
        | ((phase: 'researching' | 'synthesizing', completed: number, total: number) => void)
        | undefined;
    } = {},
  ): Promise<Snapshot> {
    if (!options.researcher || options.signal?.aborted) return snapshot;

    const candidates = triageCandidates(snapshot.dependencies, {
      limit: options.researchLimit,
    });
    if (candidates.length === 0) return snapshot;

    options.onProgress?.('researching', 0, candidates.length);

    let findings: readonly Finding[];
    try {
      findings = await options.researcher.research(candidates, {
        signal: options.signal,
        onProgress: (completed, total) => {
          // Cluster-level progress, reported against the phase the UI shows.
          options.onProgress?.('researching', completed, total);
        },
      });
    } catch {
      // The deterministic snapshot stands on its own.
      return snapshot;
    }

    options.onProgress?.('synthesizing', 1, 1);
    if (findings.length === 0) return snapshot;

    // Deterministic findings first — facts outrank interpretations in the
    // order the report and the UI render them.
    return { ...snapshot, findings: [...snapshot.findings, ...findings] };
  }

  // ── Analyze ───────────────────────────────────────────────────────────

  /**
   * Run a full analysis: inventory + enrich + research + persist.
   * This is the main entry point for the analyze job flow.
   */
  async analyze(
    projectId: string,
    options: AnalyzeOptions,
  ): Promise<{ snapshot: Snapshot; job: TechStackJob }> {
    const jobId = options.jobId ?? randomUUID();
    const requestedBy = options.requestedBy ?? 'system';

    // Create job
    const job: TechStackJob = {
      id: jobId,
      projectId,
      targetRoot: options.targetRoot,
      kind: 'analyze',
      status: 'queued',
      fingerprint: '',
      requestedBy,
      sessionId: options.sessionId,
      createdAt: new Date().toISOString(),
      progress: { phase: 'queued', completed: 0, total: 0 },
    };
    this.store.saveJob(job);

    const updateJob = (status: TechStackJobStatus, progress?: TechStackJobProgress) => {
      this.store.updateJobStatus(jobId, status, progress);
      if (progress) options.onProgress?.(progress.phase, progress.completed, progress.total);
    };
    const throwIfAborted = (): void => {
      if (options.signal?.aborted) throw new DOMException('TechStack job cancelled', 'AbortError');
    };

    try {
      throwIfAborted();
      // Phase 1: Inventory (offline)
      updateJob('discovering', { phase: 'discovering', completed: 0, total: 1 });
      const snapshot = await this.inventory(
        projectId,
        options.targetRoot,
        jobId,
        (phase, completed, total) => {
          throwIfAborted();
          updateJob(phase as TechStackJobStatus, { phase, completed, total });
        },
      );
      throwIfAborted();

      // Phase 2: Enrich (online, if enabled)
      const isOnline = options.online !== false;
      if (isOnline) {
        updateJob('enriching', { phase: 'enriching', completed: 0, total: 1 });
        const enriched = await this.enrich(snapshot, {
          online: true,
          signal: options.signal,
        });
        throwIfAborted();

        // Phase 3: Research (LLM interpretation) — additive and optional.
        const researched = await this.research(enriched, {
          researcher: options.researcher,
          researchLimit: options.researchLimit,
          signal: options.signal,
          onProgress: (phase, completed, total) => {
            updateJob(phase, { phase, completed, total });
          },
        });
        throwIfAborted();

        // Persist enriched snapshot
        this.store.saveSnapshot(researched);

        updateJob('completed', { phase: 'completed', completed: 1, total: 1 });

        return {
          snapshot: researched,
          job: { ...job, status: 'completed', completedAt: new Date().toISOString() },
        };
      }

      // Offline mode — persist inventory-only snapshot
      this.store.saveSnapshot(snapshot);
      updateJob('completed', { phase: 'completed', completed: 1, total: 1 });

      return {
        snapshot,
        job: { ...job, status: 'completed', completedAt: new Date().toISOString() },
      };
    } catch (err) {
      if (options.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        updateJob('cancelled');
      } else {
        updateJob('failed');
      }
      throw err;
    }
  }
  // ── Report generation ─────────────────────────────────────────────────

  /**
   * Generate a human-readable report from a snapshot.
   *
   * @param format 'md' for Markdown, 'json' for raw JSON.
   * @returns The report as a string.
   */
  generateReport(snapshot: Snapshot, format: 'md' | 'json' = 'md'): string {
    if (format === 'json') return JSON.stringify(snapshot, null, 2);

    const lines: string[] = [
      '# TechStack Report',
      '',
      `**Generated:** ${snapshot.createdAt}`,
      `**Target:** ${snapshot.targetRoot}`,
      `**Fingerprint:** ${snapshot.fingerprint}`,
      `**Workspaces:** ${snapshot.workspaces.length}`,
      `**Dependencies:** ${snapshot.dependencies.length}`,
      `**Findings:** ${snapshot.findings.length}`,
      `**Coverage:** ${snapshot.coverage}`,
      '',
    ];

    // Workspaces
    if (snapshot.workspaces.length > 0) {
      lines.push('## Workspaces', '');
      lines.push('| Workspace | Ecosystem | Coverage | Deps |');
      lines.push('|---|---|---|---|');
      for (const ws of snapshot.workspaces) {
        const depCount = snapshot.dependencies.filter((d) => d.workspaceId === ws.id).length;
        lines.push(`| ${ws.relativeRoot} | ${ws.ecosystem} | ${ws.coverage} | ${depCount} |`);
      }
      lines.push('');
    }

    // Findings by severity
    const findings = snapshot.findings as ReadonlyArray<{
      id: string;
      type: string;
      severity: string;
      action: string;
      rationale: string;
      dependencyId: string;
    }>;
    if (findings.length > 0) {
      lines.push('## Findings', '');
      const bySeverity = new Map<string, Array<(typeof findings)[number]>>();
      for (const f of findings) {
        const list = bySeverity.get(f.severity) ?? [];
        list.push(f);
        bySeverity.set(f.severity, list);
      }
      for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
        const items = bySeverity.get(sev);
        if (!items || items.length === 0) continue;
        lines.push(`### ${sev.charAt(0).toUpperCase() + sev.slice(1)} (${items.length})`, '');
        for (const f of items) {
          const dep = snapshot.dependencies.find((d) => d.id === f.dependencyId);
          lines.push(`- **${dep?.name ?? f.dependencyId}** — ${f.type} — ${f.rationale}`);
        }
        lines.push('');
      }
    }

    // Dependencies summary
    if (snapshot.dependencies.length > 0) {
      lines.push('## Dependencies', '');
      lines.push('| Name | Ecosystem | Status | Locked | Latest |');
      lines.push('|---|---|---|---|---|');
      for (const dep of snapshot.dependencies) {
        lines.push(
          `| ${dep.name} | ${dep.ecosystem} | ${dep.status} | ${dep.locked ?? '—'} | ${dep.latestStable ?? '—'} |`,
        );
      }
    }

    return lines.join('\n');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function computeFingerprint(dependencies: readonly DependencyObservation[]): string {
  const parts = dependencies
    .map((d) => `${d.name}@${d.locked ?? d.requested ?? 'unknown'}`)
    .sort()
    .join(',');
  let hash = 0;
  for (let i = 0; i < parts.length; i++) {
    const char = parts.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `ts-${Math.abs(hash).toString(36)}`;
}

function createFindingForStatus(
  dependencyId: string,
  status: string,
  _license?: string,
): Finding {
  switch (status) {
    case 'vulnerable':
      return {
        id: `finding-${dependencyId}-vuln`,
        dependencyId,
        type: 'vulnerability',
        severity: 'high',
        action: 'upgrade_patch',
        confidence: 1.0,
        rationale: 'Known security advisory found for this package',
        evidence: [],
      };
    case 'deprecated':
      return {
        id: `finding-${dependencyId}-dep`,
        dependencyId,
        type: 'deprecated',
        severity: 'medium',
        action: 'replace',
        confidence: 1.0,
        rationale: 'Package is deprecated in the registry',
        evidence: [],
      };
    case 'yanked':
      return {
        id: `finding-${dependencyId}-yank`,
        dependencyId,
        type: 'deprecated',
        severity: 'high',
        action: 'replace',
        confidence: 1.0,
        rationale: 'Package version has been yanked from the registry',
        evidence: [],
      };
    case 'update_available_safe':
      return {
        id: `finding-${dependencyId}-update`,
        dependencyId,
        type: 'upgrade',
        severity: 'info',
        action: 'upgrade_minor',
        confidence: 1.0,
        rationale: 'A newer compatible version is available',
        evidence: [],
      };
    case 'update_available_breaking':
      return {
        id: `finding-${dependencyId}-major`,
        dependencyId,
        type: 'upgrade',
        severity: 'low',
        action: 'upgrade_major',
        confidence: 1.0,
        rationale: 'A newer version is available that may require breaking changes',
        evidence: [],
      };
    default:
      return {
        id: `finding-${dependencyId}-investigate`,
        dependencyId,
        type: 'investigate',
        severity: 'info',
        action: 'investigate',
        confidence: 0.5,
        rationale: `Package status is "${status}" — may need investigation`,
        evidence: [],
      };
  }
}
