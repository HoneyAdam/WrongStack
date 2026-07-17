import { FileText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FileEditMeta } from './types.js';

interface FileDiffPanelProps {
  /** The file edits to show — when multiple, the left list lets you switch. */
  files: FileEditMeta[];
  /** Index of the initial file to display, defaults to 0. */
  initialIndex?: number | undefined;
  onClose: () => void;
}

function diffLines(diff: string): { kind: 'add' | 'remove' | 'context'; text: string }[] {
  const start = diff.indexOf('@@');
  if (start === -1) return [{ kind: 'context', text: diff }];
  const lines: { kind: 'add' | 'remove' | 'context'; text: string }[] = [];
  for (const line of diff.slice(start).split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) lines.push({ kind: 'add', text: line });
    else if (line.startsWith('-') && !line.startsWith('---')) lines.push({ kind: 'remove', text: line });
    else lines.push({ kind: 'context', text: line });
  }
  return lines;
}

export function FileDiffPanel({ files, initialIndex = 0, onClose }: FileDiffPanelProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const activeFile = files[activeIndex];
  const parsed = activeFile?.diff ? diffLines(activeFile.diff) : [];

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        className="diff-overlay"
        aria-label="Close diff panel"
        tabIndex={-1}
        onClick={onClose}
      />
      <aside className="diff-panel" role="dialog" aria-modal="true" aria-label="File diff">
        <header className="diff-head">
          <span>
            <FileText size={13} aria-hidden="true" /> FILE DIFF
          </span>
          <button type="button" onClick={onClose} aria-label="Close diff panel" ref={closeRef}>
            <X size={14} />
          </button>
        </header>
        <div className="diff-body">
          {files.length > 1 && (
            <nav className="diff-file-list" aria-label="Changed files">
              {files.map((file, index) => (
                <button
                  type="button"
                  key={file.path}
                  className={`diff-file-item${activeIndex === index ? ' active' : ''}`}
                  onClick={() => setActiveIndex(index)}
                >
                  <FileText size={12} aria-hidden="true" />
                  <span>{file.path.split(/[\\/]/).pop() ?? file.path}</span>
                  {file.replacements != null && (
                    <b className="diff-stat-green">+{file.replacements}</b>
                  )}
                </button>
              ))}
            </nav>
          )}
          <div className="diff-view">
            {activeFile ? (
              <>
                <div className="diff-view-head">
                  <code>{activeFile.path}</code>
                  <span>
                    {activeFile.replacements != null && (
                      <b className="diff-stat-green">+{activeFile.replacements}</b>
                    )}
                    {activeFile.bytesWritten != null && (
                      <span className="diff-stat-muted">{activeFile.bytesWritten} bytes</span>
                    )}
                    {activeFile.created && <span className="diff-stat-green">created</span>}
                  </span>
                </div>
                <pre className="diff-view-content">
                  {parsed.map((line, i) => (
                    <span key={i} className={`diff-line diff-line-${line.kind}`}>
                      {line.text}{'\n'}
                    </span>
                  ))}
                </pre>
              </>
            ) : (
              <div className="diff-view-empty">Select a file to view its diff.</div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
