import { useUIStore } from '@/stores';
import { useAppTranslation } from '@/i18n';
import { Keyboard, X } from 'lucide-react';
import { useEffect } from 'react';

interface Shortcut {
  keys: string[];
  descKey: string;
}

const SHORTCUTS: Array<{ sectionKey: string; items: Shortcut[] }> = [
  {
    sectionKey: 'sectionGlobal',
    items: [
      { keys: ['Ctrl', 'K'], descKey: 'dCommandPalette' },
      { keys: ['?'], descKey: 'dShowOverlay' },
      { keys: ['Ctrl', '\\'], descKey: 'dToggleSidebar' },
      { keys: ['Ctrl', '1-8'], descKey: 'dOpenPanel' },
      { keys: ['Ctrl', '0'], descKey: 'dDesignStudio' },
      { keys: ['Ctrl', 'Shift', 'W'], descKey: 'dWorktrees' },
      { keys: ['Ctrl', '/'], descKey: 'dFocusInput' },
    ],
  },
  {
    sectionKey: 'sectionTuiParity',
    items: [
      { keys: ['F1'], descKey: 'dSessionPanel' },
      { keys: ['F2'], descKey: 'dFleetOverlay' },
      { keys: ['F3'], descKey: 'dAgentsOverlay' },
      { keys: ['F4'], descKey: 'dWorktreeMonitor' },
      { keys: ['F5'], descKey: 'dPlanPanel' },
      { keys: ['F6'], descKey: 'dTodosPanel' },
      { keys: ['F7'], descKey: 'dQueuePanel' },
      { keys: ['F8'], descKey: 'dProcessMonitor' },
      { keys: ['F9'], descKey: 'dGoalPanel' },
      { keys: ['F10'], descKey: 'dSessionsDashboard' },
      { keys: ['F11'], descKey: 'dOfficeMap' },
      { keys: ['F12'], descKey: 'dDockPicker' },
    ],
  },
  {
    sectionKey: 'sectionFleet',
    items: [
      { keys: ['Ctrl', 'Shift', 'M'], descKey: 'dOpenFleet' },
      { keys: ['Ctrl', 'Shift', 'A'], descKey: 'dOpenAgents' },
      { keys: ['↑', '↓'], descKey: 'dNavigateAgents' },
      { keys: ['Enter'], descKey: 'dSelectAgent' },
      { keys: ['Esc'], descKey: 'dCloseOverlay' },
    ],
  },
  {
    sectionKey: 'sectionChatInput',
    items: [
      { keys: ['Enter'], descKey: 'dSendMessage' },
      { keys: ['Shift', 'Enter'], descKey: 'dNewline' },
      { keys: ['↑'], descKey: 'dRecallPrev' },
      { keys: ['↓'], descKey: 'dRecallNext' },
      { keys: ['/'], descKey: 'dSlashPopup' },
      { keys: ['Tab'], descKey: 'dAutocomplete' },
      { keys: ['Esc'], descKey: 'dDismissPopup' },
    ],
  },
  {
    sectionKey: 'sectionChat',
    items: [
      { keys: ['Ctrl', 'F'], descKey: 'dSearchChat' },
      { keys: ['Ctrl', 'L'], descKey: 'dClearContext' },
      { keys: ['Ctrl', 'N'], descKey: 'dNewSession' },
      { keys: ['Ctrl', 'E'], descKey: 'dExportMarkdown' },
      { keys: ['Ctrl', 'M'], descKey: 'dModelSwitcher' },
      { keys: ['Ctrl', 'Shift', 'D'], descKey: 'dCompactDensity' },
      { keys: ['Esc'], descKey: 'dAbortRun' },
    ],
  },
  {
    sectionKey: 'sectionChatNav',
    items: [
      { keys: ['j'], descKey: 'dFocusNext' },
      { keys: ['k'], descKey: 'dFocusPrev' },
      { keys: ['g'], descKey: 'dJumpFirst' },
      { keys: ['Shift', 'G'], descKey: 'dJumpLast' },
      { keys: ['c'], descKey: 'dCopyFocused' },
      { keys: ['Esc'], descKey: 'dClearFocused' },
    ],
  },
];

export function ShortcutsOverlay() {
  const { t } = useAppTranslation();
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // "?" — but only when the user isn't typing in an input. Otherwise
      // typing a literal "?" into the chat would open this overlay.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      if (!isTyping && e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(!useUIStore.getState().shortcutsOpen);
        return;
      }
      if (e.key === 'Escape' && useUIStore.getState().shortcutsOpen) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl border bg-popover shadow-2xl overflow-hidden flex flex-col max-h-[80dvh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t('activity:shortcuts.heading')}</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-6">
          {SHORTCUTS.map((group) => (
            <div key={group.sectionKey}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                {t(`activity:shortcuts.${group.sectionKey}`)}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {group.items.map((s) => (
                  <div
                    key={s.descKey}
                    className="flex items-center justify-between gap-3 text-sm px-2 py-1.5 rounded hover:bg-muted/40"
                  >
                    <span className="text-foreground/80">{t(`activity:shortcuts.${s.descKey}`)}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, ki) => (
                        <span key={k} className="flex items-center gap-1">
                          {ki > 0 && <span className="text-muted-foreground/40 text-xs">+</span>}
                          <kbd className="font-mono text-[10px] border rounded px-1.5 py-0.5 bg-background">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t px-5 py-3 text-xs text-muted-foreground">
          {t('activity:shortcuts.footerPre')}{' '}
          <kbd className="font-mono text-[10px] border rounded px-1 py-0.5 bg-background">?</kbd>{' '}
          {t('activity:shortcuts.footerPost')}
        </div>
      </div>
    </div>
  );
}
