import { useEffect } from 'react';
import { useUIStore, useChatStore, useSessionStore, useConfigStore, useHistoryStore } from '@/stores';
import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import {
  MessageSquare,
  History,
  Settings as SettingsIcon,
  PanelLeftClose,
  Trash2,
  RotateCcw,
  Zap,
  Database,
  Wifi,
  WifiOff,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { ScrollArea } from './ui/scroll-area';

/**
 * Sidebar: navigation + at-a-glance session info. Settings live in the main
 * `SettingsPanel` (open via the gear in ChatView's header or the button at
 * the bottom of this sidebar) — keeping settings in two places confused
 * users who clicked the sidebar "Settings" tab expecting a model picker
 * and only found a theme switcher.
 */
export function Sidebar() {
  const { toggleSidebar, currentView, setCurrentView } = useUIStore();
  const { totalTokens, cost, session } = useSessionStore();
  const { messages, clearMessages } = useChatStore();
  const { wsConnected, wsUrl, provider, model } = useConfigStore();
  const { entries: historyEntries, loading: historyLoading, error: historyError } = useHistoryStore();
  const { listSessions, deleteSession, resumeSession, client } = useWebSocket();
  const activeSessionId = session?.id;

  // Refresh the history list on tab open + whenever the active session id
  // changes (a /new would push the previous session into history).
  useEffect(() => {
    void activeSessionId;
    if (currentView === 'history' && wsConnected) {
      listSessions(50);
    }
  }, [currentView, wsConnected, activeSessionId, listSessions]);

  const formatDuration = (start: number | null) => {
    if (!start) return '--';
    const seconds = Math.floor((Date.now() - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  };

  const formatRelative = (iso: string): string => {
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    const days = Math.floor(diff / 86_400_000);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <aside className="w-72 border-r bg-card flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold tracking-tight">WrongStack</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Navigation — Chat | History only. Settings opens the full panel. */}
      <Tabs
        value={currentView === 'settings' ? 'chat' : currentView}
        onValueChange={(v) => setCurrentView(v as 'chat' | 'history')}
        className="flex-1 flex flex-col"
      >
        <TabsList className="w-full rounded-none bg-transparent p-2 h-auto grid grid-cols-2">
          <TabsTrigger
            value="chat"
            className="flex-col gap-1.5 py-2 data-[state=active]:bg-primary/10"
          >
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs">Chat</span>
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="flex-col gap-1.5 py-2 data-[state=active]:bg-primary/10"
          >
            <History className="h-4 w-4" />
            <span className="text-xs">History</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 flex flex-col m-0 overflow-hidden">
          {/* Connection status */}
          <div className="px-4 py-3 border-b">
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
                wsConnected
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
              )}
            >
              {wsConnected ? (
                <Wifi className="h-4 w-4" />
              ) : (
                <WifiOff className="h-4 w-4" />
              )}
              <span className="font-medium">
                {wsConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-2 px-1 font-mono">
              {wsUrl}
            </div>
          </div>

          {/* Active model — clickable shortcut to settings */}
          <button
            type="button"
            onClick={() => setCurrentView('settings')}
            className="px-4 py-3 border-b text-left hover:bg-muted/40 transition-colors"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Active model
            </div>
            <div className="font-mono text-xs truncate">
              <span className="text-muted-foreground">{provider || '—'}</span>
              <span className="text-muted-foreground/40 mx-1">/</span>
              <span className="font-medium">{model || '—'}</span>
            </div>
          </button>

          {/* Session Stats */}
          <div className="px-4 py-3 border-b space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              Session
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col p-2 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">Messages</span>
                <span className="text-lg font-semibold">{messages.length}</span>
              </div>
              <div className="flex flex-col p-2 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">Duration</span>
                <span className="text-lg font-semibold">{formatDuration(session?.startedAt ?? null)}</span>
              </div>
              <div className="flex flex-col p-2 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">Input</span>
                <span className="text-lg font-semibold">{totalTokens.input.toLocaleString()}</span>
              </div>
              <div className="flex flex-col p-2 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">Output</span>
                <span className="text-lg font-semibold">{totalTokens.output.toLocaleString()}</span>
              </div>
            </div>
            {cost > 0 && (
              <div className="flex justify-between items-center p-2 rounded-lg bg-green-500/10">
                <span className="text-sm text-muted-foreground">Cost</span>
                <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                  ${cost.toFixed(4)}
                </span>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-3 border-b space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                // Match /clear: drop UI + backend context together so the
                // model doesn't keep replying with knowledge from messages
                // the user just told us to forget.
                clearMessages();
                client?.clearContext?.();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear context
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => client?.newSession?.()}
              disabled={!wsConnected}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              New session
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => client?.compactContext?.()}
              disabled={!wsConnected}
            >
              <Database className="h-4 w-4 mr-2" />
              Compact context
            </Button>
          </div>

          <div className="flex-1" />

          {/* Footer: settings entry point */}
          <div className="px-3 py-3 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setCurrentView('settings')}
            >
              <SettingsIcon className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 m-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Recent sessions
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => listSessions(50)}
              disabled={!wsConnected}
              title="Refresh"
            >
              {historyLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {historyError && (
            <div className="px-4 py-2 text-xs text-destructive bg-destructive/5 border-b">
              {historyError}
            </div>
          )}

          <ScrollArea className="flex-1">
            {historyEntries.length === 0 && !historyLoading ? (
              <div className="text-center text-muted-foreground py-8 px-4">
                <History className="h-8 w-8 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">No history yet</p>
                <p className="text-xs mt-1">Your conversations will appear here</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {historyEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      'group relative rounded-md border text-sm transition-colors',
                      entry.isCurrent
                        ? 'bg-primary/5 border-primary/40'
                        : 'bg-card border-border/60 hover:bg-muted/40 hover:border-primary/40',
                    )}
                  >
                    <button
                      type="button"
                      disabled={entry.isCurrent}
                      onClick={() => resumeSession(entry.id)}
                      className="block w-full rounded-md px-3 py-2 pr-8 text-left disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate text-foreground" title={entry.title}>
                          {entry.title || '(empty)'}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                          {entry.provider}/{entry.model}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80 mt-0.5">
                          <span>{formatRelative(entry.startedAt)}</span>
                          {entry.tokenTotal > 0 && (
                            <>
                              <span>·</span>
                              <span className="tabular-nums">
                                {entry.tokenTotal.toLocaleString()} tok
                              </span>
                            </>
                          )}
                          {entry.isCurrent && (
                            <>
                              <span>·</span>
                              <span className="text-primary font-medium">active</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                    {!entry.isCurrent && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete session "${entry.title}"?`)) {
                            deleteSession(entry.id);
                          }
                        }}
                        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        title="Delete session"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
