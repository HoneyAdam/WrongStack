import { getWSClient } from '@/lib/ws-client';
import { CheckCircle2, Circle, Clock, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string | undefined;
}

/**
 * Live agent todo list panel. Connects to the WebSocket on mount,
 * requests the current todo snapshot, and stays in sync via
 * `todos.updated` events broadcast by the server on every tool.executed.
 *
 * Self-contained — no store needed. Uses the singleton WS client
 * directly and manages its own React state.
 */
export function TodosPanel(): React.ReactElement {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const ws = getWSClient();
  const offRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Request current snapshot
    ws.send({ type: 'todos.get' });

    // Listen for live updates
    offRef.current = ws.on('todos.updated', (msg: unknown) => {
      const payload = (msg as { payload?: { todos?: TodoItem[] | undefined } })?.payload;
      if (payload?.todos) setTodos(payload.todos);
    });

    return () => {
      offRef.current?.();
    };
  }, [ws]);

  const handleRemove = useCallback(
    (id: string) => {
      ws.removeTodo(id);
    },
    [ws],
  );

  const pending = todos.filter((t) => t.status === 'pending');
  const inProgress = todos.filter((t) => t.status === 'in_progress');
  const completed = todos.filter((t) => t.status === 'completed');

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">TODOS</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {completed.length}/{todos.length}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {inProgress.length > 0 && (
            <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
              <Clock className="w-3 h-3" />
              {inProgress.length}
            </span>
          )}
          {pending.length > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Circle className="w-3 h-3" />
              {pending.length}
            </span>
          )}
          {completed.length > 0 && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              {completed.length}
            </span>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <p className="px-4 py-8 text-xs text-muted-foreground text-center">
            No todos yet. The agent will create them as it plans work.
          </p>
        ) : (
          <div className="py-1">
            {todos.map((t) => {
              const label = t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content;
              const isInProgress = t.status === 'in_progress';
              const isCompleted = t.status === 'completed';

              return (
                <div
                  key={t.id}
                  className={`px-4 py-2 flex items-start gap-2.5 text-sm border-l-2 group ${
                    isInProgress
                      ? 'border-l-yellow-500 bg-yellow-50/40 dark:bg-yellow-950/20'
                      : isCompleted
                        ? 'border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/15'
                        : 'border-l-transparent'
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    {isCompleted ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : isInProgress ? (
                      <Clock className="w-3.5 h-3.5 text-yellow-500 animate-spin" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-muted-foreground/50" />
                    )}
                  </span>
                  <span
                    className={`leading-snug flex-1 ${
                      isInProgress
                        ? 'text-yellow-800 dark:text-yellow-200 font-medium'
                        : isCompleted
                          ? 'text-muted-foreground line-through'
                          : 'text-foreground'
                    }`}
                  >
                    {label}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(t.id);
                    }}
                    className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-muted transition-all"
                    title="Remove"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
