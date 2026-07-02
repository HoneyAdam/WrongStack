/**
 * ChangesView — the main-pane diff surface for the Changes (source-control)
 * activity. The file list lives in the SidePanel (ChangesPanel); selecting a
 * row populates the git-changes store, and this view renders the resolved
 * before/after content through the shared DiffView.
 */

import { Columns2, FileDiff, Loader2, Rows3 } from 'lucide-react';
import { useState } from 'react';
import { useAppTranslation } from '@/i18n';
import { useGitChangesStore } from '@/stores';
import { cn } from '@/lib/utils';
import { DiffView } from './DiffView';
import { MonacoDiffView } from './MonacoDiffView';

export function ChangesView({ className }: { className?: string }) {
  const { t } = useAppTranslation();
  const selectedPath = useGitChangesStore((s) => s.selectedPath);
  const diff = useGitChangesStore((s) => s.diff);
  const loadingDiff = useGitChangesStore((s) => s.loadingDiff);
  // Unified = lightweight read-only LCS diff; Edit = Monaco side-by-side with
  // an editable working-tree pane that can be applied back to disk.
  const [mode, setMode] = useState<'unified' | 'edit'>('unified');

  if (!selectedPath) {
    return (
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground', className)}>
        <FileDiff className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t('activity:changes.selectPrompt')}</p>
      </div>
    );
  }

  const canEdit = diff && !diff.error && !diff.binary && !diff.tooLarge;

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3', className)}>
      {canEdit && (
        <div className="flex items-center justify-end gap-1 pb-2">
          <button
            type="button"
            onClick={() => setMode('unified')}
            title={t('activity:changes.unifiedTitle')}
            className={cn(
              'inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs transition-colors',
              mode === 'unified' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            <Rows3 className="h-3.5 w-3.5" /> {t('activity:changes.unified')}
          </button>
          <button
            type="button"
            onClick={() => setMode('edit')}
            title={t('activity:changes.editTitle')}
            className={cn(
              'inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs transition-colors',
              mode === 'edit' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            <Columns2 className="h-3.5 w-3.5" /> {t('activity:changes.edit')}
          </button>
        </div>
      )}
      {loadingDiff || !diff ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('activity:changes.loadingDiff')}
        </div>
      ) : diff.error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-rose-500">
          {diff.error}
        </div>
      ) : diff.binary ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('activity:changes.binary')}
        </div>
      ) : diff.tooLarge ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('activity:changes.tooLarge')}
        </div>
      ) : mode === 'edit' ? (
        <MonacoDiffView key={diff.path} path={diff.path} oldText={diff.oldText ?? ''} newText={diff.newText ?? ''} />
      ) : (
        <DiffView oldText={diff.oldText} newText={diff.newText} caption={diff.path} fill />
      )}
    </div>
  );
}
