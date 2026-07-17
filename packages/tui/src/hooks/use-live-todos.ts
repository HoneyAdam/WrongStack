import type { Agent, TodoItem } from '@wrongstack/core';
import { useEffect, useState } from 'react';

/** React snapshot of canonical Context todos, updated on every replacement. */
export function useLiveTodos(context: Agent['ctx']): TodoItem[] {
  const [todos, setTodos] = useState<TodoItem[]>(() => [...context.todos]);

  useEffect(() => {
    setTodos([...context.todos]);
    return context.state.onChange((change) => {
      if (change.kind === 'todos_replaced') setTodos([...change.todos]);
    });
  }, [context]);

  return todos;
}
