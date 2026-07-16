import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
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
import { useScrollPosition } from '@/hooks/useScrollPosition';
import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import { useConfigStore, useUIStore } from '@/stores';
import type { SuperMemoryEntry, SuperMemoryStats, SuperMemoryStatus } from '@/types';
import { MemoryDetail } from './MemoryDetail';
import { MemoryEditor } from './MemoryEditor';
import { MemoryFilters } from './MemoryFilters';
import { MemoryList } from './MemoryList';
import type { MemoryDraft } from './shared';
import {
  draftFromMemory,
  emptyDraft,
  MetricCard,
  memoryPreview,
  normalizeAnchors,
  splitList,
} from './shared';

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
          ...(splitList(draft.audienceRoles).length ||
          splitList(draft.audienceTaskTypes).length ||
          splitList(draft.audienceModes).length
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
          ...(splitList(draft.audienceRoles).length ||
          splitList(draft.audienceTaskTypes).length ||
          splitList(draft.audienceModes).length
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

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setKindFilter('all');
    setAudienceOnly(false);
    setTagFilter(null);
  }, []);

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
            <Button size="sm" onClick={openCreate}>
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

      {(() => {
        const scopedCount = memories.filter((m) => m.audience).length;
        if (scopedCount === 0) return null;
        const roles = new Set<string>();
        for (const m of memories) {
          if (!m.audience) continue;
          for (const r of m.audience.roles ?? []) roles.add(r);
          for (const r of m.audience.taskTypes ?? []) roles.add(r);
          for (const r of m.audience.modes ?? []) roles.add(r);
        }
        return (
          <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-primary/5 px-4 py-1.5">
            <BrainCircuit className="size-3.5 text-primary" />
            <span className="text-[11px] font-medium text-primary">
              {scopedCount} audience-scoped memory{scopedCount !== 1 ? 'ies' : ''}
            </span>
            {roles.size > 0 && (
              <span className="text-[10px] text-muted-foreground">
                ({[...roles].sort().join(', ')})
              </span>
            )}
          </div>
        );
      })()}

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
          <MemoryFilters
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            kindFilter={kindFilter}
            audienceOnly={audienceOnly}
            tagFilter={tagFilter}
            hasFilters={hasFilters}
            allTags={allTags}
            stats={stats}
            onSearchChange={setSearchQuery}
            onStatusFilterChange={setStatusFilter}
            onKindFilterChange={setKindFilter}
            onToggleAudienceOnly={() => setAudienceOnly((v) => !v)}
            onTagFilterChange={setTagFilter}
            onClearFilters={clearFilters}
          />
          <MemoryList
            memoryListRef={memoryListRef}
            memories={memories}
            filteredMemories={filteredMemories}
            selectedId={selectedId}
            onSelectMemory={openMemory}
            onOpenCreate={openCreate}
            onClearFilters={clearFilters}
          />
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
              <MemoryDetail
                memory={selectedMemory}
                allMemories={memories}
                relatedMemories={relatedMemories}
                onClose={() => setSelectedId(null)}
                onOpenMemory={openMemory}
                onEdit={openEdit}
                onDelete={() => setDeletingId(selectedMemory.id)}
                onTagSelect={(tag) => {
                  setTagFilter(tag);
                  setSelectedId(null);
                }}
                onNotice={setNotice}
              />
            )
          ) : (
            <MemoryManagerEmpty onCapture={openCreate} />
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

function MemoryManagerEmpty({ onCapture }: { onCapture: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
      <div className="relative flex size-20 items-center justify-center border border-info/25 bg-info/5 text-info">
        <BrainCircuit className="size-8" />
        <span className="absolute inset-2 border border-info/10" />
      </div>
      <h2 className="mt-5 text-lg font-bold">Your project’s long-term context</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Select a memory to inspect its metadata and relationship graph, or capture knowledge that
        future agents should retrieve automatically.
      </p>
      <div className="mt-6 grid w-full max-w-lg gap-2 sm:grid-cols-3">
        <div className="border border-border/70 bg-card/45 p-3">
          <Check className="mx-auto size-4 text-success" />
          <p className="mt-2 text-[10px] font-bold uppercase">Verified anchors</p>
        </div>
        <div className="border border-border/70 bg-card/45 p-3">
          <BrainCircuit className="mx-auto size-4 text-info" />
          <p className="mt-2 text-[10px] font-bold uppercase">Typed relations</p>
        </div>
        <div className="border border-border/70 bg-card/45 p-3">
          <Plus className="mx-auto size-4 text-warning" />
          <p className="mt-2 text-[10px] font-bold uppercase">Agent recall</p>
        </div>
      </div>
      <Button onClick={onCapture}>
        <Plus className="size-4" /> Capture memory
      </Button>
    </div>
  );
}
