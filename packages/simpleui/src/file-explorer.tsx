import { ChevronDown, ChevronRight, File, Folder, FolderOpen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SimpleSocket } from './lib/ws.js';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface FileExplorerProps {
  socketRef: React.RefObject<SimpleSocket | null>;
}

function FileTreeNode({
  node,
  depth,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.isDirectory && node.children && node.children.length > 0;

  return (
    <>
      <button
        type="button"
        className="file-tree-node"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          if (node.isDirectory) setExpanded((v) => !v);
          else onSelect(node.path);
        }}
      >
        {node.isDirectory ? (
          hasChildren ? (
            expanded ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />
          ) : (
            <span style={{ width: 11 }} />
          )
        ) : (
          <span style={{ width: 11 }} />
        )}
        {node.isDirectory ? (
          expanded ? <FolderOpen size={12} aria-hidden="true" /> : <Folder size={12} aria-hidden="true" />
        ) : (
          <File size={12} aria-hidden="true" />
        )}
        <span>{node.name}</span>
      </button>
      {expanded && hasChildren && node.children?.map((child) => (
        <FileTreeNode key={child.path} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </>
  );
}

export function FileExplorer({ socketRef }: FileExplorerProps) {
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const loadTree = () => {
    setLoading(true);
    const socket = socketRef.current;
    if (!socket) { setLoading(false); return; }

    const handler = (msg: { type: string; payload?: unknown }) => {
      if (msg.type !== 'files.tree') return;
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (Array.isArray(payload?.['tree'])) {
        setTree(payload['tree'] as FileNode[]);
      }
      setLoading(false);
    };

    const unsub = socket.onMessage(handler);
    socket.send('files.tree', {});
    setTimeout(() => { unsub(); if (loading) setLoading(false); }, 5000);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="file-explorer-trigger"
        aria-label="Open file explorer"
        title="Project file tree"
        onClick={() => { setOpen(true); if (!tree) loadTree(); }}
      >
        <Folder size={13} aria-hidden="true" />
      </button>
    );
  }

  return (
    <>
      <button type="button" className="settings-overlay" tabIndex={-1} onClick={() => setOpen(false)} />
      <aside className="file-explorer" role="dialog" aria-modal="true" aria-label="File explorer">
        <header className="file-explorer-head">
          <span><Folder size={13} aria-hidden="true" /> FILES</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" ref={closeRef}>
            <X size={14} />
          </button>
        </header>
        <div className="file-explorer-body">
          {loading && <p className="file-explorer-empty">Loading…</p>}
          {!loading && !tree && <p className="file-explorer-empty">Failed to load file tree.</p>}
          {tree && tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              onSelect={(path) => {
                // Copy path to clipboard and reference in composer
                copyToClipboard(path);
              }}
            />
          ))}
        </div>
      </aside>
    </>
  );
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch { /* best-effort */ }
}
