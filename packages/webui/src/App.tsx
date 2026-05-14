import { useEffect } from 'react';
import { ThemeProvider, useTheme } from './components/ThemeProvider';
import { ChatView } from './components/ChatView';
import { Sidebar } from './components/Sidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { CommandPalette, downloadChatAsMarkdown } from './components/CommandPalette';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { useUIStore, useChatStore, useSessionStore } from '@/stores';
import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import { useWebSocketBootstrap } from '@/hooks/useWebSocket';

function AppInner() {
  const { theme } = useTheme();
  const { currentView, sidebarOpen, toggleSidebar, setSearchOpen } = useUIStore();
  const isLoading = useChatStore((s) => s.isLoading);
  const iteration = useSessionStore((s) => s.iteration);
  const ws = useWebSocket();
  // Install WS handlers exactly once for the whole app. Every other consumer
  // (ChatInput, ConfirmDialog, SettingsPanel) uses the cheap `useWebSocket()`
  // hook which returns action methods only — see hooks/useWebSocket.ts for
  // the duplicate-handler trap this avoids.
  useWebSocketBootstrap();

  // Reflect the agent's run state in the browser tab title so background
  // tabs can tell at a glance whether work is still in progress. Restores
  // the original title when idle.
  useEffect(() => {
    const baseTitle = 'WrongStack';
    if (isLoading) {
      const it = iteration ? ` · iter ${iteration.index}${iteration.max ? `/${iteration.max}` : ''}` : '';
      document.title = `● running${it} — ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
    return () => { document.title = baseTitle; };
  }, [isLoading, iteration]);

  // Global keyboard shortcuts for the actions that don't have a dedicated
  // owner (palette/shortcuts handle their own). Bound here so they fire
  // anywhere except inside text inputs (where Ctrl+F should still search
  // the chat, but Ctrl+L would otherwise be a browser address-bar focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      const inField = tag === 'input' || tag === 'textarea' || t?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === '/' ) {
        // Focus the chat textarea so the user can start typing without
        // hunting for it. Useful after closing palette/settings.
        e.preventDefault();
        const ta = document.querySelector('textarea');
        ta?.focus();
        return;
      }
      // The Ctrl-letter shortcuts skip when the user is typing in any
      // input — otherwise Ctrl+L wipes the chat while they're composing.
      if (mod && !inField) {
        if (e.key.toLowerCase() === 'l') {
          e.preventDefault();
          useChatStore.getState().clearMessages();
          ws.client?.clearContext?.();
        } else if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          ws.client?.newSession?.();
        } else if (e.key.toLowerCase() === 'e') {
          e.preventDefault();
          downloadChatAsMarkdown();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, setSearchOpen, ws]);

  return (
    <div className={cn('flex h-screen', theme)}>
      {sidebarOpen && <Sidebar />}
      <main className="flex-1 flex flex-col overflow-hidden">
        {currentView === 'chat' && <ChatView />}
        {currentView === 'settings' && <SettingsPanel />}
      </main>

      {/* Global overlays */}
      <ConfirmDialog />
      <CommandPalette />
      <ShortcutsOverlay />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <AppInner />
    </ThemeProvider>
  );
}