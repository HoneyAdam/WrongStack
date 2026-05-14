import type React from 'react';
import { useRef, useCallback, useState, useEffect } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useChatStore, useUIStore } from '@/stores';
import { useWebSocket } from '@/hooks/useWebSocket';
import { downloadChatAsMarkdown } from './CommandPalette';

/**
 * Slash command registry. Each entry knows its triggers (so /model and
 * /settings can map to the same action), a one-line description (shown in
 * the popup), and a `run` callback. Adding a new command means: append an
 * entry here, write a `run` body, done — no need to touch the popup or
 * dispatcher.
 */
interface SlashCommandDef {
  /** Primary name (the one shown). */
  name: string;
  /** Optional alternative spellings — typed by the user, dispatched here. */
  aliases?: string[];
  description: string;
}

const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: '/help', description: 'Show every slash command and what it does' },
  { name: '/export', description: 'Download the current chat as markdown' },
  { name: '/clear', description: 'Wipe current context (keeps session id, disk record stays)' },
  { name: '/new', description: 'Start a brand-new session (fresh on disk and in memory)' },
  { name: '/compact', description: 'Shrink context — elide ancient tool output' },
  { name: '/debug', aliases: ['/context'], description: 'Per-section context size breakdown' },
  { name: '/tools', description: 'List every registered tool the model can call' },
  { name: '/memory', description: 'Show all remembered notes (project + user scope)' },
  { name: '/skill', aliases: ['/skills'], description: 'List active skills' },
  { name: '/diag', description: 'Runtime diagnostics (provider, tools, features, mode, usage)' },
  { name: '/stats', description: 'Session stats: tokens, cache hit ratio, cost, elapsed' },
  { name: '/save', description: 'Force-flush the session (auto-saved already)' },
  { name: '/abort', aliases: ['/stop'], description: 'Abort the current run' },
  { name: '/settings', aliases: ['/model'], description: 'Open settings (provider/model/keys)' },
];

/**
 * Match what the user typed against the registry. Empty query lists
 * everything; otherwise filter by primary name AND alias prefixes so
 * `/sto` finds `/stop` (alias of /abort).
 */
function matchSlash(query: string): SlashCommandDef[] {
  const q = query.toLowerCase();
  if (q === '/' || q === '') return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) =>
      c.name.startsWith(q) ||
      (c.aliases?.some((a) => a.startsWith(q)) ?? false),
  );
}

export function ChatInput() {
  const { isLoading, setLoading, addMessage, clearMessages } = useChatStore();
  const { setCurrentView } = useUIStore();
  const pushPrompt = useUIStore((s) => s.pushPrompt);
  const promptHistory = useUIStore((s) => s.promptHistory);
  const ws = useWebSocket();
  const { sendMessage, sendAbort, client } = ws;
  const [input, setInput] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  /** Cursor into promptHistory. -1 = "live input, not browsing history".
   *  Reset to -1 whenever the user types something that's NOT a history
   *  navigation. */
  const [historyIdx, setHistoryIdx] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runSlashCommand = useCallback(
    (raw: string): boolean => {
      const cmd = raw.trim().toLowerCase();
      switch (cmd) {
        case '/help': {
          // Render the registry inline as an assistant message.
          const lines = [
            '📖 **Slash commands**',
            '',
            ...SLASH_COMMANDS.map(
              (c) =>
                `• \`${c.name}\`${c.aliases?.length ? ` (${c.aliases.map((a) => `\`${a}\``).join(', ')})` : ''} — ${c.description}`,
            ),
          ];
          addMessage({ role: 'assistant', content: lines.join('\n') });
          return true;
        }
        case '/clear':
          clearMessages();
          client?.clearContext?.();
          return true;
        case '/new':
          client?.newSession?.();
          return true;
        case '/compact':
        case '/compact!':
          client?.compactContext?.(cmd === '/compact!');
          return true;
        case '/debug':
        case '/context':
          client?.debugContext?.();
          return true;
        case '/tools':
          ws.listTools();
          return true;
        case '/memory':
          ws.listMemory();
          return true;
        case '/skill':
        case '/skills':
          ws.listSkills();
          return true;
        case '/diag':
          ws.getDiag();
          return true;
        case '/stats':
          ws.getStats();
          return true;
        case '/save':
          ws.saveSession();
          return true;
        case '/export':
          downloadChatAsMarkdown();
          addMessage({ role: 'assistant', content: '📥 Chat exported to your downloads folder.' });
          return true;
        case '/abort':
        case '/stop':
          sendAbort();
          setLoading(false);
          return true;
        case '/settings':
        case '/model':
          setCurrentView('settings');
          return true;
        default:
          return false;
      }
    },
    [addMessage, clearMessages, client, sendAbort, setLoading, setCurrentView, ws],
  );

  // Suggest slash commands as the user types. Only when the buffer is
  // exactly a slash command head — `/foo bar` shouldn't open the popup.
  const slashSuggestions =
    input.startsWith('/') && !input.includes(' ') ? matchSlash(input) : [];

  // Reset the highlight when the visible list changes so ↑/↓ always starts
  // from the top of the new matches.
  useEffect(() => {
    if (slashIndex >= slashSuggestions.length) setSlashIndex(0);
  }, [slashSuggestions.length, slashIndex]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const content = input.trim();

    if (content.startsWith('/') && runSlashCommand(content)) {
      pushPrompt(content);
      setInput('');
      setHistoryIdx(-1);
      return;
    }

    setInput('');
    setHistoryIdx(-1);
    pushPrompt(content);

    try {
      if (client?.isConnected) {
        addMessage({ role: 'user', content });
        setLoading(true);
        sendMessage(content);
      } else {
        console.error('WebSocket not connected');
      }
    } catch (err) {
      console.error('Failed to send:', err);
      setLoading(false);
    }
  }, [input, client, sendMessage, setLoading, addMessage, runSlashCommand, pushPrompt]);

  const handleAbort = useCallback(() => {
    sendAbort();
    setLoading(false);
  }, [sendAbort, setLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Terminal-style prompt history: ↑ pulls the previous user prompt,
    // ↓ steps forward. Only active when the slash popup is closed AND the
    // input is empty OR already showing a history entry. We keep the cursor
    // ergonomic — once the user starts editing, we drop out of history mode.
    if (slashSuggestions.length === 0 && promptHistory.length > 0) {
      if (e.key === 'ArrowUp') {
        const ta = e.currentTarget;
        // Only steal ↑ if we're on the first line (so multi-line editing
        // can still navigate within the textarea naturally).
        const beforeCursor = ta.value.slice(0, ta.selectionStart);
        if (historyIdx >= 0 || beforeCursor.indexOf('\n') === -1) {
          e.preventDefault();
          const next = Math.min(promptHistory.length - 1, historyIdx + 1);
          setHistoryIdx(next);
          const text = promptHistory[next] ?? '';
          setInput(text);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (el) {
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
              el.setSelectionRange(text.length, text.length);
            }
          });
          return;
        }
      }
      if (e.key === 'ArrowDown' && historyIdx >= 0) {
        e.preventDefault();
        const next = historyIdx - 1;
        if (next < 0) {
          setHistoryIdx(-1);
          setInput('');
        } else {
          setHistoryIdx(next);
          const text = promptHistory[next] ?? '';
          setInput(text);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (el) {
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
              el.setSelectionRange(text.length, text.length);
            }
          });
        }
        return;
      }
    }

    // Slash popup keyboard navigation: ↑/↓ to select, Tab/Enter to commit,
    // Esc to dismiss. Matches the TUI's slash menu UX one-for-one so users
    // moving between surfaces don't have to relearn anything.
    if (slashSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(
          (i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length,
        );
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const pick = slashSuggestions[slashIndex];
        if (pick) {
          setInput(pick.name + ' ');
          setSlashIndex(0);
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // Commit the highlighted suggestion if there's an exact match below
        // the cursor (or the user hasn't typed a full name yet). Otherwise
        // fall through to normal submit.
        const pick = slashSuggestions[slashIndex];
        if (pick && pick.name !== input.toLowerCase().trim()) {
          e.preventDefault();
          setInput('');
          runSlashCommand(pick.name);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="relative flex-1">
        {/* Slash command popup — descriptions inline, ↑/↓ to select, Tab to
            autocomplete, Enter to dispatch directly. Click also works. */}
        {slashSuggestions.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border bg-popover shadow-md p-1 text-sm max-h-72 overflow-auto">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b mb-1">
              ↑/↓ select · Tab complete · Enter dispatch · Esc dismiss
            </div>
            {slashSuggestions.map((cmd, idx) => (
              <button
                type="button"
                key={cmd.name}
                onClick={() => {
                  setInput('');
                  runSlashCommand(cmd.name);
                }}
                onMouseEnter={() => setSlashIndex(idx)}
                className={cn(
                  'w-full text-left px-3 py-1.5 rounded transition-colors flex items-center gap-3',
                  idx === slashIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/40',
                )}
              >
                <span className="font-mono shrink-0">{cmd.name}</span>
                {cmd.aliases?.length ? (
                  <span className="text-xs text-muted-foreground/70 font-mono shrink-0">
                    ({cmd.aliases.join(', ')})
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground truncate">
                  — {cmd.description}
                </span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            adjustTextareaHeight();
            // Manual typing drops us out of history mode so the next
            // Enter sends the user's edits, not a stale history entry.
            if (historyIdx >= 0) setHistoryIdx(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={client?.isConnected ? "Message WrongStack... (type / for commands)" : "Connect to server first..."}
          className={cn(
            'flex min-h-[44px] w-full resize-none rounded-lg border border-input bg-background px-4 py-3 pr-12',
            'text-sm ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'scrollbar-thin'
          )}
          rows={1}
          disabled={isLoading || !client?.isConnected}
        />

        {input.length > 0 && (
          <span className="absolute bottom-1.5 right-12 text-xs text-muted-foreground">
            {input.length}
          </span>
        )}
      </div>

      <div className="flex gap-1">
        {isLoading ? (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            onClick={handleAbort}
            className="h-[44px] w-[44px] rounded-lg"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || !client?.isConnected}
            className="h-[44px] w-[44px] rounded-lg"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
