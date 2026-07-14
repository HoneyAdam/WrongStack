/**
 * WebUI command bridge.
 * Handles command dispatch, queuing, and ACK management.
 */
import type { DesktopWebuiCommand, DesktopWebuiStatusSnapshot } from '../../shared/types.js';
import type { DesktopWebuiRuntimeView, PendingWebuiCommandAck } from '../state/types.js';
import { MAX_PENDING_WEBUI_COMMANDS, MAX_PENDING_FLUSH_ATTEMPTS, WEBUI_COMMAND_FALLBACK_MS, WEBUI_COMMAND_ACK_TIMEOUT_MS, PENDING_WEBUI_FLUSH_DELAY_MS } from '../state/constants.js';
import { buildWebuiCommandFallbackScript, normalizeDesktopWebuiCommand } from '../webui-command-bridge.js';

export interface CommandBridgeContext {
  getWebuiViews(): Map<string, DesktopWebuiRuntimeView>;
  getActiveWebuiRuntimeId(): string | null;
  getWebuiStatus(): DesktopWebuiStatusSnapshot;
  getRuntimeManager(): {
    getRuntimeWsUrlWithToken(id: string): string | undefined;
    snapshot(): {
      runtimes: { id: string; status: string }[];
      activeRuntimeId: string | null;
    };
  };
  setEntryWebuiStatus(entry: DesktopWebuiRuntimeView, next: DesktopWebuiStatusSnapshot): void;
  setWebuiStatus(status: DesktopWebuiStatusSnapshot): void;
}

let webuiCommandSequence = 0;

/**
 * Dispatch a WebUI command to the active runtime.
 */
export async function dispatchWebuiCommand(
  ctx: CommandBridgeContext,
  commandInput: unknown,
): Promise<boolean> {
  const command = normalizeDesktopWebuiCommand(commandInput);
  if (!command) return false;

  const entry = getActiveWebuiEntry(ctx);
  if (!entry?.url) return false;

  if (entry.status.status !== 'ready') {
    if (!entry.view.webContents.isLoading() && entry.status.status !== 'error') {
      return dispatchWebuiCommandNow(ctx, entry, command);
    }
    queueWebuiCommand(entry, command);
    schedulePendingWebuiFlush(ctx, entry);
    return true;
  }

  if (!entry.bridgeReady) {
    if (!entry.view.webContents.isLoading()) {
      return dispatchWebuiCommandNow(ctx, entry, command);
    }
    queueWebuiCommand(entry, command);
    schedulePendingWebuiFlush(ctx, entry);
    return true;
  }

  return dispatchWebuiCommandNow(ctx, entry, command);
}

/**
 * Dispatch a command immediately without queuing.
 */
export async function dispatchWebuiCommandNow(
  ctx: CommandBridgeContext,
  entry: DesktopWebuiRuntimeView,
  command: DesktopWebuiCommand,
): Promise<boolean> {
  if (ctx.getWebuiViews().get(entry.runtimeId) !== entry || !entry.url) return false;

  const requestId = nextWebuiCommandRequestId(entry.runtimeId);
  const commandWithRequestId: DesktopWebuiCommand = { ...command, requestId };
  const pendingAcks = getPendingAcks();

  return new Promise<boolean>((resolve) => {
    const fallbackTimer = setTimeout(() => {
      const pending = pendingAcks.get(requestId);
      if (!pending) return;
      sendWebuiCommandDomFallback(ctx, entry, commandWithRequestId);
    }, WEBUI_COMMAND_FALLBACK_MS);

    const timer = setTimeout(() => {
      settlePendingWebuiCommandAck(ctx, requestId, false);
    }, WEBUI_COMMAND_ACK_TIMEOUT_MS);

    pendingAcks.set(requestId, {
      runtimeId: entry.runtimeId,
      timer,
      fallbackTimer,
      resolve,
    });

    try {
      entry.view.webContents.send('desktop:webui-command', commandWithRequestId);
      if (ctx.getActiveWebuiRuntimeId() === entry.runtimeId) {
        entry.view.webContents.focus();
      }
    } catch {
      settlePendingWebuiCommandAck(ctx, requestId, false);
    }
  });
}

// Module-level storage for pending acks (simplifies the architecture)
const _pendingAcks = new Map<string, PendingWebuiCommandAck>();
export function getPendingAcks(): Map<string, PendingWebuiCommandAck> {
  return _pendingAcks;
}

/**
 * Reload the active WebUI view.
 */
export async function reloadActiveWebuiView(ctx: CommandBridgeContext): Promise<boolean> {
  const entry = getActiveWebuiEntry(ctx);
  if (!entry?.url) return false;

  entry.bridgeReady = false;
  ctx.setEntryWebuiStatus(entry, { runtimeId: entry.runtimeId, status: 'loading' });

  return entry.view.webContents
    .loadURL(entry.url)
    .then(() => true)
    .catch((err) => {
      ctx.setEntryWebuiStatus(entry, {
        runtimeId: entry.runtimeId,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    });
}

/**
 * Handle ACK from WebUI.
 */
export function settlePendingWebuiCommandAck(
  ctx: CommandBridgeContext,
  requestId: string,
  handled: boolean,
): void {
  const pendingAcks = getPendingAcks();
  const pending = pendingAcks.get(requestId);
  if (!pending) return;

  pendingAcks.delete(requestId);
  clearTimeout(pending.timer);
  if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer);

  if (handled) {
    const entry = ctx.getWebuiViews().get(pending.runtimeId);
    if (entry) {
      entry.bridgeReady = true;
      ctx.setEntryWebuiStatus(entry, { ...entry.status, status: 'ready' });
    }
  }
  pending.resolve(handled);
}

/**
 * Flush pending commands for an entry.
 */
export async function flushPendingWebuiCommands(
  ctx: CommandBridgeContext,
  entry: DesktopWebuiRuntimeView,
): Promise<void> {
  if (ctx.getWebuiViews().get(entry.runtimeId) !== entry) return;
  if (entry.pendingCommands.length === 0) return;

  if (!entry.bridgeReady) {
    entry.pendingFlushAttempts += 1;
    const canFallback = !entry.view.webContents.isLoading() && entry.pendingFlushAttempts >= 4;

    if (!canFallback && entry.pendingFlushAttempts <= MAX_PENDING_FLUSH_ATTEMPTS) {
      schedulePendingWebuiFlush(ctx, entry);
      ctx.setEntryWebuiStatus(entry, entry.status);
      return;
    }

    if (!canFallback) {
      entry.pendingCommands.length = 0;
      ctx.setEntryWebuiStatus(entry, {
        runtimeId: entry.runtimeId,
        status: 'error',
        error: 'WebUI command bridge did not become ready.',
      });
      return;
    }
  }

  entry.pendingFlushAttempts = 0;
  const commands = entry.pendingCommands.splice(0, entry.pendingCommands.length);
  ctx.setEntryWebuiStatus(entry, entry.status);

  for (const command of commands) {
    await dispatchWebuiCommandNow(ctx, entry, command).catch(() => undefined);
  }
}

/**
 * Schedule a pending command flush.
 */
export function schedulePendingWebuiFlush(
  ctx: CommandBridgeContext,
  entry: DesktopWebuiRuntimeView,
): void {
  if (entry.pendingFlushTimer) return;
  entry.pendingFlushTimer = setTimeout(() => {
    entry.pendingFlushTimer = null;
    void flushPendingWebuiCommands(ctx, entry);
  }, PENDING_WEBUI_FLUSH_DELAY_MS);
}

// Helper functions
function getActiveWebuiEntry(ctx: CommandBridgeContext): DesktopWebuiRuntimeView | undefined {
  const activeId = ctx.getRuntimeManager().snapshot().activeRuntimeId;
  return activeId ? ctx.getWebuiViews().get(activeId) : undefined;
}

function queueWebuiCommand(entry: DesktopWebuiRuntimeView, command: DesktopWebuiCommand): void {
  entry.pendingCommands.push(command);
  if (entry.pendingCommands.length > MAX_PENDING_WEBUI_COMMANDS) {
    entry.pendingCommands.splice(0, entry.pendingCommands.length - MAX_PENDING_WEBUI_COMMANDS);
  }
  entry.pendingFlushAttempts = 0;
}

function nextWebuiCommandRequestId(runtimeId: string): string {
  webuiCommandSequence += 1;
  return `${runtimeId}:${Date.now()}:${webuiCommandSequence}`;
}

function sendWebuiCommandDomFallback(
  ctx: CommandBridgeContext,
  entry: DesktopWebuiRuntimeView,
  command: DesktopWebuiCommand,
): void {
  if (ctx.getWebuiViews().get(entry.runtimeId) !== entry || entry.view.webContents.isDestroyed()) return;
  void entry.view.webContents
    .executeJavaScript(buildWebuiCommandFallbackScript(command), true)
    .catch((err) => {
      console.debug(`[desktop] DOM fallback failed:`, err);
    });
}
