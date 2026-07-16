/**
 * TechStackView — WebUI read-only dependency inventory view.
 *
 * Fetches GET /api/techstack/snapshot on mount and renders:
 * - Workspace tree (name, ecosystem, coverage, dependency count)
 * - Dependency table (name, ecosystem, scope, sourceType, requested, locked)
 * - Coverage ledger (workspaces grouped by full/partial/unsupported status)
 * - Empty state when no snapshot exists
 *
 * Uses bento-dashboard design kit tokens (oklch colors).
 *
 * @see docs/specs/techstack-sdd.md §4.2, §6
 */

import { useCallback, useEffect, useState } from 'react';
import {
  type TechStackCoverage,
  type TechStackDependency,
  type TechStackSnapshot,
  type TechStackWorkspace,
  useTechStackStore,
} from '@/stores';

// ── Store-backed domain aliases ────────────────────────────────────────────

type Coverage = TechStackCoverage;
type Workspace = TechStackWorkspace;
type DependencyObservation = TechStackDependency;

// ── Types ─────────────────────────────────────────────────────────────────

interface SnapshotResponse {
  snapshot: TechStackSnapshot | null;
  stale: boolean;
}

type ViewTab = 'workspaces' | 'dependencies' | 'coverage';

// ── Color helpers using design kit tokens ─────────────────────────────────

function coverageColor(c: Coverage): string {
  switch (c) {
    case 'full':
      return 'oklch(0.7 0.15 145)'; // green
    case 'partial':
      return 'oklch(0.75 0.15 85)'; // amber
    case 'unsupported':
      return 'oklch(0.65 0.12 30)'; // red
  }
}

function coverageLabel(c: Coverage): string {
  switch (c) {
    case 'full':
      return 'Full';
    case 'partial':
      return 'Partial';
    case 'unsupported':
      return 'Unsupported';
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-1 min-h-0 min-w-0 items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ backgroundColor: 'oklch(0.15 0.02 250 / 0.08)' }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold" style={{ color: 'oklch(0.9 0.01 250)' }}>
          No TechStack Snapshot
        </h3>
        <p className="text-xs" style={{ color: 'oklch(0.6 0.02 250)' }}>
          Run an inventory scan to populate the dependency inventory.
          Use the <code className="rounded-sm bg-muted px-1 py-0.5 text-[11px]">/techstack</code> slash command
          or trigger an inventory job from the CLI.
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 min-h-0 min-w-0 items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2" style={{
          borderColor: 'oklch(0.6 0.02 250 / 0.3)',
          borderTopColor: 'oklch(0.65 0.15 250)',
        }} />
        <span className="text-xs" style={{ color: 'oklch(0.6 0.02 250)' }}>
          Loading TechStack snapshot…
        </span>
      </div>
    </div>
  );
}

function StaleBanner({ stale }: { stale: boolean }) {
  if (!stale) return null;
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
      style={{
        backgroundColor: 'oklch(0.75 0.15 85 / 0.15)',
        color: 'oklch(0.65 0.15 85)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      This snapshot is stale (last updated &gt;24h ago). Results may not reflect the current state.
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────

function TabBar({
  active,
  onSelect,
  workspaceCount,
  depCount,
}: {
  active: ViewTab;
  onSelect: (t: ViewTab) => void;
  workspaceCount: number;
  depCount: number;
}) {
  const tabs: Array<{ id: ViewTab; label: string; count: number }> = [
    { id: 'workspaces', label: 'Workspaces', count: workspaceCount },
    { id: 'dependencies', label: 'Dependencies', count: depCount },
    { id: 'coverage', label: 'Coverage Ledger', count: 0 },
  ];

  return (
    <div className="flex gap-1 border-b" style={{ borderColor: 'oklch(0.15 0.02 250 / 0.1)' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
          style={{
            color: active === tab.id ? 'oklch(0.9 0.01 250)' : 'oklch(0.6 0.02 250)',
            borderBottom: active === tab.id ? '2px solid oklch(0.65 0.15 250)' : '2px solid transparent',
          }}
        >
          {tab.label}
          {tab.count > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
              style={{
                backgroundColor: 'oklch(0.15 0.02 250 / 0.08)',
                color: 'oklch(0.6 0.02 250)',
              }}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Workspace tree ────────────────────────────────────────────────────────

function WorkspaceTree({
  workspaces,
  dependencies,
}: {
  workspaces: readonly Workspace[];
  dependencies: readonly DependencyObservation[];
}) {
  // Group by ecosystem
  const byEco = new Map<string, { workspace: Workspace; deps: DependencyObservation[] }>();
  for (const ws of workspaces) {
    const wsDeps = dependencies.filter((d) => d.workspaceId === ws.id);
    byEco.set(ws.id, { workspace: ws, deps: wsDeps });
  }

  return (
    <div className="flex flex-col gap-2 overflow-auto p-4">
      {workspaces.map((ws) => {
        const entry = byEco.get(ws.id);
        const depCount = entry?.deps.length ?? 0;
        return (
          <div
            key={ws.id}
            className="rounded-lg border p-3"
            style={{
              borderColor: 'oklch(0.15 0.02 250 / 0.1)',
              backgroundColor: 'oklch(0.15 0.02 250 / 0.04)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <EcosystemIcon ecosystem={ws.ecosystem} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: 'oklch(0.9 0.01 250)' }}>
                    {ws.id}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: 'oklch(0.6 0.02 250)' }}>
                    {ws.relativeRoot}
                    {ws.packageManager ? ` · ${ws.packageManager}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs tabular-nums" style={{ color: 'oklch(0.6 0.02 250)' }}>
                  {depCount} dep{depCount !== 1 ? 's' : ''}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: coverageColor(ws.coverage).replace(')', ' / 0.15)'),
                    color: coverageColor(ws.coverage),
                  }}
                >
                  {coverageLabel(ws.coverage)}
                </span>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(
                ['Cargo.toml', 'package.json', 'pyproject.toml', 'go.mod', 'composer.json', 'pubspec.yaml', '*.csproj'] as const
              ).filter((m) => ws.manifests.some((wm) => wm.includes(m.replace('*', '')))).length > 0
                ? ws.manifests.map((m) => (
                    <span
                      key={m}
                      className="rounded px-1.5 py-0.5 text-[10px] font-mono"
                      style={{
                        backgroundColor: 'oklch(0.15 0.02 250 / 0.06)',
                        color: 'oklch(0.6 0.02 250)',
                      }}
                    >
                      {m.split('/').pop()}
                    </span>
                  ))
                : ws.manifests.map((m) => (
                    <span
                      key={m}
                      className="rounded px-1.5 py-0.5 text-[10px] font-mono"
                      style={{
                        backgroundColor: 'oklch(0.15 0.02 250 / 0.06)',
                        color: 'oklch(0.6 0.02 250)',
                      }}
                    >
                      {m.split('/').pop()}
                    </span>
                  ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Dependency table ──────────────────────────────────────────────────────

function DependencyTable({ dependencies }: { dependencies: readonly DependencyObservation[] }) {
  if (dependencies.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <span className="text-xs" style={{ color: 'oklch(0.6 0.02 250)' }}>
          No dependencies inventoried.
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-auto p-4">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'oklch(0.6 0.02 250)', borderBottom: '1px solid oklch(0.15 0.02 250 / 0.1)' }}>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Ecosystem</th>
            <th className="px-3 py-2 text-left font-medium">Scope</th>
            <th className="px-3 py-2 text-left font-medium">Source</th>
            <th className="px-3 py-2 text-left font-medium">Requested</th>
            <th className="px-3 py-2 text-left font-medium">Locked</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {dependencies.map((dep) => (
            <tr
              key={dep.id}
              style={{ borderBottom: '1px solid oklch(0.15 0.02 250 / 0.05)' }}
              className="hover:bg-[oklch(0.15_0.02_250_/_0.04)]"
            >
              <td className="px-3 py-1.5 font-medium" style={{ color: 'oklch(0.9 0.01 250)' }}>
                {dep.name}
              </td>
              <td className="px-3 py-1.5" style={{ color: 'oklch(0.65 0.02 250)' }}>
                {dep.ecosystem}
              </td>
              <td className="px-3 py-1.5" style={{ color: 'oklch(0.65 0.02 250)' }}>
                {dep.scope}
              </td>
              <td className="px-3 py-1.5" style={{ color: 'oklch(0.65 0.02 250)' }}>
                {dep.sourceType}
              </td>
              <td className="max-w-[160px] truncate px-3 py-1.5 font-mono" style={{ color: 'oklch(0.65 0.02 250)' }}>
                {dep.requested ?? '—'}
              </td>
              <td className="max-w-[120px] truncate px-3 py-1.5 font-mono" style={{ color: 'oklch(0.65 0.02 250)' }}>
                {dep.locked ?? '—'}
              </td>
              <td className="px-3 py-1.5">
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: statusBg(dep.status),
                    color: statusColor(dep.status),
                  }}
                >
                  {dep.status}
                </span>
              </td>
              <td className="px-3 py-1.5">
                {dep.evidence && dep.evidence.length > 0 ? (
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-[oklch(0.15_0.02_250_/_0.1)]"
                    style={{
                      color: 'oklch(0.65 0.15 250)',
                      backgroundColor: 'oklch(0.65 0.15 250 / 0.1)',
                    }}
                    onClick={() => {
                      // Dispatch custom event to open evidence drawer
                      window.dispatchEvent(
                        new CustomEvent('techstack:show-evidence', {
                          detail: { dep },
                        }),
                      );
                    }}
                  >
                    {dep.evidence.length} src
                  </button>
                ) : (
                  <span className="text-[10px]" style={{ color: 'oklch(0.5 0.02 250)' }}>
                    —
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Coverage ledger ───────────────────────────────────────────────────────

function CoverageLedger({ workspaces }: { workspaces: readonly Workspace[] }) {
  const full = workspaces.filter((w) => w.coverage === 'full');
  const partial = workspaces.filter((w) => w.coverage === 'partial');
  const unsupported = workspaces.filter((w) => w.coverage === 'unsupported');

  return (
    <div className="flex flex-col gap-4 overflow-auto p-4">
      <CoverageSection title="Full Coverage" coverage="full" workspaces={full} />
      <CoverageSection title="Partial Coverage" coverage="partial" workspaces={partial} />
      <CoverageSection title="Unsupported" coverage="unsupported" workspaces={unsupported} />
    </div>
  );
}

function CoverageSection({
  title,
  coverage,
  workspaces,
}: {
  title: string;
  coverage: Coverage;
  workspaces: Workspace[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: coverageColor(coverage) }}
        />
        <span className="text-sm font-semibold" style={{ color: 'oklch(0.9 0.01 250)' }}>
          {title}
        </span>
        <span className="text-xs tabular-nums" style={{ color: 'oklch(0.6 0.02 250)' }}>
          {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
        </span>
      </div>
      {workspaces.length === 0 ? (
        <p className="text-xs" style={{ color: 'oklch(0.5 0.02 250)' }}>
          No workspaces in this category.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className="flex items-center justify-between rounded-md px-3 py-1.5"
              style={{ backgroundColor: 'oklch(0.15 0.02 250 / 0.04)' }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <EcosystemIcon ecosystem={ws.ecosystem} />
                <span className="truncate text-xs font-medium" style={{ color: 'oklch(0.85 0.01 250)' }}>
                  {ws.relativeRoot}
                </span>
              </div>
              <span className="text-[10px] font-mono" style={{ color: 'oklch(0.5 0.02 250)' }}>
                {ws.ecosystem}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ecosystem icon ────────────────────────────────────────────────────────

function EcosystemIcon({ ecosystem }: { ecosystem: string }) {
  const icons: Record<string, string> = {
    npm: '\u2b1a', python: '\u{1F40D}', rust: '\u2699',
    go: '\u2693', dotnet: '\u25a3', php: '\u{1F4E6}',
    dart: '\u2665', maven: '\u2615', gradle: '\u{1F3B4}',
    ruby: '\u{1F4A0}', swift: '\u2b50', elixir: '\u{1F4A7}',
    cpp: '\u269b',
  };
  const icon = icons[ecosystem] ?? '\u2753';
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs"
      style={{ backgroundColor: 'oklch(0.15 0.02 250 / 0.08)' }}
    >
      {icon}
    </span>
  );
}

// ── Status helpers ────────────────────────────────────────────────────────

function statusBg(status: string): string {
  switch (status) {
    case 'current':
      return 'oklch(0.7 0.15 145 / 0.15)';
    case 'update_available_safe':
    case 'update_available_breaking':
      return 'oklch(0.75 0.15 85 / 0.15)';
    case 'vulnerable':
    case 'deprecated':
    case 'yanked':
      return 'oklch(0.65 0.12 30 / 0.15)';
    default:
      return 'oklch(0.15 0.02 250 / 0.08)';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'current':
      return 'oklch(0.7 0.15 145)';
    case 'update_available_safe':
    case 'update_available_breaking':
      return 'oklch(0.75 0.15 85)';
    case 'vulnerable':
    case 'deprecated':
    case 'yanked':
      return 'oklch(0.65 0.12 30)';
    default:
      return 'oklch(0.6 0.02 250)';
  }
}

// ── Main component ────────────────────────────────────────────────────────

function downloadSnapshot(snapshot: TechStackSnapshot, format: 'json' | 'md'): void {
  const text = format === 'json'
    ? JSON.stringify(snapshot, null, 2)
    : [
        '# TechStack Snapshot',
        '',
        `Generated: ${snapshot.createdAt}`,
        `Target: ${snapshot.targetRoot}`,
        `Workspaces: ${snapshot.workspaces.length}`,
        `Dependencies: ${snapshot.dependencies.length}`,
        `Findings: ${snapshot.findings.length}`,
        '',
        '## Dependencies',
        ...snapshot.dependencies.map(
          (dependency) =>
            `- ${dependency.name} (${dependency.ecosystem}) — ${dependency.locked ?? dependency.requested ?? 'unknown'} — ${dependency.status}`,
        ),
      ].join('\n');
  const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `techstack.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TechStackView() {
  const snapshot = useTechStackStore((state) => state.snapshot);
  const stale = useTechStackStore((state) => state.stale);
  const loading = useTechStackStore((state) => state.loading);
  const error = useTechStackStore((state) => state.error);
  const activeJob = useTechStackStore((state) => state.activeJob);
  const [activeTab, setActiveTab] = useState<ViewTab>('workspaces');

  const fetchSnapshot = useCallback(async () => {
    const store = useTechStackStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
      const response = await fetch('/api/techstack/snapshot');
      if (response.status === 404) {
        store.setSnapshot(null, false);
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const data = (await response.json()) as SnapshotResponse;
      store.setSnapshot(data.snapshot, data.stale);
    } catch (cause) {
      store.setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const startJob = useCallback(async (kind: 'inventory' | 'analyze') => {
    const store = useTechStackStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
      const response = await fetch(`/api/techstack/${kind}`, { method: 'POST' });
      const body = (await response.json()) as { jobId?: string; error?: string };
      if (!response.ok || !body.jobId) {
        throw new Error(body.error ?? `HTTP ${response.status}: ${response.statusText}`);
      }
      store.jobStarted(body.jobId, kind);
    } catch (cause) {
      store.setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const cancelJob = useCallback(async () => {
    if (!activeJob) return;
    try {
      const response = await fetch(
        `/api/techstack/jobs/${encodeURIComponent(activeJob.id)}/cancel`,
        { method: 'POST' },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      useTechStackStore.getState().jobCancelled(activeJob.id);
    } catch (cause) {
      useTechStackStore.getState().setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [activeJob]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const jobRunning = Boolean(
    activeJob && !['completed', 'failed', 'cancelled'].includes(activeJob.status),
  );

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ backgroundColor: 'oklch(0.1 0.02 250)' }}>
      <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: 'oklch(0.15 0.02 250 / 0.1)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold" style={{ color: 'oklch(0.9 0.01 250)' }}>
              TechStack Inventory
            </h1>
            <p className="truncate text-[11px]" style={{ color: 'oklch(0.6 0.02 250)' }}>
              {snapshot
                ? `${snapshot.targetRoot} · ${new Date(snapshot.createdAt).toLocaleString()}`
                : 'No snapshot yet'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StaleBanner stale={stale} />
            <button type="button" onClick={() => void startJob('inventory')} disabled={jobRunning}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50">
              Refresh
            </button>
            <button type="button" onClick={() => void startJob('analyze')} disabled={jobRunning}
              className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
              Analyze
            </button>
            {jobRunning && (
              <button type="button" onClick={() => void cancelJob()}
                className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs font-medium text-destructive">
                Cancel
              </button>
            )}
            <button type="button" onClick={() => snapshot && downloadSnapshot(snapshot, 'md')} disabled={!snapshot}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50">
              Export MD
            </button>
            <button type="button" onClick={() => snapshot && downloadSnapshot(snapshot, 'json')} disabled={!snapshot}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50">
              Export JSON
            </button>
          </div>
        </div>
        {activeJob?.progress && jobRunning && (
          <div className="mt-2 text-[11px] text-muted-foreground" role="status" aria-live="polite">
            {activeJob.progress.phase} · {activeJob.progress.completed}/{activeJob.progress.total}
          </div>
        )}
        {error && (
          <div className="mt-2 flex items-center gap-2 text-xs text-destructive" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void fetchSnapshot()} className="underline">Retry</button>
          </div>
        )}
      </div>

      {loading && !snapshot && <LoadingState />}
      {!loading && !snapshot && <EmptyState />}
      {snapshot && (
        <>
          <TabBar
            active={activeTab}
            onSelect={setActiveTab}
            workspaceCount={snapshot.workspaces.length}
            depCount={snapshot.dependencies.length}
          />
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab === 'workspaces' && (
              <WorkspaceTree workspaces={snapshot.workspaces} dependencies={snapshot.dependencies} />
            )}
            {activeTab === 'dependencies' && (
              <DependencyTable dependencies={snapshot.dependencies} />
            )}
            {activeTab === 'coverage' && (
              <CoverageLedger workspaces={snapshot.workspaces} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
