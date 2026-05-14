import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore, useSessionStore, useUIStore } from '@/stores';
import { ScrollArea } from './ui/scroll-area';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { ToolGroup } from './ToolGroup';
import { WelcomeScreen } from './WelcomeScreen';
import { SearchOverlay } from './SearchOverlay';
import { ModePicker } from './ModePicker';
import type { ChatMessage } from '@/stores';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import {
  Wifi,
  WifiOff,
  Settings,
  Cpu,
  FolderOpen,
  Activity,
  Bot,
  ArrowDown,
  Sun,
  Moon,
  Monitor,
  Command,
} from 'lucide-react';
import { useConfigStore } from '@/stores';

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function ChatView() {
  const { messages, isLoading } = useChatStore();
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const setTheme = useConfigStore((s) => s.setTheme);
  const theme = useConfigStore((s) => s.theme);
  const {
    totalTokens,
    cost,
    startTime,
    lastInputTokens,
    maxContext,
    projectName,
    iteration,
    mode,
  } = useSessionStore();
  const { wsConnected, provider, model } = useConfigStore();
  const { setCurrentView } = useUIStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Context window usage (mirrors TUI's ContextChip semantics: lastInputTokens
  // is the most recent provider call's input size — the de-facto live context).
  const ctxPct =
    maxContext > 0 && lastInputTokens > 0
      ? Math.min(100, Math.round((lastInputTokens / maxContext) * 100))
      : 0;
  const ctxTone =
    ctxPct >= 85 ? 'bg-red-500/15 text-red-600 dark:text-red-400'
    : ctxPct >= 70 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    : 'bg-muted text-muted-foreground';

  // Auto-scroll with "user is reading older messages" lock. We watch the
  // Radix ScrollArea viewport's scroll position; if the user is within
  // ~120px of the bottom we keep pinning new messages to the bottom. The
  // moment they scroll up, we let go — new content appends invisibly and a
  // floating "↓ new messages" button shows up so they can rejoin the live
  // tail when they're ready.
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const lastSeenCount = useRef(messages.length);

  // Resolve the actual scrollable viewport that Radix renders inside the
  // ScrollArea root. We re-resolve every render because the ref points at
  // the root, not the viewport.
  const getViewport = useCallback((): HTMLElement | null => {
    return scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') ?? null;
  }, []);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;
    const onScroll = () => {
      const dist = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const nowPinned = dist < 120;
      setPinnedToBottom(nowPinned);
      if (nowPinned) {
        setUnreadCount(0);
        lastSeenCount.current = messages.length;
      }
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [getViewport, messages.length]);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;
    if (pinnedToBottom) {
      viewport.scrollTop = viewport.scrollHeight;
      lastSeenCount.current = messages.length;
    } else {
      const delta = messages.length - lastSeenCount.current;
      if (delta > 0) setUnreadCount(delta);
    }
  }, [messages, pinnedToBottom, getViewport]);

  const scrollToBottom = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
    setPinnedToBottom(true);
    setUnreadCount(0);
    lastSeenCount.current = messages.length;
  }, [getViewport, messages.length]);

  // Live "agent is busy" indicator. We track when the current run started
  // (rising edge of isLoading) and tick a second-resolution clock so the
  // running-status bubble shows a live elapsed timer. Reset on idle.
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    if (isLoading && runStartedAt === null) setRunStartedAt(Date.now());
    if (!isLoading && runStartedAt !== null) setRunStartedAt(null);
  }, [isLoading, runStartedAt]);
  useEffect(() => {
    if (!isLoading) return;
    const t = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(t);
  }, [isLoading]);

  const formatDuration = (start: number | null) => {
    if (!start) return '--';
    const seconds = Math.floor((Date.now() - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header — TUI-style status bar */}
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h1 className="text-base font-semibold tracking-tight shrink-0">WrongStack</h1>
          <div className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium shrink-0',
            wsConnected
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
          )}>
            {wsConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            <span>{wsConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          {/* Agent state chip — mirrors TUI's idle/thinking/streaming labels.
              `streaming` whenever an assistant message is mid-stream, else
              `thinking` while we're waiting between turns, else `idle`. */}
          {(() => {
            const last = messages[messages.length - 1];
            const isStreaming =
              isLoading && last?.role === 'assistant' && !!last.content && last.streaming;
            const state = !isLoading
              ? 'idle'
              : isStreaming
                ? 'streaming'
                : 'thinking';
            const tone =
              state === 'idle'
                ? 'bg-muted text-muted-foreground'
                : state === 'streaming'
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
            return (
              <span
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 tabular-nums',
                  tone,
                )}
                title="Agent state"
              >
                {state !== 'idle' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                )}
                <span>{state}</span>
              </span>
            );
          })()}
          {/* Project name (cwd basename) */}
          {projectName && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
              title="Project directory"
            >
              <FolderOpen className="h-3 w-3" />
              <span className="truncate max-w-[14rem]">{projectName}</span>
            </span>
          )}
          {/* Model chip — clicking opens the full settings panel (model picker tab). */}
          <button
            type="button"
            onClick={() => setCurrentView('settings')}
            className="group flex items-center gap-1.5 px-2 py-1 rounded-md border bg-background/50 hover:bg-accent hover:border-primary/40 transition-colors text-xs min-w-0"
            title="Change model"
          >
            <Cpu className="h-3 w-3 text-muted-foreground group-hover:text-foreground shrink-0" />
            <span className="font-mono truncate max-w-[18rem]">
              <span className="text-muted-foreground">{provider || 'no-provider'}</span>
              <span className="text-muted-foreground/40 mx-1">/</span>
              <span className="font-medium">{model || 'no-model'}</span>
            </span>
          </button>
          {/* Context window usage chip — only meaningful once we know maxContext */}
          {maxContext > 0 && lastInputTokens > 0 && (
            <span
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium tabular-nums',
                ctxTone,
              )}
              title={`Last input: ${lastInputTokens.toLocaleString()} / ${maxContext.toLocaleString()} tokens`}
            >
              ctx {ctxPct}% · {fmtTok(lastInputTokens)}/{fmtTok(maxContext)}
            </span>
          )}
          {/* Mode picker — always shown so users can switch back to default
              from a one-shot mode without diving into settings. Lazy-loads
              the list on first click. */}
          <ModePicker />
          {/* Iteration progress while running */}
          {iteration && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
              title="Agent iteration"
            >
              <Activity className="h-3 w-3 animate-pulse" />
              iter {iteration.index}
              {iteration.max > 0 ? `/${iteration.max}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          {totalTokens.input > 0 && (
            <div className="flex items-center gap-3 tabular-nums">
              <span className="flex items-center gap-1">
                <span className="font-medium text-foreground">{fmtTok(totalTokens.input)}</span>
                <span>in</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="font-medium text-foreground">{fmtTok(totalTokens.output)}</span>
                <span>out</span>
              </span>
              {totalTokens.cacheRead && totalTokens.cacheRead > 0 && (() => {
                // Cache hit ratio = cacheRead / (cacheRead + input). Same
                // formula as TUI's status bar — answers "what fraction of
                // the prompt did we get at the cache discount?"
                const denom = (totalTokens.cacheRead ?? 0) + totalTokens.input;
                const pct = denom > 0 ? Math.round(((totalTokens.cacheRead ?? 0) / denom) * 100) : 0;
                return (
                  <span
                    className="flex items-center gap-1"
                    title={`Cache hit ratio: ${pct}% — ${(totalTokens.cacheRead ?? 0).toLocaleString()} cached / ${denom.toLocaleString()} total`}
                  >
                    <span className="font-medium text-foreground">{fmtTok(totalTokens.cacheRead)}</span>
                    <span>cache ({pct}%)</span>
                  </span>
                );
              })()}
              <span className="font-medium text-green-600 dark:text-green-400">
                ${cost.toFixed(4)}
              </span>
            </div>
          )}
          {startTime && (
            <span className="text-muted-foreground/70 tabular-nums">{formatDuration(startTime)}</span>
          )}
          {/* Action cluster — palette / theme cycle / shortcuts help /
              settings. All keyboard-shortcut-equivalent but exposed here
              for discoverability. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPaletteOpen(true)}
            title="Command palette (Ctrl+K)"
          >
            <Command className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              // Cycle: light → dark → system → light. Quickest way to
              // adjust without leaving the chat for the settings tab.
              const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
              setTheme(next);
            }}
            title={`Theme: ${theme} (click to cycle)`}
          >
            {theme === 'light' ? (
              <Sun className="h-4 w-4" />
            ) : theme === 'dark' ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Monitor className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 font-mono text-xs"
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts (?)"
          >
            ?
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCurrentView('settings')}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 relative overflow-hidden">
        {/* Chat-local Ctrl+F overlay — pinned top-right, scrolls hits into
            view and highlights the active row in MessageBubble. */}
        <SearchOverlay />
        {/* Jump-to-latest pill — only when the user scrolled away from the
            live tail. Shows the unread count so they know how much they're
            behind without having to scroll down first. */}
        {!pinnedToBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className={cn(
              'absolute bottom-4 left-1/2 -translate-x-1/2 z-10',
              'flex items-center gap-2 px-4 py-2 rounded-full shadow-lg',
              'bg-primary text-primary-foreground text-xs font-medium',
              'hover:bg-primary/90 transition-colors animate-message',
            )}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {unreadCount > 0 ? `${unreadCount} new message${unreadCount === 1 ? '' : 's'}` : 'Jump to latest'}
          </button>
        )}
        <ScrollArea className="h-full" ref={scrollRef}>
        <div className="max-w-5xl mx-auto p-4 pb-8 space-y-6">
          {messages.length === 0 && !isLoading && <WelcomeScreen />}
          
          {/* Group consecutive tool messages into one collapsible chip so a
              run of 8 parallel reads doesn't eat half the viewport. Non-tool
              messages render as before. The last group auto-opens while the
              agent is still running so the user can watch tools land in
              real time; older groups default to collapsed. */}
          {(() => {
            type Group =
              | { kind: 'msg'; message: ChatMessage; isFirst: boolean }
              | { kind: 'tools'; tools: ChatMessage[]; key: string };
            const groups: Group[] = [];
            for (let i = 0; i < messages.length; i++) {
              const m = messages[i]!;
              if (m.role === 'tool') {
                const last = groups[groups.length - 1];
                if (last && last.kind === 'tools') {
                  last.tools.push(m);
                } else {
                  groups.push({ kind: 'tools', tools: [m], key: m.id });
                }
              } else {
                const prev = messages[i - 1];
                groups.push({
                  kind: 'msg',
                  message: m,
                  isFirst: !prev || prev.role !== m.role,
                });
              }
            }
            const lastGroupIdx = groups.length - 1;
            return groups.map((g, idx) => {
              if (g.kind === 'msg') {
                return (
                  <MessageBubble
                    key={g.message.id}
                    message={g.message}
                    isFirst={g.isFirst}
                  />
                );
              }
              const isLatestRunning =
                idx === lastGroupIdx &&
                isLoading &&
                g.tools.some((t) => t.toolResult === undefined);
              return (
                <ToolGroup
                  key={g.key}
                  tools={g.tools}
                  defaultOpen={isLatestRunning}
                />
              );
            });
          })()}
          
          {/* Running status bubble — always present as the last message
              while the agent is not idle. Picks a label based on what the
              agent is currently doing (composing reply / running tools /
              thinking between steps) and ticks a live elapsed timer so the
              user has visible proof of life even mid-iteration. */}
          {isLoading && (() => {
            const last = messages[messages.length - 1];
            const runningTools = messages.filter(
              (m) => m.role === 'tool' && m.toolResult === undefined,
            );
            let label = 'Thinking…';
            if (runningTools.length > 0) {
              const names = Array.from(
                new Set(runningTools.map((t) => t.toolName).filter(Boolean) as string[]),
              );
              const preview = names.slice(0, 2).join(', ');
              const more = names.length > 2 ? ` +${names.length - 2}` : '';
              label =
                runningTools.length === 1
                  ? `Running ${preview || 'tool'}…`
                  : `Running ${runningTools.length} tools (${preview}${more})…`;
            } else if (last?.role === 'assistant' && last.content) {
              label = 'Writing reply…';
            } else if (last?.role === 'tool' && last.toolResult !== undefined) {
              label = 'Thinking about the next step…';
            }
            const elapsedSec = runStartedAt
              ? Math.max(0, Math.floor((nowTick - runStartedAt) / 1000))
              : 0;
            const elapsed =
              elapsedSec < 60
                ? `${elapsedSec}s`
                : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;
            return (
              <div className="flex gap-3 animate-message">
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-accent text-accent-foreground ring-2 ring-offset-2 ring-offset-background ring-accent/20">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="rounded-2xl px-4 py-3 bg-card border text-foreground">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce" />
                      </span>
                      <span className="text-foreground/90">{label}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {elapsed}
                      </span>
                      {iteration && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          · iter {iteration.index}
                          {iteration.max > 0 ? `/${iteration.max}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        </ScrollArea>
      </div>

      {/* Input */}
      <div className="border-t bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 p-4 shrink-0">
        <div className="max-w-5xl mx-auto">
          <ChatInput />
          <p className="text-xs text-center text-muted-foreground/50 mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
