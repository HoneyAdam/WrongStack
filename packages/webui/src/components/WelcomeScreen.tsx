import { useWebSocket } from '@/hooks/useWebSocket';
import { useAppTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { getWSClient } from '@/lib/ws-client';
import { openMainView } from '@/lib/view-navigation';
import { useConfigStore, useHistoryStore, useSessionStore, useUIStore } from '@/stores';
import type { WSServerMessage } from '@/types';
import type { LucideIcon } from 'lucide-react';
import {
  ArchiveRestore,
  ArrowRight,
  Clock,
  Crosshair,
  Keyboard,
  KeyRound,
  Lightbulb,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

interface PromptCard {
  id: 'understand' | 'create' | 'investigate' | 'improve';
  icon: LucideIcon;
  title: string;
  hint: string;
  tone: string;
  /** Gradient strip color at the top of the card */
  gradient: string;
  /** Full pool of project-agnostic prompts. Only a random subset (PROMPTS_PER_CARD)
   *  is shown at a time; the Shuffle control re-samples from this pool. */
  pool: string[];
}

/** How many prompts to surface per card at once. */
const PROMPTS_PER_CARD = 3;

const CARDS: PromptCard[] = [
  {
    id: 'understand',
    icon: Search,
    title: 'Understand',
    hint: 'Explore and analyze the codebase',
    tone: 'text-info bg-info/10 border-info/20',
    gradient: 'from-info/25 via-info/10 to-transparent',
    pool: [
      'Map out the structure of this codebase: what are the main modules or components, how do they depend on each other, and what are the key patterns used throughout?',
      'Find and document the public API surface — all exported interfaces, functions, and types that other parts of the system depend on.',
      'Trace the flow of data through the system for a typical operation. Where does input validation happen? Where are side effects triggered?',
      'Give me a guided tour of this codebase as if I just joined the team — where should I start reading, and what are the handful of files I should understand first?',
      'Explain the overall architecture and the main design decisions behind it. What trade-offs were made, and why?',
      'Identify the core domain concepts and how they map to the code. What vocabulary do I need to understand this project?',
      'Where does execution begin? Trace the entry point through startup, configuration loading, and into the main loop or request handler.',
      'What external dependencies and integrations does this project rely on, and how does the code talk to each of them?',
      'How is state managed and where does it live? Walk me through the lifecycle of the most important piece of data in the system.',
      'Summarize what this project does, who it is for, and how the pieces fit together — in plain language, no jargon.',
      'Which parts of this codebase are the most complex or the hardest to change safely, and what makes them that way?',
      'Show me how a single request or command flows end to end, from the outer boundary down to where the real work happens.',
    ],
  },
  {
    id: 'create',
    icon: Lightbulb,
    title: 'Create',
    hint: 'Build new features and functionality',
    tone: 'text-success bg-success/10 border-success/20',
    gradient: 'from-success/25 via-success/10 to-transparent',
    pool: [
      'Add a new feature that covers the full stack: data model, business logic, and any UI or API layers. Follow existing patterns in this codebase.',
      'Write comprehensive tests for a module with low coverage. Include happy paths, edge cases, and error scenarios.',
      'Add observability to a critical path — structured logging, error tracking, or metrics that help diagnose issues in production.',
      'Scaffold a new module following the existing conventions — same structure, naming, and patterns as the rest of the codebase.',
      'Add input validation and clear error messages to a user-facing entry point that currently trusts its inputs.',
      'Write documentation for a part of the code that lacks it — usage examples, edge cases, and the gotchas worth warning about.',
      'Take a value that is currently hardcoded and turn it into a proper configuration option, wired through cleanly with a sensible default.',
      'Build a small CLI or script that automates a repetitive task in this project.',
      'Create an integration test that exercises a real end-to-end path instead of mocking everything away.',
      "Add a health check or self-diagnostic that reports whether the system's dependencies are reachable and configured correctly.",
      'Introduce a feature-flag mechanism so new behavior can be rolled out gradually and switched off without a redeploy.',
      'Add pagination, filtering, or sorting to a data-listing path that currently returns everything at once.',
    ],
  },
  {
    id: 'investigate',
    icon: Crosshair,
    title: 'Investigate',
    hint: 'Debug issues and find root causes',
    tone: 'text-warning bg-warning/10 border-warning/20',
    gradient: 'from-warning/25 via-warning/10 to-transparent',
    pool: [
      "Something isn't working as expected — help me trace from the symptom to the root cause. Follow the code path and identify where behavior diverges from intent.",
      "There's a difference between how this works locally versus in production or CI. Check for environment differences, configuration issues, or hidden assumptions.",
      'Performance is degrading. Identify the bottlenecks — whether N+1 queries, blocking I/O, unnecessary allocations, or something else — and propose targeted fixes.',
      'Help me reproduce an intermittent bug: what timing, ordering, or conditions could make it flaky, and how do I make it deterministic?',
      'This code throws or misbehaves under some inputs. Find the exact conditions that trigger it and explain why they do.',
      'Memory or resource usage keeps growing over time. Look for leaks — unclosed handles, unbounded caches, or retained references.',
      'A recent change broke something. Help me narrow down what introduced the regression and why it slipped through.',
      'Two parts of the system disagree about the same data. Find where they diverge and determine which one is actually wrong.',
      'Add targeted logging or assertions to narrow down where this bug really happens, then help me interpret the output.',
      "This test is failing or flaky. Figure out whether it's the test that's wrong or the code it's checking.",
      'Walk a confusing edge case through the code and tell me whether the resulting behavior is a genuine bug or intended.',
      'I suspect a race condition or ordering issue. Look for shared state that\'s read or written without proper coordination.',
    ],
  },
  {
    id: 'improve',
    icon: Sparkles,
    title: 'Improve',
    hint: 'Refactor and optimize existing code',
    tone: 'text-primary bg-primary/10 border-primary/20',
    gradient: 'from-primary/20 via-primary/8 to-transparent',
    pool: [
      'Find duplicated or similar logic that could be consolidated into shared utilities. Extract the common parts and update the call sites.',
      'Identify modules that have grown too large or handle too many responsibilities. Propose a cleaner separation that can be done incrementally.',
      'Review error handling across the codebase: are errors consistent, well-contextualized, and properly propagated? Suggest improvements to the worst cases.',
      'Reduce complexity in the most tangled function you can find — simplify the control flow without changing its behavior.',
      'Improve the naming and readability of a confusing area so the next person understands it faster.',
      'Find and remove dead code, unused exports, and obsolete branches that no longer serve a purpose.',
      'Tighten up the types (or add types) in a loosely-typed area so more bugs are caught at compile time instead of at runtime.',
      'Optimize a hot path for speed or memory — but measure before and after so the win is real, not assumed.',
      'Replace a fragile pattern — magic numbers, stringly-typed values, deep nesting — with something safer and clearer.',
      'Improve test quality: hunt down weak assertions, over-mocking, and tests that pass without really verifying anything.',
      'Make an inconsistent API consistent — align naming, argument order, and return shapes across similar functions.',
      'Harden the code against invalid states — make illegal states unrepresentable wherever the design allows it.',
    ],
  },
];

/** Pick `n` distinct random items from `pool` (Fisher–Yates on a copy). */
function sampleN<T>(pool: readonly T[], n: number): T[] {
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

/** Sample a fresh subset of prompts for every card. */
function shuffleAllCards(): Record<PromptCard['id'], string[]> {
  const out = {} as Record<PromptCard['id'], string[]>;
  for (const card of CARDS) out[card.id] = sampleN(card.pool, PROMPTS_PER_CARD);
  return out;
}

const SLASH_REFS: Array<{ id: string; name: string; hint: string }> = [
  { id: 'help', name: '/help', hint: 'list every slash command' },
  { id: 'diag', name: '/diag', hint: 'runtime diagnostics' },
  { id: 'stats', name: '/stats', hint: 'tokens · cache · cost · elapsed' },
  { id: 'tools', name: '/tools', hint: 'show registered tools' },
  { id: 'memory', name: '/memory', hint: 'show remembered notes' },
  { id: 'compact', name: '/compact', hint: 'shrink context' },
  { id: 'clear', name: '/clear', hint: 'wipe current context' },
  { id: 'new', name: '/new', hint: 'fresh session' },
];

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

export function WelcomeScreen() {
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
  const [visiblePrompts, setVisiblePrompts] = useState<Record<PromptCard['id'], string[]>>(
    shuffleAllCards,
  );
  const shufflePrompts = useCallback(() => setVisiblePrompts(shuffleAllCards()), []);

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
              <p className="truncate text-[11px] text-muted-foreground/60 font-mono" title={cwd}>
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
            {CARDS.map((card, ci) => {
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
                          <span className="text-[10px] font-mono text-muted-foreground/50 tabular-nums">
                            {entry.tokenTotal.toLocaleString()} tok
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight
                      className={cn(
                        'h-3 w-3 shrink-0 text-muted-foreground/30',
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
