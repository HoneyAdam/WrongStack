import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookMarked,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDot,
  Clipboard,
  Database,
  FileCode2,
  FilterX,
  GitBranch,
  Link2,
  Loader2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useScrollPosition } from '@/hooks/useScrollPosition';
import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import { useConfigStore, useUIStore } from '@/stores';
import type {
  SuperMemoryAnchor,
  SuperMemoryEntry,
  SuperMemoryScope,
  SuperMemoryStats,
  SuperMemoryStatus,
} from '@/types';
import { MemoryGraph } from './MemoryGraph';

const MEMORY_KINDS = [
  'fact',
  'decision',
  'convention',
  'preference',
  'warning',
  'anti_pattern',
  'workflow',
  'bug_root_cause',
  'file_note',
  'symbol_note',
  'command_note',
  'summary',
] as const;

const MEMORY_STATUSES: SuperMemoryStatus[] = [
  'active',
  'stale',
  'superseded',
  'contradicted',
  'archived',
  'deleted',
];

const EDITABLE_STATUSES: SuperMemoryStatus[] = [
  'active',
  'stale',
  'superseded',
  'contradicted',
  'archived',
];

const MEMORY_SCOPES: SuperMemoryScope[] = ['project', 'user', 'session', 'file', 'symbol'];
const ANCHOR_TYPES: SuperMemoryAnchor['type'][] = [
  'file',
  'directory',
  'symbol',
  'package',
  'command',
  'test',
  'git',
];

const KIND_LABELS: Record<string, string> = {
  fact: 'Fact',
  decision: 'Decision',
  convention: 'Convention',
  preference: 'Preference',
  warning: 'Warning',
  anti_pattern: 'Anti-pattern',
  workflow: 'Workflow',
  bug_root_cause: 'Root cause',
  file_note: 'File note',
  symbol_note: 'Symbol note',
  command_note: 'Command note',
  summary: 'Summary',
};

interface MemoryDraft {
  text: string;
  kind: string;
  status: SuperMemoryStatus;
  scope: SuperMemoryScope;
  tags: string;
  importance: number;
  confidence: number;
  freshness: number;
  anchors: SuperMemoryAnchor[];
  audienceRoles: string;
  audienceTaskTypes: string;
  audienceModes: string;
  supersedes: string;
  contradicts: string;
}

interface MemoryEditorProps {
  mode: 'create' | 'edit';
  draft: MemoryDraft;
  busy: boolean;
  error: string | null;
  onChange: (draft: MemoryDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function emptyDraft(): MemoryDraft {
  return {
    text: '',
    kind: 'fact',
    status: 'active',
    scope: 'project',
    tags: '',
    importance: 0.5,
    confidence: 0.8,
    freshness: 1,
    anchors: [],
    audienceRoles: '',
    audienceTaskTypes: '',
    audienceModes: '',
    supersedes: '',
    contradicts: '',
  };
}

function draftFromMemory(memory: SuperMemoryEntry): MemoryDraft {
  return {
    text: memory.text,
    kind: memory.kind,
    status: memory.status,
    scope: memory.scope,
    tags: memory.tags.join(', '),
    importance: memory.importance,
    confidence: memory.confidence,
    freshness: memory.freshness,
    anchors: memory.anchors.map((anchor) => ({ ...anchor })),
    audienceRoles: (memory.audience?.roles ?? []).join(', '),
    audienceTaskTypes: (memory.audience?.taskTypes ?? []).join(', '),
    audienceModes: (memory.audience?.modes ?? []).join(', '),
    supersedes: (memory.supersedes ?? []).join(', '),
    contradicts: (memory.contradicts ?? []).join(', '),
  };
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function memoryPreview(text: string, max = 170): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function formatDate(value?: string): string {
  if (!value) return 'Never';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function relativeDate(value?: string): string {
  if (!value) return 'never';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`;
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d ago`;
  return formatDate(value);
}

function scoreLabel(value: number): string {
  if (value >= 0.85) return 'high';
  if (value >= 0.55) return 'medium';
  return 'low';
}

function statusClasses(status: SuperMemoryStatus): string {
  switch (status) {
    case 'active':
      return 'border-success/35 bg-success/10 text-success';
    case 'stale':
      return 'border-warning/40 bg-warning/10 text-warning';
    case 'contradicted':
      return 'border-destructive/40 bg-destructive/10 text-destructive';
    case 'superseded':
      return 'border-warning/30 bg-warning/5 text-warning';
    case 'archived':
      return 'border-info/35 bg-info/10 text-info';
    case 'deleted':
      return 'border-border bg-muted text-muted-foreground';
  }
}

function kindClasses(kind: string): string {
  if (kind === 'warning' || kind === 'anti_pattern' || kind === 'bug_root_cause') {
    return 'text-destructive';
  }
  if (kind === 'decision' || kind === 'workflow') return 'text-warning';
  if (kind === 'convention' || kind === 'preference') return 'text-success';
  if (kind === 'file_note' || kind === 'symbol_note' || kind === 'command_note') {
    return 'text-info';
  }
  return 'text-foreground';
}

function anchorValue(anchor: SuperMemoryAnchor): string {
  return anchor.path ?? anchor.command ?? '';
}

function updateAnchorValue(anchor: SuperMemoryAnchor, value: string): SuperMemoryAnchor {
  if (anchor.type === 'command') return { type: anchor.type, command: value };
  return {
    type: anchor.type,
    path: value,
    ...(anchor.type === 'symbol' && anchor.symbol ? { symbol: anchor.symbol } : {}),
  };
}

function normalizeAnchors(anchors: SuperMemoryAnchor[]): SuperMemoryAnchor[] {
  const normalized: SuperMemoryAnchor[] = [];
  for (const anchor of anchors) {
    const value = anchorValue(anchor).trim();
    const symbol = anchor.symbol?.trim();
    if (!value && !symbol) continue;
    if (anchor.type === 'command') {
      normalized.push({ type: 'command', command: value });
      continue;
    }
    normalized.push({
      type: anchor.type,
      ...(value ? { path: value } : {}),
      ...(symbol ? { symbol } : {}),
    });
  }
  return normalized;
}

function StatusBadge({ status }: { status: SuperMemoryStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-bold uppercase',
        statusClasses(status),
      )}
    >
      <span className="size-1.5 bg-current" aria-hidden="true" />
      {status}
    </span>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  hint: string;
  tone?: 'default' | 'success' | 'warning' | 'info';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'info'
          ? 'text-info'
          : 'text-foreground';
  return (
    <div className="border border-border/70 bg-card/55 px-3 py-2.5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.035)]">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={cn('font-mono text-xl font-bold tabular-nums', toneClass)}>{value}</p>
        <p className="truncate text-[9px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function RangeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="border border-border/65 bg-background/35 p-3">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={id}
          className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >
          {label}
        </label>
        <span className="font-mono text-xs font-bold tabular-nums text-info">
          {Math.round(value * 100)}% · {scoreLabel(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
        className="mt-3 h-1.5 w-full cursor-pointer accent-[hsl(var(--info))]"
      />
    </div>
  );
}

function MemoryEditor({
  mode,
  draft,
  busy,
  error,
  onChange,
  onCancel,
  onSubmit,
}: MemoryEditorProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const set = <K extends keyof MemoryDraft>(key: K, value: MemoryDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  const addAnchor = () => {
    set('anchors', [...draft.anchors, { type: 'file', path: '' }]);
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/70 px-4 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 items-center justify-center border border-info/35 bg-info/10 text-info">
            {mode === 'create' ? <Sparkles className="size-4" /> : <Pencil className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">
              {mode === 'create' ? 'Capture a memory' : 'Edit memory'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {mode === 'create'
                ? 'Add durable knowledge with retrieval metadata.'
                : 'Update content without losing provenance.'}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            <X className="size-3.5" /> Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={busy || !draft.text.trim()}
            className="bg-info text-background hover:bg-info/90"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : mode === 'create' ? (
              <Plus className="size-3.5" />
            ) : (
              <Save className="size-3.5" />
            )}
            {busy ? 'Saving…' : mode === 'create' ? 'Create memory' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-5">
        <div className="mx-auto max-w-4xl space-y-5">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <section className="border border-border/75 bg-card/45 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.14em]">Knowledge</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Write the durable fact or decision in complete, searchable language.
                </p>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {draft.text.length} chars
              </span>
            </div>
            <label htmlFor="memory-text" className="sr-only">
              Memory content
            </label>
            <textarea
              ref={textRef}
              id="memory-text"
              value={draft.text}
              onChange={(event) => set('text', event.target.value)}
              rows={7}
              required
              placeholder="Example: WebUI state is owned by Zustand stores; server messages update those stores through singleton WebSocket handlers."
              className="min-h-36 w-full resize-y border border-input bg-background/75 px-3 py-3 text-sm leading-6 text-foreground shadow-inner placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </section>

          <section className="grid gap-3 border border-border/75 bg-card/45 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label
                htmlFor="memory-kind"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Kind
              </label>
              <select
                id="memory-kind"
                value={draft.kind}
                onChange={(event) => set('kind', event.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              >
                {MEMORY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </div>
            {mode === 'create' ? (
              <div>
                <label
                  htmlFor="memory-scope"
                  className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Scope
                </label>
                <select
                  id="memory-scope"
                  value={draft.scope}
                  onChange={(event) => set('scope', event.target.value as SuperMemoryScope)}
                  className="h-10 w-full border border-input bg-background px-3 text-sm"
                >
                  {MEMORY_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="memory-status"
                  className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Lifecycle status
                </label>
                <select
                  id="memory-status"
                  value={draft.status}
                  onChange={(event) => set('status', event.target.value as SuperMemoryStatus)}
                  className="h-10 w-full border border-input bg-background px-3 text-sm"
                >
                  {EDITABLE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={mode === 'create' ? 'sm:col-span-2 lg:col-span-1' : ''}>
              <label
                htmlFor="memory-tags"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Tags
              </label>
              <Input
                id="memory-tags"
                value={draft.tags}
                onChange={(event) => set('tags', event.target.value)}
                placeholder="architecture, webui, workflow"
                className="h-10 bg-background"
              />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <RangeField
              id="memory-importance"
              label="Importance"
              value={draft.importance}
              onChange={(value) => set('importance', value)}
            />
            <RangeField
              id="memory-confidence"
              label="Confidence"
              value={draft.confidence}
              onChange={(value) => set('confidence', value)}
            />
            <RangeField
              id="memory-freshness"
              label="Freshness"
              value={draft.freshness}
              onChange={(value) => set('freshness', value)}
            />
          </section>

          <section className="border border-border/75 bg-card/45 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.14em]">Anchors</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Bind knowledge to files, symbols, packages, tests, Git paths, or commands.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addAnchor}>
                <Plus className="size-3.5" /> Add anchor
              </Button>
            </div>
            {draft.anchors.length === 0 ? (
              <button
                type="button"
                onClick={addAnchor}
                className="mt-4 flex w-full items-center justify-center gap-2 border border-dashed border-border px-4 py-7 text-xs text-muted-foreground transition-colors hover:border-info/50 hover:bg-info/5 hover:text-info"
              >
                <Link2 className="size-4" /> No anchors yet — add one to improve retrieval precision
              </button>
            ) : (
              <div className="mt-4 space-y-2">
                {draft.anchors.map((anchor, index) => (
                  <div
                    key={`${anchor.type}:${index}`}
                    className="grid gap-2 border border-border/65 bg-background/40 p-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
                  >
                    <label className="sr-only" htmlFor={`anchor-type-${index}`}>
                      Anchor {index + 1} type
                    </label>
                    <select
                      id={`anchor-type-${index}`}
                      value={anchor.type}
                      onChange={(event) => {
                        const type = event.target.value as SuperMemoryAnchor['type'];
                        const replacement: SuperMemoryAnchor =
                          type === 'command' ? { type, command: '' } : { type, path: '' };
                        const anchors = draft.anchors.map((item, itemIndex) =>
                          itemIndex === index ? replacement : item,
                        );
                        set('anchors', anchors);
                      }}
                      className="h-10 border border-input bg-background px-2 text-xs"
                    >
                      {ANCHOR_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <div
                      className={cn(
                        'grid min-w-0 gap-2',
                        anchor.type === 'symbol' && 'sm:grid-cols-[minmax(0,1fr)_11rem]',
                      )}
                    >
                      <label className="sr-only" htmlFor={`anchor-value-${index}`}>
                        Anchor {index + 1} value
                      </label>
                      <Input
                        id={`anchor-value-${index}`}
                        value={anchorValue(anchor)}
                        onChange={(event) => {
                          const anchors = draft.anchors.map((item, itemIndex) =>
                            itemIndex === index
                              ? updateAnchorValue(item, event.target.value)
                              : item,
                          );
                          set('anchors', anchors);
                        }}
                        placeholder={
                          anchor.type === 'command'
                            ? 'pnpm test --filter webui'
                            : 'packages/webui/src/App.tsx'
                        }
                        className="h-10 min-w-0 bg-background font-mono text-xs"
                      />
                      {anchor.type === 'symbol' && (
                        <>
                          <label className="sr-only" htmlFor={`anchor-symbol-${index}`}>
                            Anchor {index + 1} symbol
                          </label>
                          <Input
                            id={`anchor-symbol-${index}`}
                            value={anchor.symbol ?? ''}
                            onChange={(event) => {
                              const anchors = draft.anchors.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, symbol: event.target.value }
                                  : item,
                              );
                              set('anchors', anchors);
                            }}
                            placeholder="Symbol name"
                            className="h-10 bg-background font-mono text-xs"
                          />
                        </>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove anchor ${index + 1}`}
                      onClick={() =>
                        set(
                          'anchors',
                          draft.anchors.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-3 border border-border/75 bg-card/45 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <h3 className="text-xs font-bold uppercase tracking-[0.14em]">Relationships</h3>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Reference exact memory IDs. Relationships are validated and graph edges are rebuilt
                by Super Memory.
              </p>
            </div>
            <div>
              <label
                htmlFor="memory-supersedes"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Supersedes
              </label>
              <Input
                id="memory-supersedes"
                value={draft.supersedes}
                onChange={(event) => set('supersedes', event.target.value)}
                placeholder="mem_id, mem_id"
                className="h-10 bg-background font-mono text-xs"
              />
            </div>
            <div>
              <label
                htmlFor="memory-contradicts"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Contradicts
              </label>
              <Input
                id="memory-contradicts"
                value={draft.contradicts}
                onChange={(event) => set('contradicts', event.target.value)}
                placeholder="mem_id, mem_id"
                className="h-10 bg-background font-mono text-xs"
              />
            </div>
          </section>
          <section className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Audience (Optional)
            </h3>
            <p className="text-[10px] text-muted-foreground/70">
              Target this memory to specific agent types. Leave empty for general project memory.
            </p>
            <div>
              <label
                htmlFor="memory-audience-roles"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Roles
              </label>
              <Input
                id="memory-audience-roles"
                value={draft.audienceRoles}
                onChange={(event) => set('audienceRoles', event.target.value)}
                placeholder="reviewer, refactor-planner"
                className="h-9 bg-background font-mono text-xs"
              />
            </div>
            <div>
              <label
                htmlFor="memory-audience-task-types"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Task types
              </label>
              <Input
                id="memory-audience-task-types"
                value={draft.audienceTaskTypes}
                onChange={(event) => set('audienceTaskTypes', event.target.value)}
                placeholder="review, refactor, bugfix"
                className="h-9 bg-background font-mono text-xs"
              />
            </div>
            <div>
              <label
                htmlFor="memory-audience-modes"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Modes
              </label>
              <Input
                id="memory-audience-modes"
                value={draft.audienceModes}
                onChange={(event) => set('audienceModes', event.target.value)}
                placeholder="teach, code-review"
                className="h-9 bg-background font-mono text-xs"
              />
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}

export function MemoryManager() {
  const { client, listSuperMemories, rememberSuperMemory, updateSuperMemory, deleteSuperMemory } =
    useWebSocket();
  const wsConnected = useConfigStore((state) => state.wsConnected);
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const memoryListRef = useScrollPosition<HTMLDivElement>('memory');

  const [memories, setMemories] = useState<SuperMemoryEntry[]>([]);
  const [stats, setStats] = useState<SuperMemoryStats | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<MemoryDraft>(emptyDraft);
  const [baselineDraft, setBaselineDraft] = useState<MemoryDraft>(emptyDraft);
  const [busyAction, setBusyAction] = useState<'create' | 'update' | 'delete' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SuperMemoryStatus>('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [audienceOnly, setAudienceOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const mountedRef = useRef(true);
  const listGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const listCleanupRef = useRef<(() => void) | null>(null);
  const mutationCleanupRef = useRef<(() => void) | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baselineDraft),
    [baselineDraft, draft],
  );
  const selectedMemory = useMemo(
    () => memories.find((memory) => memory.id === selectedId) ?? null,
    [memories, selectedId],
  );

  const loadMemories = useCallback(() => {
    const generation = ++listGenerationRef.current;
    listCleanupRef.current?.();
    setRefreshing(true);
    setLoadError(null);
    if (!hasLoadedRef.current) setInitialLoading(true);

    let off = () => {};
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      off();
      if (listCleanupRef.current === cleanup) listCleanupRef.current = null;
    };

    off = client.on('memory.super.list', (message) => {
      if (generation !== listGenerationRef.current || !mountedRef.current) {
        cleanup();
        return;
      }
      cleanup();
      if (message.payload.error) {
        setLoadError(message.payload.error);
      } else {
        const next = message.payload.memories ?? [];
        setMemories(next);
        setStats(message.payload.stats ?? null);
        hasLoadedRef.current = true;
        setSelectedId((current) =>
          current && next.some((memory) => memory.id === current) ? current : null,
        );
      }
      setInitialLoading(false);
      setRefreshing(false);
    });

    timeout = setTimeout(() => {
      if (generation !== listGenerationRef.current || !mountedRef.current) return;
      cleanup();
      setLoadError(
        'The memory store did not respond. Check the WebSocket connection and try again.',
      );
      setInitialLoading(false);
      setRefreshing(false);
    }, 20_000);

    listCleanupRef.current = cleanup;
    listSuperMemories();
  }, [client, listSuperMemories]);

  useEffect(() => {
    mountedRef.current = true;
    loadMemories();
    return () => {
      mountedRef.current = false;
      listGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
      listCleanupRef.current?.();
      mutationCleanupRef.current?.();
    };
  }, [loadMemories]);

  const wasConnectedRef = useRef(wsConnected);
  useEffect(() => {
    if (wsConnected && !wasConnectedRef.current && hasLoadedRef.current) loadMemories();
    wasConnectedRef.current = wsConnected;
  }, [loadMemories, wsConnected]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const confirmDiscard = useCallback(() => {
    if (!dirty || (!editing && !creating)) return true;
    return window.confirm('Discard the unsaved memory changes?');
  }, [creating, dirty, editing]);

  const openCreate = useCallback(() => {
    if (!confirmDiscard()) return;
    const next = emptyDraft();
    setDraft(next);
    setBaselineDraft(next);
    setCreating(true);
    setEditing(false);
    setSelectedId(null);
    setMutationError(null);
  }, [confirmDiscard]);

  const openMemory = useCallback(
    (id: string) => {
      if (!confirmDiscard()) return;
      setSelectedId(id);
      setCreating(false);
      setEditing(false);
      setMutationError(null);
    },
    [confirmDiscard],
  );

  const openEdit = useCallback(() => {
    if (!selectedMemory || selectedMemory.status === 'deleted') return;
    const next = draftFromMemory(selectedMemory);
    setDraft(next);
    setBaselineDraft(next);
    setEditing(true);
    setCreating(false);
    setMutationError(null);
  }, [selectedMemory]);

  const cancelEditor = useCallback(() => {
    if (!confirmDiscard()) return;
    setEditing(false);
    setCreating(false);
    setMutationError(null);
  }, [confirmDiscard]);

  const runMutation = useCallback(
    (
      type: 'memory.super.remember' | 'memory.super.update',
      send: () => void,
      action: 'create' | 'update',
    ) => {
      if (!draft.text.trim()) {
        setMutationError('Memory content is required.');
        return;
      }
      const generation = ++mutationGenerationRef.current;
      mutationCleanupRef.current?.();
      setBusyAction(action);
      setMutationError(null);
      setNotice(null);

      let off = () => {};
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimeout(timeout);
        off();
        if (mutationCleanupRef.current === cleanup) mutationCleanupRef.current = null;
      };

      const onResponse = (message: {
        payload: { memory?: SuperMemoryEntry | undefined; error?: string | undefined };
      }) => {
        if (generation !== mutationGenerationRef.current || !mountedRef.current) {
          cleanup();
          return;
        }
        cleanup();
        setBusyAction(null);
        if (message.payload.error || !message.payload.memory) {
          setMutationError(message.payload.error ?? 'The server returned no memory record.');
          return;
        }
        const saved = message.payload.memory;
        setMemories((current) => {
          const without = current.filter((memory) => memory.id !== saved.id);
          return [saved, ...without];
        });
        setSelectedId(saved.id);
        setCreating(false);
        setEditing(false);
        setNotice(action === 'create' ? 'Memory captured.' : 'Memory updated.');
        loadMemories();
      };

      if (type === 'memory.super.remember') {
        off = client.on('memory.super.remember', onResponse);
      } else {
        off = client.on('memory.super.update', onResponse);
      }
      timeout = setTimeout(() => {
        if (generation !== mutationGenerationRef.current || !mountedRef.current) return;
        cleanup();
        setBusyAction(null);
        setMutationError(
          `${action === 'create' ? 'Create' : 'Save'} timed out. Your draft is still here.`,
        );
      }, 20_000);
      mutationCleanupRef.current = cleanup;
      send();
    },
    [client, draft.text, loadMemories],
  );

  const submitCreate = useCallback(() => {
    runMutation(
      'memory.super.remember',
      () =>
        rememberSuperMemory({
          text: draft.text.trim(),
          kind: draft.kind,
          scope: draft.scope,
          tags: splitList(draft.tags),
          importance: draft.importance,
          confidence: draft.confidence,
          freshness: draft.freshness,
          anchors: normalizeAnchors(draft.anchors),
          ...(splitList(draft.audienceRoles).length || splitList(draft.audienceTaskTypes).length || splitList(draft.audienceModes).length
            ? {
                audience: {
                  roles: splitList(draft.audienceRoles),
                  taskTypes: splitList(draft.audienceTaskTypes),
                  modes: splitList(draft.audienceModes),
                },
              }
            : {}),
          supersedes: splitList(draft.supersedes),
          contradicts: splitList(draft.contradicts),
        }),
      'create',
    );
  }, [draft, rememberSuperMemory, runMutation]);

  const submitUpdate = useCallback(() => {
    if (!selectedMemory) return;
    runMutation(
      'memory.super.update',
      () =>
        updateSuperMemory(selectedMemory.id, {
          text: draft.text.trim(),
          kind: draft.kind,
          status: draft.status,
          tags: splitList(draft.tags),
          importance: draft.importance,
          confidence: draft.confidence,
          freshness: draft.freshness,
          anchors: normalizeAnchors(draft.anchors),
          ...(splitList(draft.audienceRoles).length || splitList(draft.audienceTaskTypes).length || splitList(draft.audienceModes).length
            ? {
                audience: {
                  roles: splitList(draft.audienceRoles),
                  taskTypes: splitList(draft.audienceTaskTypes),
                  modes: splitList(draft.audienceModes),
                },
              }
            : {}),
          supersedes: splitList(draft.supersedes),
          contradicts: splitList(draft.contradicts),
        }),
      'update',
    );
  }, [draft, runMutation, selectedMemory, updateSuperMemory]);

  const confirmDelete = useCallback(() => {
    if (!deletingId) return;
    const generation = ++mutationGenerationRef.current;
    mutationCleanupRef.current?.();
    setBusyAction('delete');
    setMutationError(null);

    let off = () => {};
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      off();
      if (mutationCleanupRef.current === cleanup) mutationCleanupRef.current = null;
    };

    off = client.on('memory.super.delete', (message) => {
      if (generation !== mutationGenerationRef.current || !mountedRef.current) {
        cleanup();
        return;
      }
      cleanup();
      setBusyAction(null);
      if (!message.payload.success) {
        setMutationError(message.payload.message || 'Delete failed.');
        return;
      }
      setDeletingId(null);
      setSelectedId(null);
      setEditing(false);
      setNotice('Memory deleted and relationship edges cleaned up.');
      loadMemories();
    });
    timeout = setTimeout(() => {
      if (generation !== mutationGenerationRef.current || !mountedRef.current) return;
      cleanup();
      setBusyAction(null);
      setMutationError('Delete timed out. The memory may still exist; refresh to confirm.');
    }, 20_000);
    mutationCleanupRef.current = cleanup;
    deleteSuperMemory(deletingId, 'Deleted from the WebUI Memory Manager.');
  }, [client, deleteSuperMemory, deletingId, loadMemories]);

  const filteredMemories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return memories.filter((memory) => {
      if (statusFilter !== 'all' && memory.status !== statusFilter) return false;
      if (kindFilter !== 'all' && memory.kind !== kindFilter) return false;
      if (tagFilter && !memory.tags.includes(tagFilter)) return false;
      if (audienceOnly && !memory.audience) return false;
      if (!query) return true;
      const anchorText = memory.anchors
        .map((anchor) => [anchor.path, anchor.symbol, anchor.command].filter(Boolean).join(' '))
        .join(' ');
      const audienceText = memory.audience
        ? [
            memory.audience.roles?.join(' ') ?? '',
            memory.audience.taskTypes?.join(' ') ?? '',
            memory.audience.modes?.join(' ') ?? '',
          ].join(' ')
        : '';
      return [
        memory.id,
        memory.text,
        memory.summary ?? '',
        memory.kind,
        memory.scope,
        memory.tags.join(' '),
        anchorText,
        audienceText,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [audienceOnly, kindFilter, memories, searchQuery, statusFilter, tagFilter]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const memory of memories) {
      for (const tagName of memory.tags) counts.set(tagName, (counts.get(tagName) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [memories]);

  const relatedMemories = useMemo(() => {
    if (!selectedMemory) return [];
    const links: Array<{ relation: string; id: string }> = [];
    if (selectedMemory.supersededBy)
      links.push({ relation: 'Superseded by', id: selectedMemory.supersededBy });
    for (const id of selectedMemory.supersedes ?? []) links.push({ relation: 'Supersedes', id });
    for (const id of selectedMemory.contradicts ?? []) links.push({ relation: 'Contradicts', id });
    return links;
  }, [selectedMemory]);

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setKindFilter('all');
    setAudienceOnly(false);
    setTagFilter(null);
  };
  const hasFilters = Boolean(
    searchQuery || statusFilter !== 'all' || kindFilter !== 'all' || tagFilter || audienceOnly,
  );
  const detailOpen = creating || Boolean(selectedMemory);

  if (initialLoading && memories.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background" aria-busy="true">
        <div className="border-b border-border/70 bg-card/70 px-5 py-4">
          <div className="h-3 w-28 animate-pulse bg-muted" />
          <div className="mt-3 h-7 w-56 animate-pulse bg-muted" />
        </div>
        <div className="grid flex-1 gap-px bg-border/60 md:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.35fr)]">
          <div className="space-y-px bg-background p-4">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse border border-border/60 bg-card/45" />
            ))}
          </div>
          <div className="hidden bg-background p-6 md:block">
            <div className="h-full animate-pulse border border-border/60 bg-card/35" />
          </div>
        </div>
        <span className="sr-only" role="status">
          Loading Super Memory content
        </span>
      </div>
    );
  }

  if (loadError && memories.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
        <div className="max-w-md border border-destructive/35 bg-card p-6 shadow-2xl">
          <span className="flex size-11 items-center justify-center border border-destructive/35 bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <h2 className="mt-4 text-lg font-bold">Memory store unavailable</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{loadError}</p>
          <div className="mt-5 flex gap-2">
            <Button onClick={loadMemories}>
              <RefreshCw className="size-4" /> Retry
            </Button>
            <Button variant="outline" onClick={() => setCurrentView('chat')}>
              <ArrowLeft className="size-4" /> Back to chat
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="relative shrink-0 overflow-hidden border-b border-border/70 bg-card/72 px-4 py-3 backdrop-blur-xl sm:px-5">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_right,hsl(var(--info)/0.11),transparent_68%)]" />
        <div className="relative flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentView('chat')}
            aria-label="Back to chat"
            title="Back to chat"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="flex size-10 items-center justify-center border border-info/40 bg-info/10 text-info shadow-[0_0_20px_hsl(var(--info)/0.12)]">
            <BrainCircuit className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold sm:text-lg">Super Memory</h1>
              <span className="border border-success/35 bg-success/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-success">
                project knowledge
              </span>
            </div>
            <p className="mt-0.5 max-w-2xl text-[10px] text-muted-foreground sm:text-xs">
              Inspect, connect, curate, and retire durable context used across agent sessions.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span
              className={cn(
                'hidden items-center gap-1.5 border px-2 py-1 font-mono text-[9px] uppercase sm:flex',
                wsConnected ? 'border-success/30 text-success' : 'border-warning/30 text-warning',
              )}
            >
              <span className="size-1.5 bg-current" /> {wsConnected ? 'live store' : 'reconnecting'}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={loadMemories}
              disabled={refreshing}
              aria-label="Refresh memories"
            >
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              size="sm"
              onClick={openCreate}
              className="bg-info text-background hover:bg-info/90"
            >
              <Plus className="size-3.5" /> New memory
            </Button>
          </div>
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border/70 bg-border/60 sm:grid-cols-4">
        <MetricCard
          label="Memories"
          value={stats?.total ?? memories.length}
          hint={`${filteredMemories.length} visible`}
        />
        <MetricCard
          label="Active"
          value={
            stats?.byStatus.active ?? memories.filter((memory) => memory.status === 'active').length
          }
          hint="retrievable"
          tone="success"
        />
        <MetricCard
          label="Needs review"
          value={(stats?.byStatus.stale ?? 0) + (stats?.byStatus.contradicted ?? 0)}
          hint="stale + conflicts"
          tone="warning"
        />
        <div className="hidden sm:block">
          <MetricCard
            label="Graph edges"
            value={stats?.edges ?? 0}
            hint={`${allTags.length} tags`}
            tone="info"
          />
        </div>
      </div>

      {(notice || loadError || mutationError) && (
        <div className="shrink-0 border-b border-border/70 px-4 py-2" aria-live="polite">
          {notice && (
            <div role="status" className="flex items-center gap-2 text-xs text-success">
              <Check className="size-3.5" /> {notice}
            </div>
          )}
          {loadError && (
            <div role="alert" className="flex items-center gap-2 text-xs text-warning">
              <AlertTriangle className="size-3.5" /> {loadError} Existing content remains available.
            </div>
          )}
          {mutationError && !editing && !creating && (
            <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5" /> {mutationError}
            </div>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.35fr)]">
        <section
          className={cn(
            'min-h-0 border-r border-border/70 bg-card/25',
            detailOpen ? 'hidden md:flex md:flex-col' : 'flex flex-col',
          )}
          aria-label="Memory library"
        >
          <div className="shrink-0 space-y-2 border-b border-border/70 bg-card/45 p-3">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search memories"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search content, IDs, tags, anchors…"
                  className="h-10 bg-background pl-9 pr-8 text-xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <Button
                variant={audienceOnly ? 'default' : 'ghost'}
                size="icon"
                onClick={() => setAudienceOnly((v) => !v)}
                aria-label="Filter audience-scoped only"
                title="Show only audience-scoped memories"
                className="shrink-0"
              >
                <BrainCircuit className="size-4" />
              </Button>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearFilters}
                  aria-label="Clear all filters"
                  title="Clear all filters"
                >
                  <FilterX className="size-4" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="sr-only" htmlFor="memory-status-filter">
                Filter by status
              </label>
              <select
                id="memory-status-filter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'all' | SuperMemoryStatus)
                }
                className="h-9 border border-input bg-background px-2 text-xs"
              >
                <option value="all">All statuses</option>
                {MEMORY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status} · {stats?.byStatus[status] ?? 0}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="memory-kind-filter">
                Filter by kind
              </label>
              <select
                id="memory-kind-filter"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
                className="h-9 border border-input bg-background px-2 text-xs"
              >
                <option value="all">All kinds</option>
                {MEMORY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]} · {stats?.byKind[kind] ?? 0}
                  </option>
                ))}
              </select>
            </div>
            {allTags.length > 0 && (
              <fieldset className="min-w-0 border-0 p-0">
                <legend className="sr-only">Popular tags</legend>
                <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
                  {allTags.slice(0, 18).map(([tagName, count]) => (
                    <button
                      key={tagName}
                      type="button"
                      aria-pressed={tagFilter === tagName}
                      onClick={() => setTagFilter(tagFilter === tagName ? null : tagName)}
                      className={cn(
                        'flex shrink-0 items-center gap-1 border px-2 py-1 text-[10px] transition-colors',
                        tagFilter === tagName
                          ? 'border-info/55 bg-info/10 text-info'
                          : 'border-border/70 bg-background/45 text-muted-foreground hover:border-info/35 hover:text-foreground',
                      )}
                    >
                      <Tag className="size-2.5" /> {tagName}
                      <span className="font-mono opacity-60">{count}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
            <span>
              {filteredMemories.length} of {memories.length} memories
            </span>
            <span className="font-mono uppercase">updated ↓</span>
          </div>

          <section
            ref={memoryListRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            aria-label="Memories"
          >
            {filteredMemories.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                <span className="flex size-12 items-center justify-center border border-dashed border-border text-muted-foreground">
                  <Database className="size-5" />
                </span>
                <h2 className="mt-4 text-sm font-bold">
                  {memories.length === 0 ? 'Build your memory graph' : 'No matching memories'}
                </h2>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                  {memories.length === 0
                    ? 'Capture durable facts, decisions, conventions, and file-bound notes for every agent.'
                    : 'Change the filters or clear the search query.'}
                </p>
                <Button
                  className="mt-4"
                  variant="outline"
                  size="sm"
                  onClick={memories.length === 0 ? openCreate : clearFilters}
                >
                  {memories.length === 0 ? (
                    <Plus className="size-3.5" />
                  ) : (
                    <FilterX className="size-3.5" />
                  )}
                  {memories.length === 0 ? 'Create first memory' : 'Clear filters'}
                </Button>
              </div>
            ) : (
              filteredMemories.map((memory) => (
                <button
                  key={memory.id}
                  type="button"
                  aria-current={selectedId === memory.id ? 'true' : undefined}
                  onClick={() => openMemory(memory.id)}
                  className={cn(
                    'group relative block w-full border-b border-border/55 px-3 py-3 text-left transition-[background-color,border-color] hover:bg-info/5',
                    selectedId === memory.id && 'bg-info/8',
                  )}
                >
                  {selectedId === memory.id && (
                    <span className="absolute inset-y-0 left-0 w-0.5 bg-info shadow-[0_0_10px_hsl(var(--info)/0.7)]" />
                  )}
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-[10px] font-bold uppercase tracking-[0.1em]',
                        kindClasses(memory.kind),
                      )}
                    >
                      {KIND_LABELS[memory.kind] ?? memory.kind}
                    </span>
                    <StatusBadge status={memory.status} />
                    <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">
                      r{memory.revision}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'mt-2 line-clamp-2 text-xs leading-5 text-foreground/90',
                      memory.status === 'deleted' && 'line-through opacity-60',
                    )}
                  >
                    {memoryPreview(memory.text)}
                  </p>
                  <div className="mt-2 flex min-w-0 items-center gap-1.5">
                    <span className="border border-border/60 bg-background/50 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                      {memory.scope}
                    </span>
                    {memory.audience && (
                      <span className="flex items-center gap-0.5 border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] text-primary">
                        <BrainCircuit className="size-2.5" />
                        {(memory.audience.roles ?? memory.audience.taskTypes ?? memory.audience.modes ?? []).slice(0, 1)[0] ?? 'scoped'}
                      </span>
                    )}
                    {memory.tags.slice(0, 2).map((tagName) => (
                      <span
                        key={tagName}
                        className="max-w-24 truncate border border-border/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                      >
                        #{tagName}
                      </span>
                    ))}
                    {memory.tags.length > 2 && (
                      <span className="font-mono text-[9px] text-muted-foreground">
                        +{memory.tags.length - 2}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">
                      {relativeDate(memory.updatedAt)}
                    </span>
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-info" />
                  </div>
                </button>
              ))
            )}
          </section>
        </section>

        <section
          className={cn(
            'min-h-0 bg-background',
            detailOpen ? 'flex flex-col' : 'hidden md:flex md:flex-col',
          )}
          aria-label="Memory detail"
        >
          {creating ? (
            <MemoryEditor
              mode="create"
              draft={draft}
              busy={busyAction === 'create'}
              error={mutationError}
              onChange={setDraft}
              onCancel={cancelEditor}
              onSubmit={submitCreate}
            />
          ) : selectedMemory ? (
            editing ? (
              <MemoryEditor
                mode="edit"
                draft={draft}
                busy={busyAction === 'update'}
                error={mutationError}
                onChange={setDraft}
                onCancel={cancelEditor}
                onSubmit={submitUpdate}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/65 px-4 py-3 backdrop-blur-xl">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={() => setSelectedId(null)}
                    aria-label="Back to memory list"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <span
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-[0.14em]',
                      kindClasses(selectedMemory.kind),
                    )}
                  >
                    {KIND_LABELS[selectedMemory.kind] ?? selectedMemory.kind}
                  </span>
                  <StatusBadge status={selectedMemory.status} />
                  <span className="border border-border/70 px-2 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                    {selectedMemory.scope}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Copy memory ID"
                      title="Copy memory ID"
                      onClick={() => {
                        void navigator.clipboard?.writeText(selectedMemory.id);
                        setNotice('Memory ID copied.');
                      }}
                    >
                      <Clipboard className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openEdit}
                      disabled={selectedMemory.status === 'deleted'}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeletingId(selectedMemory.id)}
                      disabled={selectedMemory.status === 'deleted'}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-5">
                  <div className="mx-auto max-w-5xl space-y-5">
                    <div className="relative overflow-hidden border border-border/75 bg-card/55 p-5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)]">
                      <div className="pointer-events-none absolute -right-10 -top-10 size-36 bg-[radial-gradient(circle,hsl(var(--info)/0.13),transparent_68%)]" />
                      <p className="relative whitespace-pre-wrap text-sm leading-7 text-foreground md:text-[15px]">
                        {selectedMemory.text}
                      </p>
                      {selectedMemory.summary && (
                        <p className="relative mt-4 border-l-2 border-info/50 pl-3 text-xs italic leading-5 text-muted-foreground">
                          {selectedMemory.summary}
                        </p>
                      )}
                      <div className="relative mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                        <code className="min-w-0 break-all font-mono text-[10px] text-muted-foreground">
                          {selectedMemory.id}
                        </code>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          revision {selectedMemory.revision}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-px bg-border/60 sm:grid-cols-3">
                      {[
                        ['Importance', selectedMemory.importance, ShieldCheck],
                        ['Confidence', selectedMemory.confidence, CircleDot],
                        ['Freshness', selectedMemory.freshness, RefreshCw],
                      ].map(([label, rawValue, Icon]) => {
                        const value = rawValue as number;
                        const MetricIcon = Icon as typeof ShieldCheck;
                        return (
                          <div key={label as string} className="bg-card/60 p-3">
                            <div className="flex items-center gap-2">
                              <MetricIcon className="size-3.5 text-info" />
                              <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
                                {label as string}
                              </span>
                              <span className="ml-auto font-mono text-xs font-bold tabular-nums">
                                {Math.round(value * 100)}%
                              </span>
                            </div>
                            <div className="mt-2 h-1 bg-muted">
                              <div
                                className="h-full bg-info shadow-[0_0_8px_hsl(var(--info)/0.45)]"
                                style={{ width: `${Math.round(value * 100)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {selectedMemory.tags.length > 0 && (
                      <section>
                        <h3 className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                          <Tag className="size-3.5 text-info" /> Tags
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedMemory.tags.map((tagName) => (
                            <button
                              key={tagName}
                              type="button"
                              onClick={() => {
                                setTagFilter(tagName);
                                setSelectedId(null);
                              }}
                              className="border border-info/25 bg-info/5 px-2 py-1 font-mono text-[10px] text-info hover:border-info/55 hover:bg-info/10"
                            >
                              #{tagName}
                            </button>
                          ))}
                        </div>
                      </section>
                    )}

                    {selectedMemory.anchors.length > 0 && (
                      <section className="border border-border/75 bg-card/40">
                        <div className="flex items-center justify-between border-b border-border/65 px-3 py-2.5">
                          <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                            <FileCode2 className="size-3.5 text-info" /> Anchors
                          </h3>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {selectedMemory.anchors.length}
                          </span>
                        </div>
                        <ul className="divide-y divide-border/55">
                          {selectedMemory.anchors.map((anchor, index) => (
                            <li
                              key={`${anchor.type}:${anchor.path ?? anchor.command ?? anchor.symbol}:${index}`}
                              className="flex min-w-0 items-start gap-3 px-3 py-2.5"
                            >
                              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center border border-info/25 bg-info/5 text-info">
                                {anchor.type === 'command' ? (
                                  <TerminalSquare className="size-3.5" />
                                ) : (
                                  <FileCode2 className="size-3.5" />
                                )}
                              </span>
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground">
                                  {anchor.type}
                                </p>
                                <p className="mt-0.5 break-all font-mono text-[10px] leading-4 text-foreground/85">
                                  {anchor.path ?? anchor.command ?? '—'}
                                  {anchor.symbol ? `#${anchor.symbol}` : ''}
                                </p>
                              </div>
                              {(anchor.lineStart || anchor.lineEnd) && (
                                <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">
                                  L{anchor.lineStart ?? '?'}–{anchor.lineEnd ?? '?'}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {relatedMemories.length > 0 && (
                      <section className="border border-border/75 bg-card/40">
                        <div className="flex items-center justify-between border-b border-border/65 px-3 py-2.5">
                          <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                            <GitBranch className="size-3.5 text-info" /> Memory relationships
                          </h3>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {relatedMemories.length}
                          </span>
                        </div>
                        <ul className="divide-y divide-border/55">
                          {relatedMemories.map((relationship) => {
                            const target = memories.find((memory) => memory.id === relationship.id);
                            return (
                              <li key={`${relationship.relation}:${relationship.id}`}>
                                <button
                                  type="button"
                                  disabled={!target}
                                  onClick={() => target && openMemory(target.id)}
                                  className="group flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left hover:bg-info/5 disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  <span
                                    className={cn(
                                      'w-24 shrink-0 text-[9px] font-bold uppercase',
                                      relationship.relation === 'Contradicts'
                                        ? 'text-destructive'
                                        : 'text-info',
                                    )}
                                  >
                                    {relationship.relation}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-xs">
                                    {target
                                      ? memoryPreview(target.text, 95)
                                      : 'Referenced memory is unavailable'}
                                  </span>
                                  <code className="hidden max-w-32 truncate font-mono text-[9px] text-muted-foreground sm:block">
                                    {relationship.id}
                                  </code>
                                  {target && (
                                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-info" />
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    )}

                    <MemoryGraph centerMemory={selectedMemory} allMemories={memories} />

                    <section className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        ['Created', formatDate(selectedMemory.createdAt), BookMarked],
                        ['Updated', formatDate(selectedMemory.updatedAt), RefreshCw],
                        ['Last accessed', formatDate(selectedMemory.lastAccessedAt), Network],
                        ['Last verified', formatDate(selectedMemory.lastVerifiedAt), ShieldCheck],
                      ].map(([label, value, Icon]) => {
                        const MetaIcon = Icon as typeof BookMarked;
                        return (
                          <div key={label as string} className="bg-card/50 p-3">
                            <MetaIcon className="size-3.5 text-muted-foreground" />
                            <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                              {label as string}
                            </p>
                            <p className="mt-1 text-[10px] leading-4 text-foreground/85">
                              {value as string}
                            </p>
                          </div>
                        );
                      })}
                    </section>

                    {selectedMemory.status === 'deleted' && (
                      <div className="flex items-start gap-3 border border-border bg-muted/50 p-4 text-xs text-muted-foreground">
                        <Archive className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <p className="font-bold text-foreground">Deleted memory</p>
                          <p className="mt-1 leading-5">
                            The record remains visible for audit history, but its graph edges were
                            removed and it can no longer be edited or retrieved as active context.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="relative flex size-20 items-center justify-center border border-info/25 bg-info/5 text-info">
                <BrainCircuit className="size-8" />
                <span className="absolute inset-2 border border-info/10" />
              </div>
              <h2 className="mt-5 text-lg font-bold">Your project’s long-term context</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Select a memory to inspect its metadata and relationship graph, or capture knowledge
                that future agents should retrieve automatically.
              </p>
              <div className="mt-6 grid w-full max-w-lg gap-2 sm:grid-cols-3">
                <div className="border border-border/70 bg-card/45 p-3">
                  <ShieldCheck className="mx-auto size-4 text-success" />
                  <p className="mt-2 text-[10px] font-bold uppercase">Verified anchors</p>
                </div>
                <div className="border border-border/70 bg-card/45 p-3">
                  <GitBranch className="mx-auto size-4 text-info" />
                  <p className="mt-2 text-[10px] font-bold uppercase">Typed relations</p>
                </div>
                <div className="border border-border/70 bg-card/45 p-3">
                  <Sparkles className="mx-auto size-4 text-warning" />
                  <p className="mt-2 text-[10px] font-bold uppercase">Agent recall</p>
                </div>
              </div>
              <Button
                className="mt-6 bg-info text-background hover:bg-info/90"
                onClick={openCreate}
              >
                <Plus className="size-4" /> Capture memory
              </Button>
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={Boolean(deletingId)}
        onOpenChange={(open) => {
          if (!open && busyAction !== 'delete') setDeletingId(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <span className="mb-2 flex size-10 items-center justify-center border border-destructive/35 bg-destructive/10 text-destructive">
              <Trash2 className="size-4" />
            </span>
            <DialogTitle>Delete this memory?</DialogTitle>
            <DialogDescription className="leading-6">
              Super Memory will mark the record deleted, remove graph edges, and clean references
              from related memories. The record remains in the audit trail but cannot be restored
              from this page.
            </DialogDescription>
          </DialogHeader>
          <div className="border border-border/70 bg-background/45 p-3 text-xs text-muted-foreground">
            {memoryPreview(memories.find((memory) => memory.id === deletingId)?.text ?? '', 180)}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              disabled={busyAction === 'delete'}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={busyAction === 'delete'}
            >
              {busyAction === 'delete' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {busyAction === 'delete' ? 'Deleting…' : 'Delete memory'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
