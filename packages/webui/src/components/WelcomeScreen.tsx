import { useWebSocket } from '@/hooks/useWebSocket';
import { useAppTranslation } from '@/i18n';
import {
  DEFAULT_PROMPT_CARDS,
  type PromptCard,
  shuffleAllCards,
  SLASH_REFS,
} from '@/lib/default-prompt-pools';
import { cn } from '@/lib/utils';
import { getWSClient } from '@/lib/ws-client';
import { openMainView } from '@/lib/view-navigation';
import { useConfigStore, useHistoryStore, useSessionStore, useUIStore } from '@/stores';
import type { WSServerMessage } from '@/types';
import {
  ArchiveRestore,
  ArrowRight,
  Clock,
  Keyboard,
  KeyRound,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

/** Compact one-paragraph preview of a stored prompt. Pasted prompts can be
 *  multi-KB markdown (code fences, `----` rules, long unbroken paths) which
 *  would blow up the card layout if rendered raw — collapse all whitespace
 *  and hard-cap the length; the click handler still fills the FULL text. */
function promptPreview(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function fillTextarea(text: string): void {
  const ta = document.querySelector('textarea');
  if (!ta) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

interface WelcomeScreenProps {
  /** Override the default prompt cards with project-specific ones.
   *  Each card's `pool` is sampled randomly on mount and on Shuffle. */
  promptCards?: PromptCard[];
}

export function WelcomeScreen({ promptCards = DEFAULT_PROMPT_CARDS }: WelcomeScreenProps) {
  const { t } = useAppTranslation();
  const { projectName, cwd } = useSessionStore(
    useShallow((s) => ({ projectName: s.projectName, cwd: s.cwd })),
  );
  const { provider, model } = useConfigStore(
    useShallow((s) => ({ provider: s.provider, model: s.model })),
  );
  const wsConnected = useConfigStore((s) => s.wsConnected);
  const wsUrl = useConfigStore((s) => s.wsUrl);
  /** Saved-provider count. We subscribe directly to `providers.saved`
   *  because SettingsPanel is the canonical owner of that state but isn't
   *  always mounted (only when the user is on the Settings tab). undefined
   *  means "not yet fetched" — we skip the CTA in that state to avoid a
   *  flash on first paint. */
  const [savedCount, setSavedCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!wsConnected) return;
    const client = getWSClient(wsUrl);
    const off = client.on('providers.saved', (msg: WSServerMessage) => {
      const p = msg.payload as { providers: unknown[] };
      setSavedCount(p.providers?.length ?? 0);
    });
    client.listSavedProviders();
    return () => {
      off();
    };
  }, [wsConnected, wsUrl]);
  /** Recent prompts harvested from the user's typing history. The same
   *  store that powers ↑/↓ recall in the input — surfacing them here turns
   *  a blank welcome screen into a useful "pick up where you left off"
   *  surface, without any backend round-trip. Limited to 6 so it doesn't
   *  dominate the page. */
  const promptHistory = useUIStore((s) => s.promptHistory);
  // Filter slash commands BEFORE slicing so they don't eat visible slots.
  const recentPrompts = promptHistory.filter((p) => !p.trim().startsWith('/')).slice(0, 5);
  /** Recent sessions surfaced as one-click resume buttons. Drives the
   *  "pick back up" workflow without sending the user to the History tab.
   *  We fetch on first paint when connected; the listing is otherwise
   *  populated by the History tab on demand. */
  const { listSessions, resumeSession } = useWebSocket();
  const historyEntries = useHistoryStore((s) => s.entries);
  useEffect(() => {
    if (wsConnected && historyEntries.length === 0) listSessions(10);
    // Intentionally only fire on first connect — refreshing on every
    // historyEntries change would loop after the response lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected]);
  const sessionNicknames = useUIStore((s) => s.sessionNicknames);
  const recentSessions = historyEntries.filter((e) => !e.isCurrent).slice(0, 4);

  /** Which prompts are currently visible per card. Re-sampled from each
   *  card's pool on first paint and every time the user hits Shuffle, so
   *  the starting prompts stay fresh instead of always showing the same
   *  three. Lazy initializer runs the shuffle once on mount. */
  const [visiblePrompts, setVisiblePrompts] = useState<Record<string, string[]>>(
    () => shuffleAllCards(promptCards),
  );
  const shufflePrompts = useCallback(() => setVisiblePrompts(shuffleAllCards(promptCards)), [promptCards]);

  return (
    <div className="flex flex-col gap-5 py-5 sm:py-7 max-w-6xl mx-auto w-full">
      {/* ── Session start panel ── */}
      <div className="ws-surface relative overflow-hidden rounded-xl p-5 sm:p-6">
        {/* Decorative gradient blob — subtle visual depth */}
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-gradient-to-br from-primary/8 via-primary/5 to-transparent blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-gradient-to-tr from-accent/8 to-transparent blur-3xl pointer-events-none" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex shrink-0 items-center justify-center shadow-sm shadow-primary/30">
              <Zap className="h-7 w-7 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight">
                {projectName
                  ? t('setup:welcome.heroTitleInProject', { name: projectName })
                  : t('setup:welcome.heroTitle')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {t('setup:welcome.heroSubtitle')}
              </p>
            </div>
          </div>
          <div className="grid min-w-0 gap-1 text-left sm:text-right">
            {provider && model && (
              <p className="truncate text-xs text-muted-foreground/80 font-mono">
                {provider} / {model}
              </p>
            )}
            {cwd && (
              <p className="truncate text-[11px] text-muted-foreground/75 font-mono" title={cwd}>
                {t('setup:welcome.workingDirectory', { cwd })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── No-keys CTA ── */}
      {wsConnected && savedCount === 0 && (
        <button
          type="button"
          onClick={() => openMainView('settings')}
          className={cn(
            'group rounded-xl border bg-gradient-to-r from-warning/5 to-warning/[0.02]',
            'border-warning/30 hover:border-warning/50 transition-all duration-200 shadow-sm',
            'p-5 flex items-center gap-4 text-left animate-message',
          )}
        >
          <span className="flex items-center justify-center w-11 h-11 rounded-lg bg-gradient-to-br from-warning/20 to-warning/10 text-warning shrink-0 shadow-sm shadow-warning/10">
            <KeyRound className="h-6 w-6" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold mb-1">{t('setup:welcome.noKeyTitle')}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('setup:welcome.noKeyBody')}
            </p>
          </div>
          <span className="flex items-center gap-1 text-xs text-warning font-medium shrink-0 group-hover:translate-x-0.5 transition-transform">
            {t('setup:welcome.openSettings')} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </button>
      )}

      {/* ── Main grid: prompts (left) | sidebar (right) ── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ========== LEFT: Starting Prompts ========== */}
        <section className="min-w-0 flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {t('setup:welcome.startingPrompts')}
            </span>
            <button
              type="button"
              onClick={shufflePrompts}
              className="group/shuffle flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-accent/50 transition-all duration-200"
              title={t('setup:welcome.shufflePromptsHint')}
            >
              <RefreshCw className="h-3.5 w-3.5 transition-transform duration-500 group-hover/shuffle:rotate-180" />
              {t('setup:welcome.shufflePrompts')}
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 max-h-[calc(100dvh-17rem)] lg:max-h-none overflow-y-auto">
            {promptCards.map((card, ci) => {
            const Icon = card.icon;
            return (
              <div
                key={card.id}
                className={cn(
                  'group/card rounded-xl border border-border/70 bg-card/80 flex flex-col overflow-hidden',
                  'hover:border-primary/30 hover:shadow-md hover:shadow-primary/5',
                  'transition-all duration-300 animate-message',
                )}
                style={{ animationDelay: `${ci * 100}ms` }}
              >
                {/* Colored gradient accent strip */}
                <div className={cn('h-1.5 bg-gradient-to-r shrink-0', card.gradient)} />

                <div className="p-4 pb-2 flex flex-col gap-3">
                  {/* Card header */}
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'flex items-center justify-center w-9 h-9 rounded-lg border shadow-sm',
                        'bg-background/60 transition-shadow duration-300',
                        'group-hover/card:shadow-md',
                        card.tone,
                      )}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">
                        {t(`setup:welcome.card.${card.id}.title`)}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        {t(`setup:welcome.card.${card.id}.hint`)}
                      </p>
                    </div>
                  </div>

                  {/* Prompt items */}
                  <div className="flex flex-col gap-1">
                    {(visiblePrompts[card.id] ?? []).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => fillTextarea(p)}
                        className={cn(
                          'group/prompt text-left text-xs leading-relaxed',
                          'text-muted-foreground/90 hover:text-foreground',
                          'border border-transparent hover:border-border/60',
                          'rounded-lg px-3 py-2.5 hover:bg-muted/45',
                          'transition-all duration-200 flex items-start gap-2',
                        )}
                        title={p}
                      >
                        <span className="flex-1 min-w-0 line-clamp-2">
                          {promptPreview(p, 180)}
                        </span>
                        <ArrowRight
                          className={cn(
                            'h-3 w-3 mt-0.5 shrink-0',
                            'opacity-0 -translate-x-1',
                            'group-hover/prompt:opacity-100 group-hover/prompt:translate-x-0',
                            'transition-all duration-200 text-muted-foreground',
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        </section>

        {/* ========== RIGHT: Sidebar ========== */}
        <aside className="min-w-0 flex flex-col gap-3">

          {/* ─── Pick Back Up (recent sessions) ─── */}
          {recentSessions.length > 0 && (
            <div
              className="rounded-xl border border-border/70 bg-card/70 p-4 animate-message"
              style={{ animationDelay: '200ms' }}
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <ArchiveRestore className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  {t('setup:welcome.pickBackUp')}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {recentSessions.map((entry, i) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => resumeSession(entry.id)}
                    className={cn(
                      'group/sess flex items-center gap-3',
                      'rounded-lg border border-border/50 bg-background/50',
                      'hover:border-primary/30 hover:bg-accent/30',
                      'px-3 py-2.5 transition-all duration-200 text-left animate-message',
                    )}
                    style={{ animationDelay: `${250 + i * 80}ms` }}
                    title={promptPreview(entry.title ?? '', 300)}
                  >
                    {/* Timeline indicator dot */}
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full shrink-0',
                        'bg-primary/40 group-hover/sess:bg-primary transition-colors duration-200',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate text-foreground/90 group-hover/sess:text-primary transition-colors">
                        {sessionNicknames[entry.id] || entry.title || t('setup:welcome.empty')}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
                          {entry.provider}/{entry.model}
                        </span>
                        {entry.tokenTotal > 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">
                            {entry.tokenTotal.toLocaleString()} tok
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight
                      className={cn(
                        'h-3 w-3 shrink-0 text-muted-foreground/60',
                        'group-hover/sess:text-primary/50 group-hover/sess:translate-x-0.5',
                        'transition-all duration-200',
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── Recent Prompts ─── */}
          {recentPrompts.length > 0 && (
            <div
              className="rounded-xl border border-border/70 bg-card/70 p-4 animate-message"
              style={{ animationDelay: '300ms' }}
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-7 h-7 rounded-md bg-warning/10 text-warning flex items-center justify-center shrink-0">
                  <Clock className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  {t('setup:welcome.recentPrompts')}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentPrompts.map((p, i) => (
                  <button
                    key={`${p}-${i}`}
                    type="button"
                    onClick={() => fillTextarea(p)}
                    className={cn(
                      'group/chip text-left',
                      'rounded-lg border border-border/40 bg-background/40',
                      'hover:bg-accent/25 hover:border-accent/50',
                      'px-2.5 py-1.5 transition-all duration-200 max-w-full animate-message',
                    )}
                    style={{ animationDelay: `${350 + i * 60}ms` }}
                    title={promptPreview(p, 500)}
                  >
                    <span className="text-xs text-muted-foreground/90 group-hover/chip:text-foreground line-clamp-1 break-all">
                      {promptPreview(p, 60)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── Quick Commands (slash references) ─── */}
          <div
            className="rounded-xl border border-border/70 bg-card/70 p-4 animate-message"
            style={{ animationDelay: '400ms' }}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-7 h-7 rounded-md bg-success/10 text-success flex items-center justify-center shrink-0">
                <Keyboard className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                {t('setup:welcome.quickCommands')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SLASH_REFS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => fillTextarea(c.name)}
                  className={cn(
                    'group/cmd flex items-center gap-2',
                    'rounded-lg border border-border/40 bg-background/40',
                    'hover:bg-accent/20 hover:border-accent/40',
                    'px-2.5 py-2 transition-all duration-200 min-w-0',
                  )}
                >
                  <kbd className="text-[11px] font-mono font-semibold text-foreground/80 group-hover/cmd:text-primary transition-colors bg-muted/50 px-1.5 py-0.5 rounded shrink-0 leading-none">
                    {c.name}
                  </kbd>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {t(`setup:welcome.slashRef.${c.id}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

        </aside>
      </div>
    </div>
  );
}
