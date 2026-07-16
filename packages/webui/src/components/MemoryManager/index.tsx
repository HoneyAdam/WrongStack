/**
 * MemoryManager — a full memory management panel for the WebUI.
 *
 * Provides:
 *   - Stats overview (total, by status, by kind, graph edges)
 *   - Filter by tag and status
 *   - Searchable memory list with compact cards
 *   - Detail/edit view for a selected memory
 *   - Delete with cascade cleanup
 *
 * All data flows through the SuperMemory WebSocket commands wired in
 * earlier phases (memory.super.list/get/update/delete).
 */

import {
  ArrowLeft,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScrollPosition } from '@/hooks/useScrollPosition';
import { getWSClient } from '@/lib/ws-client';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useUIStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MemoryGraph } from './MemoryGraph';

// ── Types ────────────────────────────────────────────────────────────

interface MemoryEntry {
  id: string;
  kind: string;
  status: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  importance: number;
  confidence: number;
  revision: number;
  anchors: Array<{ type: string; path?: string; symbol?: string; command?: string }>;
  supersedes?: string[] | undefined;
  supersededBy?: string | undefined;
  contradicts?: string[] | undefined;
}

interface MemoryStats {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  edges: number;
}

// ── Kind config ───────────────────────────────────────────────────────

const KIND_CONFIG: Record<string, { label: string; color: string }> = {
  fact: { label: 'Fact', color: 'text-blue-500' },
  decision: { label: 'Decision', color: 'text-amber-500' },
  convention: { label: 'Convention', color: 'text-emerald-500' },
  preference: { label: 'Preference', color: 'text-purple-500' },
  warning: { label: 'Warning', color: 'text-orange-500' },
  anti_pattern: { label: 'Anti-pattern', color: 'text-red-500' },
  workflow: { label: 'Workflow', color: 'text-cyan-500' },
  bug_root_cause: { label: 'Bug Root Cause', color: 'text-rose-500' },
  file_note: { label: 'File Note', color: 'text-slate-500' },
  symbol_note: { label: 'Symbol Note', color: 'text-indigo-500' },
  command_note: { label: 'Command Note', color: 'text-teal-500' },
  summary: { label: 'Summary', color: 'text-pink-500' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'text-green-600 bg-green-50 border-green-200' },
  stale: { label: 'Stale', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  superseded: { label: 'Superseded', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  contradicted: { label: 'Contradicted', color: 'text-red-600 bg-red-50 border-red-200' },
  archived: { label: 'Archived', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  deleted: { label: 'Deleted', color: 'text-gray-500 bg-gray-50 border-gray-200' },
};

// ── Helpers ───────────────────────────────────────────────────────────

function kindLabel(kind: string): string {
  return KIND_CONFIG[kind]?.label ?? kind;
}

function statusBadge(status: string): string {
  const cfg = STATUS_CONFIG[status];
  return cfg
    ? `inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.color}`
    : 'inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-50';
}

function shortenId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

// ── Component ─────────────────────────────────────────────────────────

export function MemoryManager() {
  const ws = useWebSocket();
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  // State
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editKind, setEditKind] = useState('');
  const [editImportance, setEditImportance] = useState(0.5);
  const [editConfidence, setEditConfidence] = useState(0.5);
  const [saving, setSaving] = useState(false);

  // Create state
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [deleting, setDeleting] = useState<string | null>(null);

  // ── Stale-request guard for loadMemories ────────────────────────────
  const listReqGenRef = useRef(0);
  const loadRequestCleanupRef = useRef<(() => void) | null>(null);

  // ── Stale-request guards for mutating actions ────────────────────────
  const saveReqGenRef = useRef(0);
  const saveRequestCleanupRef = useRef<(() => void) | null>(null);
  const deleteReqGenRef = useRef(0);
  const deleteRequestCleanupRef = useRef<(() => void) | null>(null);
  // ── Load data ───────────────────────────────────────────────────────

  const loadMemories = useCallback(() => {
    const gen = ++listReqGenRef.current;
    setLoading(true);
    setError(null);

    const client = getWSClient();
    loadRequestCleanupRef.current?.();

    let timeout: ReturnType<typeof setTimeout> | null = null;

    let cleanup: (() => void) | null = null;
    const handler = (msg: { type: string; payload: unknown }) => {
      if (gen !== listReqGenRef.current) {
        cleanup?.();
        return; // stale request
      }
      if (msg.type === 'memory.super.list') {
        const p = msg.payload as { memories?: MemoryEntry[]; stats?: MemoryStats; error?: string };
        if (p.error) {
          setError(p.error);
        } else {
          setMemories(p.memories ?? []);
          setStats(p.stats ?? null);
        }
        setLoading(false);
        cleanup?.();
      }
    };

    cleanup = () => {
      if (timeout !== null) {
        clearTimeout(timeout ?? undefined);
        timeout = null;
      }
      client.off('memory.super.list', handler);
      if (loadRequestCleanupRef.current === cleanup) {
        loadRequestCleanupRef.current = null;
      }
    };

    timeout = setTimeout(() => {
      if (gen !== listReqGenRef.current) return;
      cleanup?.();
      setError('Load timed out — no response from server.');
      setLoading(false);
    }, 30_000);

    client.on('memory.super.list', handler);
    loadRequestCleanupRef.current = cleanup;
    ws.listSuperMemories();
  }, [ws]);

  useEffect(() => {
    loadMemories();
    // Cleanup: invalidate any in-flight request on unmount so stale
    // handlers cannot mutate unmounted component state.
    return () => {
      listReqGenRef.current++;
      loadRequestCleanupRef.current?.();
    };
  }, [loadMemories]);

  // ── Filtered list ───────────────────────────────────────────────────

  const filteredMemories = useMemo(() => {
    // Copy the array so .sort() at the end does not mutate the original state
    let result = [...memories];

    if (statusFilter !== 'all') {
      result = result.filter((m) => m.status === statusFilter);
    }

    if (tagFilter.trim()) {
      const q = tagFilter.toLowerCase().trim();
      result = result.filter((m) => m.tags.some((t) => t.toLowerCase().includes(q)));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (m) =>
          m.text.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [memories, statusFilter, tagFilter, searchQuery]);

  // ── Selected memory ─────────────────────────────────────────────────

  const selectedMemory = useMemo(
    () => memories.find((m) => m.id === selectedId) ?? null,
    [memories, selectedId],
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const m of memories) for (const t of m.tags) set.add(t);
    return [...set].sort();
  }, [memories]);

  // ── Edit handlers ───────────────────────────────────────────────────

  const startEditing = useCallback(() => {
    if (!selectedMemory) return;
    setEditing(true);
    setEditText(selectedMemory.text);
    setEditTags(selectedMemory.tags.join(', '));
    setEditKind(selectedMemory.kind);
    setEditImportance(selectedMemory.importance);
    setEditConfidence(selectedMemory.confidence);
  }, [selectedMemory]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSave = useCallback(() => {
    const gen = ++saveReqGenRef.current;
    const client = getWSClient();
    saveRequestCleanupRef.current?.();

    const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);

    if (creating) {
      // ── Create mode ──
      if (!editText.trim()) {
        setError('Text is required.');
        return;
      }

      setSaving(true);
      setError(null);
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let cleanup: (() => void) | null = null;
      cleanup = () => {
        if (timeout !== null) {
          clearTimeout(timeout ?? undefined);
          timeout = null;
        }
        client.off('memory.super.remember', rememberHandler);
        if (saveRequestCleanupRef.current === cleanup) {
          saveRequestCleanupRef.current = null;
        }
      };

      const rememberHandler = (msg: { type: string; payload: unknown }) => {
        if (gen !== saveReqGenRef.current) {
          cleanup?.();
          return;
        }
        if (msg.type === 'memory.super.remember') {
          clearTimeout(timeout ?? undefined);
          const p = msg.payload as { memory?: MemoryEntry; error?: string };
          if (p.error) {
            setError(p.error);
            setSaving(false);
            cleanup?.();
            return;
          }

          setSaving(false);
          setCreating(false);
          setEditText('');
          setEditTags('');
          setEditKind('fact');
          setEditConfidence(0.8);
          setEditImportance(0.5);
          loadMemories();
          cleanup?.();
        }
      };

      client.on('memory.super.remember', rememberHandler);
      saveRequestCleanupRef.current = cleanup;
      timeout = setTimeout(() => {
        if (gen !== saveReqGenRef.current) return;
        cleanup?.();
        setSaving(false);
        setError('Create timed out — no response from server.');
      }, 30_000);
      ws.rememberSuperMemory({ text: editText.trim(), kind: editKind, tags, importance: editImportance, confidence: editConfidence });
      return;
    }

    // ── Update mode ──
    if (!selectedMemory) return;

    setSaving(true);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cleanup: (() => void) | null = null;

    cleanup = () => {
      if (timeout !== null) {
        clearTimeout(timeout ?? undefined);
        timeout = null;
      }
      client.off('memory.super.update', updateHandler);
      if (saveRequestCleanupRef.current === cleanup) {
        saveRequestCleanupRef.current = null;
      }
    };

    const updateHandler = (msg: { type: string; payload: unknown }) => {
      if (gen !== saveReqGenRef.current) {
        cleanup?.();
        return;
      }
      if (msg.type === 'memory.super.update') {
        clearTimeout(timeout ?? undefined);
        const p = msg.payload as { memory?: MemoryEntry; error?: string };
        if (p.error) {
          setError(p.error);
          setSaving(false);
          // Keep edit mode open and the user's draft intact on transient
          // server failures — exiting edit mode would discard their changes.
        } else {
          loadMemories();
          setSaving(false);
          setEditing(false);
        }
        cleanup?.();
      }
    };

    client.on('memory.super.update', updateHandler);
    saveRequestCleanupRef.current = cleanup;
    timeout = setTimeout(() => {
      if (gen !== saveReqGenRef.current) return;
      cleanup?.();
      setSaving(false);
      setError('Save timed out — no response from server.');
    }, 30_000);
    ws.updateSuperMemory(selectedMemory.id, {
      text: editText,
      tags,
      kind: editKind,
      importance: editImportance,
      confidence: editConfidence,
    });
  }, [selectedMemory, editText, editTags, editKind, editImportance, editConfidence, creating, ws, loadMemories]);

  // ── Delete handler ──────────────────────────────────────────────────

  const handleDeleteConfirm = useCallback(() => {
    if (!deleting) return;

    const gen = ++deleteReqGenRef.current;
    const client = getWSClient();
    deleteRequestCleanupRef.current?.();

    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cleanup: (() => void) | null = null;

    cleanup = () => {
      if (timeout !== null) {
        clearTimeout(timeout ?? undefined);
        timeout = null;
      }
      client.off('memory.super.delete', deleteHandler);
      if (deleteRequestCleanupRef.current === cleanup) {
        deleteRequestCleanupRef.current = null;
      }
    };

    const deleteHandler = (msg: { type: 'memory.super.delete'; payload: { success: boolean; message: string } }) => {
      if (gen !== deleteReqGenRef.current) {
        cleanup?.();
        return;
      }
      // Only process the operation-specific response type, never a generic
      // broadcast event — prevents false matches with other operations
      // that also deliver results through the same event channel.
      if (msg.type !== 'memory.super.delete' || !msg.payload) {
        return;
      }

      clearTimeout(timeout ?? undefined);
      const p = msg.payload;
      if (!p.success) {
        setError(p.message ?? 'Delete failed.');
        setDeleting(null);
      } else {
        loadMemories();
        if (selectedId === deleting) {
          setSelectedId(null);
        }
        setDeleting(null);
      }
      cleanup?.();
    };

    client.on('memory.super.delete', deleteHandler);
    deleteRequestCleanupRef.current = cleanup;

    timeout = setTimeout(() => {
      if (gen !== deleteReqGenRef.current) return;
      cleanup?.();
      setDeleting(null);
      setError('Delete timed out — no response from server.');
    }, 30_000);

    ws.deleteSuperMemory(deleting);
  }, [deleting, selectedId, ws, loadMemories]);

  // ── Render: Loading ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <span className="ml-3 text-sm text-muted-foreground">Loading memories…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={loadMemories}>
          Retry
        </Button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* ── Left panel: stats + list ── */}
      <div className="flex w-1/2 min-w-0 flex-col border-r border-border">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => setCurrentView('chat')} title="Back to chat">
            <ArrowLeft className="size-4" />
          </Button>
          <h2 className="text-sm font-bold">Memory Manager</h2>
          <Button variant="outline" size="sm" className="ml-2 h-6 px-2 text-xs" onClick={() => { setCreating(true); setSelectedId(null); setEditing(false); setEditText(''); setEditTags(''); setEditKind('fact'); setEditImportance(0.5); setEditConfidence(0.8); setError(null); }}>
            <Plus className="mr-1 size-3" />
            New
          </Button>
          <button
            type="button"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            onClick={loadMemories}
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-4 gap-px border-b border-border bg-muted text-center text-xs">
            <div className="bg-card py-2">
              <div className="font-bold text-foreground">{stats.total}</div>
              <div className="text-muted-foreground">Total</div>
            </div>
            <div className="bg-card py-2">
              <div className="font-bold text-green-600">{stats.byStatus['active'] ?? 0}</div>
              <div className="text-muted-foreground">Active</div>
            </div>
            <div className="bg-card py-2">
              <div className="font-bold text-yellow-600">{stats.byStatus['stale'] ?? 0}</div>
              <div className="text-muted-foreground">Stale</div>
            </div>
            <div className="bg-card py-2">
              <div className="font-bold text-muted-foreground">{stats.edges}</div>
              <div className="text-muted-foreground">Edges</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 border-b border-border p-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-7 text-xs"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="stale">Stale</option>
            <option value="archived">Archived</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>

        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            {allTags.slice(0, 30).map((t) => (
              <button
                key={t}
                type="button"
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  tagFilter === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
                onClick={() => setTagFilter(tagFilter === t ? '' : t)}
              >
                <Tag className="size-3" />
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Memory list */}
        <div ref={useScrollPosition('memory')} className="flex-1 overflow-y-auto overscroll-contain">
          {filteredMemories.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {memories.length === 0 ? 'No memories yet.' : 'No memories match the filter.'}
            </div>
          ) : (
            filteredMemories.map((mem) => (
              <button
                key={mem.id}
                type="button"
                className={`flex w-full flex-col gap-1 border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-muted/50 ${
                  selectedId === mem.id ? 'bg-muted' : ''
                }`}
                onClick={() => {
                  setSelectedId(mem.id);
                  setEditing(false);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className={KIND_CONFIG[mem.kind]?.color ?? 'text-muted-foreground'}>
                    {kindLabel(mem.kind)}
                  </span>
                  <span className={statusBadge(mem.status)}>{mem.status}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {shortenId(mem.id)}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-foreground">
                  {mem.text}
                </p>
                <div className="flex items-center gap-1.5">
                  {mem.tags.slice(0, 5).map((t) => (
                    <span
                      key={t}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                  {mem.tags.length > 5 && (
                    <span className="text-[10px] text-muted-foreground">+{mem.tags.length - 5}</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {fmtDate(mem.createdAt)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: detail / edit ── */}
      <div className="flex w-1/2 min-w-0 flex-col">
        {creating ? (
          /* ── Create new memory ── */
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Plus className="size-4 text-primary" />
              <h3 className="text-sm font-bold">New Memory</h3>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  <X className="mr-1 size-3" />
                  Cancel
                </Button>
                <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <div className="mr-1 size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Check className="mr-1 size-3" />
                  )}
                  Create
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Text</label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                    rows={4}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    placeholder="Enter memory content…"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Kind</label>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={editKind}
                    onChange={(e) => setEditKind(e.target.value)}
                  >
                    {Object.entries(KIND_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Tags (comma-separated)</label>
                  <Input className="h-8 text-sm" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="tag1, tag2, tag3" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Importance: {editImportance.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.05" className="w-full" value={editImportance} onChange={(e) => setEditImportance(Number.parseFloat(e.target.value))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Confidence: {editConfidence.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.05" className="w-full" value={editConfidence} onChange={(e) => setEditConfidence(Number.parseFloat(e.target.value))} />
                </div>
              </div>
            </div>
          </div>
        ) : !selectedMemory ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a memory to view or edit
          </div>
        ) : editing ? (
          /* ── Edit mode ── */
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Pencil className="size-4 text-primary" />
              <h3 className="text-sm font-bold">Edit Memory</h3>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={saving}>
                  <X className="mr-1 size-3" />
                  Cancel
                </Button>
                <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <div className="mr-1 size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Check className="mr-1 size-3" />
                  )}
                  Save
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
              <div className="space-y-4">
                {/* Text */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Text</label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                    rows={4}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                </div>
                {/* Kind */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Kind</label>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={editKind}
                    onChange={(e) => setEditKind(e.target.value)}
                  >
                    {Object.entries(KIND_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Tags */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Tags (comma-separated)
                  </label>
                  <Input
                    className="h-8 text-sm"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                  />
                </div>
                {/* Importance */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Importance: {editImportance.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    className="w-full"
                    value={editImportance}
                    onChange={(e) => setEditImportance(Number.parseFloat(e.target.value))}
                  />
                </div>
                {/* Confidence */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Confidence: {editConfidence.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    className="w-full"
                    value={editConfidence}
                    onChange={(e) => setEditConfidence(Number.parseFloat(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── Detail view ── */
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className={`text-xs font-bold ${KIND_CONFIG[selectedMemory.kind]?.color ?? ''}`}>
                {kindLabel(selectedMemory.kind)}
              </span>
              <span className={statusBadge(selectedMemory.status)}>{selectedMemory.status}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{selectedMemory.id}</span>
              <div className="ml-auto flex gap-1">
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <Pencil className="mr-1 size-3" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleting(selectedMemory.id)}
                >
                  <Trash2 className="mr-1 size-3" />
                  Delete
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
              <div className="space-y-4">
                {/* Text */}
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">Text</h4>
                  <p className="whitespace-pre-wrap text-sm leading-6">{selectedMemory.text}</p>
                </div>
                {/* Tags */}
                {selectedMemory.tags.length > 0 && (
                  <div>
                    <h4 className="mb-1 text-xs font-medium text-muted-foreground">Tags</h4>
                    <div className="flex flex-wrap gap-1">
                      {selectedMemory.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Anchors */}
                {selectedMemory.anchors.length > 0 && (
                  <div>
                    <h4 className="mb-1 text-xs font-medium text-muted-foreground">Anchors</h4>
                    <ul className="space-y-1">
                      {selectedMemory.anchors.map((a, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ExternalLink className="size-3" />
                          <span className="font-mono">{a.type}</span>
                          {a.path && <span className="font-mono">{a.path}</span>}
                          {a.symbol && <span className="font-mono">#{a.symbol}</span>}
                          {a.command && <span className="font-mono">${a.command}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Relationship Graph */}
                {(selectedMemory.supersedes?.length || selectedMemory.contradicts?.length || selectedMemory.supersededBy) ? (
                  <div className="pt-2">
                    <MemoryGraph
                      centerMemory={selectedMemory}
                      allMemories={memories}
                      onSelectMemory={(id) => { setSelectedId(id); setEditing(false); }}
                    />
                  </div>
                ) : null}
                {/* Metadata */}
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">Created</span>
                    <p className="text-xs">{fmtDate(selectedMemory.createdAt)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">Updated</span>
                    <p className="text-xs">{fmtDate(selectedMemory.updatedAt)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">Importance</span>
                    <p className="text-xs">{selectedMemory.importance.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">Confidence</span>
                    <p className="text-xs">{selectedMemory.confidence.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">Revision</span>
                    <p className="text-xs">{selectedMemory.revision}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Delete confirmation dialog ── */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-bold">Delete Memory</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This will soft-delete the memory, remove its graph edges, and clean up any
              supersedes/contradicts references from other memories. This action is reversible
              (status changes to 'deleted').
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
