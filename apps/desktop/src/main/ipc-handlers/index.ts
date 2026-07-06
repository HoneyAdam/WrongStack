/**
 * IPC handler registration.
 * Centralizes all IPC handler registration logic.
 */
import { ipcMain, shell } from 'electron';
import type { DesktopWebuiPrefs } from '../../shared/types.js';
import { IPC } from '../ipc.js';
import type { DesktopWebuiRuntimeView, IpcHandlerContext, PendingWebuiCommandAck } from '../state/types.js';

/**
 * Register all IPC handlers.
 */
export function registerIpcHandlers(ctx: IpcHandlerContext): void {
  // State handlers
  ipcMain.handle(IPC.getState, () => ctx.getRuntimeManager().snapshot());
  ipcMain.handle(IPC.getConversation, (_event, runtimeId: string) => ctx.getAgentBridge().snapshot(runtimeId));
  ipcMain.handle(IPC.getWebuiStatus, () => ctx.getWebuiStatus());

  // Navigation handlers
  ipcMain.handle(IPC.navigateWebui, async (_event, command: unknown) =>
    ctx.dispatchWebuiCommand(command),
  );
  ipcMain.handle(IPC.reloadWebui, async () => ctx.reloadActiveWebuiView());

  // Shell handlers
  ipcMain.handle(IPC.setShellSidebarCollapsed, (_event, collapsed: unknown) => {
    ctx.setShellSidebarCollapsed(collapsed === true);
    return true;
  });
  ipcMain.handle(IPC.openSettings, async () => ctx.openSettings());

  // Project handlers
  ipcMain.handle(IPC.openProjectSession, async (_event, runtimeId?: string | undefined) => {
    return ctx.openProjectSession(runtimeId);
  });
  ipcMain.handle(IPC.openProject, async (_event, requestedRoot?: string | undefined) => {
    return ctx.openProject(requestedRoot);
  });
  ipcMain.handle(IPC.registerProject, async (_event, requestedRoot?: string | undefined) => {
    return ctx.registerProject(requestedRoot);
  });
  ipcMain.handle(IPC.unregisterProject, async (_event, root: string) => {
    return ctx.unregisterProject(root);
  });

  // Runtime handlers
  ipcMain.handle(IPC.activateRuntime, async (_event, id: string) => {
    return ctx.activateRuntime(id);
  });
  ipcMain.handle(IPC.closeRuntime, async (_event, id: string) => {
    return ctx.closeRuntime(id);
  });
  ipcMain.handle(IPC.sendMessage, async (_event, id: string, content: string) =>
    ctx.sendMessage(id, ctx.getRuntimeManager().getRuntimeWsUrlWithToken(id) ?? '', content),
  );
  ipcMain.handle(IPC.abortRuntime, async (_event, id: string) =>
    ctx.abortRuntime(id, ctx.getRuntimeManager().getRuntimeWsUrlWithToken(id) ?? ''),
  );
  ipcMain.handle(IPC.openRuntimeInBrowser, async (_event, id: string) => {
    const url = ctx.getRuntimeManager().getRuntimeUrlWithToken(id);
    if (url) ctx.openExternal(url);
  });
  ipcMain.handle(IPC.revealRuntimeRoot, async (_event, id: string) => {
    const runtime = ctx.getRuntimeManager().getRuntime(id);
    if (runtime) ctx.revealInExplorer(runtime.root);
  });

  // WebUI event handlers
  ipcMain.on(IPC.webuiReadyChanged, (event, ready: boolean) => {
    const entry = ctx.findWebuiEntryBySenderId(event.sender.id);
    if (!entry) return;
    entry.bridgeReady = ready === true;
    if (entry.bridgeReady) {
      ctx.setEntryWebuiStatus(entry, { ...entry.status, status: 'ready' });
      ctx.schedulePendingWebuiFlush(entry);
    } else if (entry.status.status === 'ready') {
      ctx.setEntryWebuiStatus(entry, { ...entry.status, status: 'loading' });
    }
  });

  ipcMain.on(IPC.webuiPrefsChanged, (event, prefs: unknown) => {
    const entry = ctx.findWebuiEntryBySenderId(event.sender.id);
    if (!entry) return;
    const sanitized = sanitizeWebuiPrefs(prefs);
    if (Object.keys(sanitized).length === 0) return;
    ctx.setEntryWebuiStatus(entry, {
      ...entry.status,
      prefs: { ...(entry.status.prefs ?? {}), ...sanitized },
    });
  });

  ipcMain.on(
    IPC.webuiCommandAck,
    (event, requestId: unknown, handled: unknown, _message?: unknown) => {
      const entry = ctx.findWebuiEntryBySenderId(event.sender.id);
      if (!entry || typeof requestId !== 'string') return;
      const pending = ctx.getPendingWebuiCommandAcks().get(requestId);
      if (!pending || pending.runtimeId !== entry.runtimeId) return;
      ctx.settlePendingWebuiCommandAck(requestId, handled === true);
    },
  );

  // Locale handlers
  ipcMain.on(IPC.setLocale, (_event, locale: string) => {
    ctx.getI18n().setMainLocale(locale);
    ctx.configureApplicationMenu();
    ctx.broadcastLocaleToEmbeddedWebuis(locale);
    void ctx.getConfigIo().writeUiLocale(locale);
  });
}

/**
 * Sanitize WebUI preferences from renderer.
 */
function sanitizeWebuiPrefs(prefs: unknown): DesktopWebuiPrefs {
  const next: DesktopWebuiPrefs = {};
  if (!isRecord(prefs)) return next;
  if (typeof prefs['yolo'] === 'boolean') next.yolo = prefs['yolo'];
  if (typeof prefs['nextPrediction'] === 'boolean') next.nextPrediction = prefs['nextPrediction'];
  if (typeof prefs['contextAutoCompact'] === 'boolean') {
    next.contextAutoCompact = prefs['contextAutoCompact'];
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
