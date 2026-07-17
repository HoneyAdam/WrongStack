import { FileEdit, Minus, Plus } from 'lucide-react';
import type { FileEditMeta } from './types.js';

interface FileChangesButtonProps {
  fileCount: number;
  totalAdded: number;
  totalRemoved: number;
  /** All file edits to open in the diff panel. */
  files: FileEditMeta[];
  onOpenDiff: (files: FileEditMeta[]) => void;
}

/** Floating badge that appears when file edits exist — shows aggregate
 *  added/removed line counts and the number of changed files. Clicking
 *  opens the diff panel with all collected edits. */
export function FileChangesButton({
  fileCount,
  totalAdded,
  totalRemoved,
  files,
  onOpenDiff,
}: FileChangesButtonProps) {
  if (fileCount === 0) return null;

  return (
    <button
      type="button"
      className="file-changes-button"
      aria-label={`${fileCount} file${fileCount !== 1 ? 's' : ''} changed, +${totalAdded} −${totalRemoved}`}
      title={`${fileCount} file${fileCount !== 1 ? 's' : ''} changed\n+${totalAdded} added  −${totalRemoved} removed\nClick to view diffs`}
      onClick={() => onOpenDiff(files)}
    >
      <FileEdit size={13} aria-hidden="true" />
      <span className="file-changes-count">{fileCount}</span>
      <span className="file-changes-added">
        <Plus size={10} aria-hidden="true" />
        {totalAdded}
      </span>
      <span className="file-changes-removed">
        <Minus size={10} aria-hidden="true" />
        {totalRemoved}
      </span>
    </button>
  );
}
