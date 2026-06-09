import { cn } from '@/lib/utils';
import { useFileStore } from '@/stores/file-store';
import type { TreeNode } from '@/stores/file-store';
import {
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import { useCallback, useState } from 'react';

// ── File icon by extension ────────────────────────────────────────────

const EXT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  json: FileJson,
  css: FileText,
  html: FileType,
  svg: FileType,
  md: FileText,
  yml: FileText,
  yaml: FileText,
  toml: FileText,
  lock: FileJson,
};

function fileIcon(name: string): React.ComponentType<{ className?: string }> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICONS[ext] ?? File;
}

// ── Tree node ──────────────────────────────────────────────────────────

function TreeNodeItem({
  node,
  depth,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (filePath: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1); // auto-expand root level
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const isActive = node.type === 'file' && node.path === activeFilePath;

  if (node.type === 'directory') {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const DirIcon = expanded ? FolderOpen : Folder;
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'flex items-center gap-1 w-full text-left px-1 py-0.5 text-[11px] rounded',
            'hover:bg-muted/60 transition-colors',
          )}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <DirIcon className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {expanded && hasChildren && (
          <div>
            {node.children!.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
        {expanded && !hasChildren && (
          <div
            className="text-[10px] text-muted-foreground italic py-0.5"
            style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }}
          >
            empty
          </div>
        )}
      </div>
    );
  }

  // Leaf node (file)
  const Icon = fileIcon(node.name);
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={cn(
        'flex items-center gap-1.5 w-full text-left px-1 py-0.5 text-[11px] rounded',
        'hover:bg-muted/60 transition-colors',
        isActive && 'bg-primary/10 text-primary',
      )}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
    >
      <span className="w-3 shrink-0" /> {/* spacer to align with chevron */}
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ── File explorer panel ────────────────────────────────────────────────

export function FileExplorer() {
  const tree = useFileStore((s) => s.tree);
  const treeLoading = useFileStore((s) => s.treeLoading);
  const error = useFileStore((s) => s.error);
  const openFiles = useFileStore((s) => s.openFiles);

  // Gets called when a file is clicked in the tree
  const handleSelect = useCallback(
    (filePath: string) => {
      // Check if already open — just switch to it
      const existing = openFiles.find((f) => f.path === filePath);
      if (existing) {
        useFileStore.getState().setActiveFile(filePath);
        return;
      }
      // Request file content from the WS server. The ws-handlers hook
      // listens for 'files.read' responses and calls openFile().
      // We fire a custom event that the hook in App.tsx will pick up.
      window.dispatchEvent(
        new CustomEvent('wrongstack:open-file', { detail: { filePath } }),
      );
    },
    [openFiles],
  );

  if (treeLoading) {
    return (
      <div className="flex items-center justify-center h-full py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-[11px] text-destructive">
        Failed to load files: {error}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-1">
      {tree.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          onSelect={handleSelect}
        />
      ))}
      {tree.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic p-2">
          No files found
        </p>
      )}
    </div>
  );
}
