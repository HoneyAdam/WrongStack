/**
 * AudienceMemoryPanel — browse and manage role-scoped project memories.
 *
 * Displays memories that have an `audience` selector, supports filtering
 * by role, creating new scoped memories, and clearing the scope from
 * an existing memory.
 */
import { Filter, Plus, RefreshCw, ShieldOff, Tag, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import type { SuperMemoryEntry } from '@/types';

function formatAudience(audience: NonNullable<SuperMemoryEntry['audience']>): string {
  const parts: string[] = [];
  if (audience.roles?.length) parts.push(`roles: ${audience.roles.join(', ')}`);
  if (audience.taskTypes?.length) parts.push(`tasks: ${audience.taskTypes.join(', ')}`);
  if (audience.modes?.length) parts.push(`modes: ${audience.modes.join(', ')}`);
  return parts.join(' · ');
}

export function AudienceMemoryPanel() {
  const ws = useWebSocket();
  const [memories, setMemories] = useState<SuperMemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const mountedRef = useRef(false);

  // Stable send ref so refresh() doesn't change on every ws.client reference change
  const sendRef = useRef<(msg: unknown) => void>(() => {});
  sendRef.current = (msg) => ws.client.send?.(msg as never);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    sendRef.current({ type: 'memory.super.list' });
  }, []);

  // Only load on mount — not every time ws.client reference changes
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    refresh();
  }, [refresh]);

  // Stable client ref for event handlers
  const clientRef = useRef(ws.client);
  clientRef.current = ws.client;

  useEffect(() => {
    const client = clientRef.current;
    const unsubList = client.on?.('memory.super.list', (msg: unknown) => {
      const payload = (msg as { payload?: { memories?: SuperMemoryEntry[]; error?: string } })
        ?.payload;
      if (payload?.error) setError(payload.error);
      else setMemories(payload?.memories ?? []);
      setLoading(false);
    });
    const unsubRemember = client.on?.('memory.super.remember', (msg: unknown) => {
      const payload = (msg as { payload?: { memory?: SuperMemoryEntry; error?: string } })?.payload;
      if (payload?.error) setError(payload.error);
      else if (payload?.memory) {
        setMemories((prev) => [payload.memory!, ...prev]);
        setShowCreate(false);
      }
    });
    const unsubUpdate = client.on?.('memory.super.update', (msg: unknown) => {
      const payload = (msg as { payload?: { memory?: SuperMemoryEntry; error?: string } })?.payload;
      if (!payload?.error && payload?.memory) {
        setMemories((prev) =>
          prev.map((m) => (m.id === payload.memory!.id ? payload.memory! : m)),
        );
      }
    });
    const unsubDelete = client.on?.('memory.super.delete', () => {
      refresh();
    });
    return () => {
      unsubList?.();
      unsubRemember?.();
      unsubUpdate?.();
      unsubDelete?.();
    };
  }, [refresh]);

  const scoped = memories.filter((m) => m.audience);
  const filtered = filterRole
    ? scoped.filter((m) =>
        m.audience?.roles?.some((r) => r.toLowerCase().includes(filterRole.toLowerCase())),
      )
    : scoped;

  const handleClearScope = (id: string) => {
    ws.client.send?.({ type: 'memory.super.update', payload: { id, audience: {} } });
  };

  const handleDelete = (id: string) => {
    ws.client.send?.({
      type: 'memory.super.delete',
      payload: { id, reason: 'Removed from audience panel' },
    });
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Tag className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Audience-Scoped Memory</h2>
          <span className="text-xs text-muted-foreground">({scoped.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="size-7" onClick={refresh} title="Refresh">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="size-3" />
            Add
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Filter className="size-3.5 text-muted-foreground" />
        <Input
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          placeholder="Filter by role…"
          className="h-7 text-xs"
        />
        {filterRole && (
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setFilterRole('')}>
            <X className="size-3" />
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {showCreate && (
        <CreateAudienceMemory
          onCancel={() => setShowCreate(false)}
          onCreate={(entry) => {
            ws.client.send?.({
              type: 'memory.super.remember',
              payload: {
                text: entry.text,
                kind: entry.kind,
                audience: {
                  roles: entry.roles.length > 0 ? entry.roles : undefined,
                  taskTypes: entry.taskTypes.length > 0 ? entry.taskTypes : undefined,
                  modes: entry.modes.length > 0 ? entry.modes : undefined,
                },
              },
            });
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No audience-scoped memories. Add one with the Add button or{' '}
            <code className="text-foreground">/memory audience remember</code>.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((mem) => (
              <li
                key={mem.id}
                className="rounded-md border border-border/60 bg-background/50 p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">{mem.text}</p>
                    {mem.audience && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatAudience(mem.audience)}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                      <span className="rounded bg-muted px-1 py-0.5">{mem.kind}</span>
                      <span className="rounded bg-muted px-1 py-0.5">{mem.status}</span>
                      <code>{mem.id.slice(0, 12)}</code>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => handleClearScope(mem.id)}
                      title="Remove scope (becomes general)"
                    >
                      <ShieldOff className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-destructive"
                      onClick={() => handleDelete(mem.id)}
                      title="Delete"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface CreateEntry {
  text: string;
  kind: string;
  roles: string[];
  taskTypes: string[];
  modes: string[];
}

function CreateAudienceMemory({
  onCreate,
  onCancel,
}: {
  onCreate: (entry: CreateEntry) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState('workflow');
  const [roles, setRoles] = useState('');
  const [taskTypes, setTaskTypes] = useState('');
  const [modes, setModes] = useState('');

  const csv = (v: string) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const canSubmit = text.trim() && (roles.trim() || taskTypes.trim() || modes.trim());

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="space-y-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Memory text…"
          autoFocus
          className="h-8 text-xs"
        />
        <div className="grid grid-cols-3 gap-2">
          <Input
            value={roles}
            onChange={(e) => setRoles(e.target.value)}
            placeholder="roles (csv)"
            className="h-7 text-xs"
          />
          <Input
            value={taskTypes}
            onChange={(e) => setTaskTypes(e.target.value)}
            placeholder="task types (csv)"
            className="h-7 text-xs"
          />
          <Input
            value={modes}
            onChange={(e) => setModes(e.target.value)}
            placeholder="modes (csv)"
            className="h-7 text-xs"
          />
        </div>
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs"
            disabled={!canSubmit}
            onClick={() =>
              onCreate({
                text: text.trim(),
                kind,
                roles: csv(roles),
                taskTypes: csv(taskTypes),
                modes: csv(modes),
              })
            }
          >
            Remember
          </Button>
        </div>
      </div>
    </div>
  );
}
