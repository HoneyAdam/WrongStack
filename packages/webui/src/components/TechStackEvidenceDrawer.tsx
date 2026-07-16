/**
 * TechStackEvidenceDrawer — Expandable/collapsible evidence drawer for a single dependency.
 *
 * Groups evidence by kind (manifest, lockfile, registry, audit, osv)
 * and shows source URL, retrievedAt timestamp, and detail per evidence entry.
 *
 * @see docs/specs/techstack-sdd.md §4.1 (Evidence interface)
 */

import { useState, useCallback } from 'react';

// ── Inline types (mirror @wrongstack/techstack types without a hard dep) ──

interface Evidence {
  readonly kind: string;
  readonly source: string;
  readonly retrievedAt: string;
  readonly detail?: string;
}

interface DependencyEvidenceDrawerProps {
  readonly name: string;
  readonly evidence: readonly Evidence[];
  readonly latestStable?: string;
  readonly license?: string;
  readonly deprecated?: boolean;
  readonly yanked?: boolean;
  readonly status: string;
}

// ── Kind display config ───────────────────────────────────────────────────

interface KindConfig {
  readonly label: string;
  readonly color: string;
  readonly icon: string;
}

const KIND_CONFIG: Record<string, KindConfig> = {
  manifest: { label: 'Manifest', color: 'oklch(0.65 0.15 250)', icon: '\u{1F4C4}' },
  lockfile: { label: 'Lockfile', color: 'oklch(0.7 0.15 145)', icon: '\u{1F512}' },
  registry: { label: 'Registry', color: 'oklch(0.75 0.15 85)', icon: '\u{1F310}' },
  audit: { label: 'Audit', color: 'oklch(0.65 0.12 30)', icon: '\u{1F6E1}' },
  osv: { label: 'OSV Advisory', color: 'oklch(0.7 0.15 0)', icon: '\u{26A0}' },
  agent: { label: 'Agent Research', color: 'oklch(0.6 0.15 300)', icon: '\u{1F916}' },
  command: { label: 'Command Output', color: 'oklch(0.65 0.1 200)', icon: '\u{1F4BB}' },
};

function getKindConfig(kind: string): KindConfig {
  return KIND_CONFIG[kind] ?? {
    label: kind.charAt(0).toUpperCase() + kind.slice(1),
    color: 'oklch(0.6 0.02 250)',
    icon: '\u{2753}',
  };
}

// ── Format helpers ─────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function truncateSource(source: string, maxLen = 80): string {
  if (source.length <= maxLen) return source;
  return source.slice(0, Math.floor(maxLen / 2) - 5) + '…' + source.slice(-Math.floor(maxLen / 2) + 5);
}

// ── Status badge color ────────────────────────────────────────────────────

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
    case 'private_or_unresolved':
      return 'oklch(0.6 0.1 250)';
    case 'unknown':
      return 'oklch(0.6 0.02 250)';
    default:
      return 'oklch(0.6 0.02 250)';
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

function EvidenceGroup({ kind, entries }: { kind: string; entries: Evidence[] }) {
  const config = getKindConfig(kind);
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border" style={{
      borderColor: 'oklch(0.15 0.02 250 / 0.1)',
      backgroundColor: 'oklch(0.15 0.02 250 / 0.03)',
    }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-[oklch(0.15_0.02_250_/_0.05)]"
        style={{ color: config.color }}
      >
        <span className="text-sm">{config.icon}</span>
        <span>{config.label}</span>
        <span className="text-[10px] tabular-nums" style={{ color: 'oklch(0.5 0.02 250)' }}>
          {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
        </span>
        <span className="ml-auto text-[10px] transition-transform" style={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          &#x25BC;
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-1.5 px-3 pb-2">
          {entries.map((entry, idx) => (
            <div
              key={idx}
              className="rounded-md px-2.5 py-2"
              style={{ backgroundColor: 'oklch(0.15 0.02 250 / 0.05)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className="min-w-0 flex-1 break-all font-mono text-[11px]"
                  style={{ color: 'oklch(0.7 0.02 250)' }}
                  title={entry.source}
                >
                  {truncateSource(entry.source)}
                </span>
                <span
                  className="shrink-0 text-[10px] tabular-nums"
                  style={{ color: 'oklch(0.5 0.02 250)' }}
                >
                  {formatTimestamp(entry.retrievedAt)}
                </span>
              </div>
              {entry.detail && (
                <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'oklch(0.6 0.02 250)' }}>
                  {entry.detail}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function TechStackEvidenceDrawer({
  name,
  evidence,
  latestStable,
  license,
  deprecated,
  yanked,
  status,
}: DependencyEvidenceDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDrawer = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Group evidence by kind
  const grouped = new Map<string, Evidence[]>();
  for (const entry of evidence) {
    const list = grouped.get(entry.kind);
    if (list) {
      list.push(entry);
    } else {
      grouped.set(entry.kind, [...[entry]]);
    }
  }

  // Order: manifest, lockfile, registry, osv, audit, agent, command
  const kindOrder = ['manifest', 'lockfile', 'registry', 'osv', 'audit', 'agent', 'command'];
  const sortedKinds = [...grouped.entries()].sort(
    ([a], [b]) => kindOrder.indexOf(a) - kindOrder.indexOf(b),
  );

  const hasAny = evidence.length > 0;

  return (
    <div className="rounded-lg border" style={{
      borderColor: 'oklch(0.15 0.02 250 / 0.1)',
    }}>
      {/* Drawer toggle header */}
      <button
        type="button"
        onClick={toggleDrawer}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[oklch(0.15_0.02_250_/_0.04)]"
      >
        {/* Status indicator */}
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: statusColor(status) }}
        />

        {/* Package name */}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: 'oklch(0.9 0.01 250)' }}>
          {name}
        </span>

        {/* Status badge */}
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            backgroundColor: statusColor(status).replace(/\)$/, ' / 0.15)'),
            color: statusColor(status),
          }}
        >
          {status.replace(/_/g, ' ')}
        </span>

        {/* Evidence count */}
        {hasAny && (
          <span className="text-[10px] tabular-nums" style={{ color: 'oklch(0.5 0.02 250)' }}>
            {evidence.length}
          </span>
        )}

        {/* Chevron */}
        <span className="text-xs transition-transform" style={{
          color: 'oklch(0.5 0.02 250)',
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          &#x25BC;
        </span>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: 'oklch(0.15 0.02 250 / 0.08)' }}>
          {/* Summary metadata row */}
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {latestStable && (
              <span style={{ color: 'oklch(0.6 0.02 250)' }}>
                Latest stable: <span style={{ color: 'oklch(0.85 0.01 250)' }}>{latestStable}</span>
              </span>
            )}
            {license && (
              <span style={{ color: 'oklch(0.6 0.02 250)' }}>
                License: <span style={{ color: 'oklch(0.85 0.01 250)' }}>{license}</span>
              </span>
            )}
            {deprecated !== undefined && (
              <span style={{ color: deprecated ? 'oklch(0.65 0.12 30)' : 'oklch(0.6 0.02 250)' }}>
                Deprecated: <span style={{ color: 'oklch(0.85 0.01 250)' }}>{deprecated ? 'Yes' : 'No'}</span>
              </span>
            )}
            {yanked !== undefined && (
              <span style={{ color: yanked ? 'oklch(0.65 0.12 30)' : 'oklch(0.6 0.02 250)' }}>
                Yanked: <span style={{ color: 'oklch(0.85 0.01 250)' }}>{yanked ? 'Yes' : 'No'}</span>
              </span>
            )}
          </div>

          {!hasAny ? (
            <p className="py-2 text-center text-xs" style={{ color: 'oklch(0.5 0.02 250)' }}>
              No evidence recorded for this dependency.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {sortedKinds.map(([kind, entries]) => (
                <EvidenceGroup key={kind} kind={kind} entries={entries} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
