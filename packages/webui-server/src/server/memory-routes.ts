import type { MemoryPort } from '@wrongstack/core/types';
import type { WebSocket } from 'ws';
import {
  handleMemoryList,
  handleSuperMemoryBackfillRecoverable,
  handleSuperMemoryCandidateResolve,
  handleSuperMemoryDelete,
  handleSuperMemoryForFile,
  handleSuperMemoryGet,
  handleSuperMemoryGraph,
  handleSuperMemoryList,
  handleSuperMemoryListPage,
  handleSuperMemoryRecover,
  handleSuperMemoryRemember,
  handleSuperMemoryUpdate,
} from './memory-handlers.js';
import type { WSClientMessage, WSServerMessage } from './types.js';

export interface MemoryRouteContext {
  getMemoryStore: () => MemoryPort | undefined;
  send: (ws: WebSocket, message: WSServerMessage) => void;
  sendResult: (ws: WebSocket, success: boolean, message: string) => void;
}

function unavailable(ctx: MemoryRouteContext, ws: WebSocket, type: string): void {
  if (type === 'memory.super.delete') {
    ctx.sendResult(ws, false, 'Memory store not available');
    return;
  }
  ctx.send(ws, {
    type,
    payload: {
      ...(type === 'memory.list' ? { text: '' } : {}),
      ...(type === 'memory.super.graph' ? { query: '' } : {}),
      error: 'Memory store not available',
    },
  });
}

/** Canonical Memory/SuperMemory routing and unavailable-store behavior. */
export async function handleMemoryRoute(
  ctx: MemoryRouteContext,
  ws: WebSocket,
  message: WSClientMessage,
): Promise<boolean> {
  if (message.type !== 'memory.list' && !message.type.startsWith('memory.super.')) return false;
  const store = ctx.getMemoryStore();
  if (!store) {
    unavailable(ctx, ws, message.type);
    return true;
  }
  switch (message.type) {
    case 'memory.list':
      await handleMemoryList(ws, store);
      return true;
    case 'memory.super.list':
      await handleSuperMemoryList(ws, store);
      return true;
    case 'memory.super.listPage':
      await handleSuperMemoryListPage(ws, message, store);
      return true;
    case 'memory.super.get':
      await handleSuperMemoryGet(ws, message, store);
      return true;
    case 'memory.super.graph':
      await handleSuperMemoryGraph(ws, message, store);
      return true;
    case 'memory.super.update':
      await handleSuperMemoryUpdate(ws, message, store);
      return true;
    case 'memory.super.delete':
      await handleSuperMemoryDelete(ws, message, store);
      return true;
    case 'memory.super.remember':
      await handleSuperMemoryRemember(ws, message, store);
      return true;
    case 'memory.super.recover':
      await handleSuperMemoryRecover(ws, message, store);
      return true;
    case 'memory.super.candidateResolve':
      await handleSuperMemoryCandidateResolve(ws, message, store);
      return true;
    case 'memory.super.backfillRecoverable':
      await handleSuperMemoryBackfillRecoverable(ws, message, store);
      return true;
    case 'memory.super.forFile':
      await handleSuperMemoryForFile(ws, message, store);
      return true;
    default:
      return false;
  }
}
