import { cn } from '@/lib/utils';
import { getWSClient } from '@/lib/ws-client';
import { Folder, History, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface ProjectEntry {
  name: string;
  root: string;
  slug: string;
  lastSeen?: string | undefined;
}

/**
 * Projects panel — reads from ~/.wrongstack/projects.json via the backend.
 * Shows all known projects with names, paths, and last-seen times.
 * Designed to be embedded in the Settings panel as a subsection.
 */
export function ProjectsPanel() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const ws = getWSClient();
    const off = ws.on('projects.list', (msg) => {
      const p = msg.payload as { projects: ProjectEntry[] };
      setProjects(p.projects ?? []);
      setLoading(false);
    });
    ws.send({ type: 'projects.list' });
    return () => off();
  }, []);

  const fmtLastSeen = (iso?: string | undefined): string => {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        No projects registered. Run <code className="font-mono bg-muted/40 px-1 rounded">wstack</code> in a directory to register it.
      </div>
    );
  }

  // Sort by lastSeen descending
  const sorted = [...projects].sort((a, b) => {
    if (a.lastSeen && b.lastSeen) return b.lastSeen.localeCompare(a.lastSeen);
    if (a.lastSeen) return -1;
    if (b.lastSeen) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-1">
      {sorted.map((p) => (
        <div
          key={p.slug}
          className="flex items-start gap-2 px-2 py-1.5 rounded border bg-card/40 text-xs"
        >
          <Folder className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{p.name}</div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {p.root}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/60">
              <span className="font-mono">{p.slug}</span>
              {p.lastSeen && (
                <span className="flex items-center gap-1">
                  <History className="h-2.5 w-2.5" />
                  {fmtLastSeen(p.lastSeen)}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
