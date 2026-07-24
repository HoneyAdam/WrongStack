/**
 * Kanban board file watcher — the universal liveness path for board state.
 *
 * Kanban persistence is file-based (boards under .wrongstack/kanbans) and its
 * durable events go to per-board JSONL, NOT the core EventBus — so bus
 * subscriptions can never observe tool-driven mutations (atomicity
 * assessments, decomposition proposals, completion-gate results). Watching
 * the board files is the one mechanism that catches every writer.
 *
 * On any change the full board is re-read and broadcast in the `{ board }`
 * envelope, so the client's isBoardEnvelope path applies it without hijacking
 * another tab's activeBoardId.
 *
 * Used by BOTH servers: standalone webui-server (setup-events.ts) and the CLI
 * embedded server (cli/src/webui-server/setup-events.ts).
 */

import { watch as fsWatch } from 'node:fs';
import { getBoard, getKanbanDir } from '@wrongstack/kanban';
import type { WSServerMessage } from './types.js';

export function watchKanbanBoards(
  projectRoot: string,
  broadcastMessage: (message: WSServerMessage) => void,
): () => void {
  let watcher: ReturnType<typeof fsWatch> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  try {
    const kanbanDir = getKanbanDir(projectRoot);
    watcher = fsWatch(kanbanDir, { persistent: false }, (_eventType, filename) => {
      const name = filename?.toString();
      if (!name?.endsWith('.json')) return;
      const boardId = name.slice(0, -5);
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          const board = await getBoard(projectRoot, boardId);
          if (board) {
            broadcastMessage({
              type: 'kanban.get',
              payload: { success: true, data: { board } },
            } as WSServerMessage);
          }
        } catch {
          // best-effort: the next explicit refresh catches transient errors
        }
      }, 60);
    });
    watcher.on('error', () => watcher?.close());
  } catch {
    // Kanban directory may not exist yet.
  }
  return () => {
    if (debounce) clearTimeout(debounce);
    watcher?.close();
    watcher = null;
  };
}
