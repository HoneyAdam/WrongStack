import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import { useConfigStore, useHistoryStore, useSessionStore, useUIStore } from '@/stores';
import {
  History,
  Layers,
  MessageSquare,
  PanelLeftClose,
  Settings as SettingsIcon,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ConfigSection } from './ConfigSection.js';
import { SessionActions } from './SessionActions.js';
import { SessionList } from './SessionList.js';

export function Sidebar() {
  const { toggleSidebar, currentView, setCurrentView } = useUIStore();
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const { wsConnected, wsUrl } = useConfigStore();
  const { entries: historyEntries, loading: historyLoading, error: historyError } = useHistoryStore();
  const { listSessions, deleteSession, resumeSession, client } = useWebSocket();
  const session = useSessionStore((s) => s.session);

  const [historyQuery, setHistoryQuery] = useState('');
  const activeSessionId = session?.id;

  useEffect(() => {
    if (wsConnected) client?.getTodos?.();
  }, [wsConnected, client]);

  useEffect(() => {
    void activeSessionId;
    if (currentView === 'history' && wsConnected) listSessions(50);
  }, [currentView, wsConnected, activeSessionId, listSessions]);

  const formatDuration = (start: number | null) => {
    if (!start) return '--';
    const seconds = Math.floor((Date.now() - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  };

  // Drag handle
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev: MouseEvent) => { setSidebarWidth(startWidth + (ev.clientX - startX)); };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <aside style={{ width: `${sidebarWidth}px` }} className="relative border-r bg-card flex flex-col shrink-0">
      {/* Drag handle */}
      <div
        onMouseDown={startDrag}
        onDoubleClick={() => setSidebarWidth(288)}
        className="group/handle absolute top-0 right-0 h-full w-2 cursor-col-resize z-10 flex items-center justify-end"
        title="Drag to resize · double-click to reset"
      >
        <div className="h-full w-px bg-border group-hover/handle:bg-primary/60 group-hover/handle:w-0.5 transition-all" />
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-0 group-hover/handle:opacity-100 transition-opacity pr-0.5">
          <span className="h-1 w-1 rounded-full bg-primary/70" />
          <span className="h-1 w-1 rounded-full bg-primary/70" />
          <span className="h-1 w-1 rounded-full bg-primary/70" />
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2.5">
          <div className="relative w-7 h-7 rounded-md bg-primary flex items-center justify-center shadow-[0_0_0_1px_hsl(var(--primary)/0.4),0_2px_8px_-2px_hsl(var(--primary)/0.5)]">
            <Zap className="h-4 w-4 text-primary-foreground" strokeWidth={2.4} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">WrongStack</span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
              <span className={cn('led', wsConnected ? 'text-[hsl(var(--success))] led-pulse' : 'text-[hsl(var(--warning))]')} />
              <span className="tabular font-medium uppercase tracking-wider">{wsConnected ? 'online' : 'offline'}</span>
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleSidebar} title="Collapse sidebar (Ctrl+\\)">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <Tabs value={currentView === 'settings' || currentView === 'autophase' ? 'chat' : currentView} onValueChange={(v) => setCurrentView(v as 'chat' | 'history')} className="flex-1 flex flex-col">
        <TabsList className="w-full rounded-none bg-transparent p-2 h-auto grid grid-cols-2">
          <TabsTrigger value="chat" className="flex-col gap-1.5 py-2 data-[state=active]:bg-primary/10">
            <MessageSquare className="h-4 w-4" /><span className="text-xs">Chat</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-col gap-1.5 py-2 data-[state=active]:bg-primary/10">
            <History className="h-4 w-4" /><span className="text-xs">History</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 flex flex-col m-0 overflow-hidden">
          <ConfigSection formatDuration={formatDuration} />
          <SessionActions wsConnected={wsConnected} />
          <div className="flex-1" />
          <div className="px-3 py-3 border-t space-y-1">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCurrentView('settings')}>
              <SettingsIcon className="h-4 w-4 mr-2" />Settings
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCurrentView('autophase')}>
              <Layers className="h-4 w-4 mr-2" />Phases
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 m-0 flex flex-col overflow-hidden">
          <SessionList
            historyQuery={historyQuery}
            setHistoryQuery={setHistoryQuery}
            historyEntries={historyEntries}
            historyLoading={historyLoading}
            historyError={historyError}
            wsConnected={wsConnected}
            listSessions={listSessions}
            resumeSession={resumeSession}
            deleteSession={deleteSession}
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
