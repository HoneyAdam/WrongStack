/**
 * WebUI view management.
 * Handles creation, lifecycle, and disposal of WebContentsView instances.
 */
import { WebContentsView } from 'electron';
import type { BaseWindow } from 'electron';
import type { DesktopWebuiStatusSnapshot } from '../../shared/types.js';
import type { DesktopWebuiRuntimeView } from '../state/types.js';
import { webuiPreloadPath } from '../runtime-manager.js';
import { OPEN_EXTERNAL_ALLOWED_PROTOCOLS } from '../state/constants.js';

export interface ViewManagerContext {
  getMainWindow(): BaseWindow | null;
  getWebuiViews(): Map<string, DesktopWebuiRuntimeView>;
  getActiveWebuiRuntimeId(): string | null;
  getRuntimeManager(): {
    getRuntimeUrlWithToken(id: string): string | undefined;
    getRuntime(id: string): DesktopRuntimeRecord | undefined;
    snapshot(): {
      runtimes: DesktopRuntimeRecord[];
      activeRuntimeId: string | null;
    };
  };
  getMainLocale(): string;
  getI18n(): {
    getMainLocale(): string;
  };
  setEntryWebuiStatus(entry: DesktopWebuiRuntimeView, next: DesktopWebuiStatusSnapshot): void;
  schedulePendingWebuiFlush(entry: DesktopWebuiRuntimeView): void;
  attachWebuiEntry(entry: DesktopWebuiRuntimeView): void;
  syncActiveWebuiView(): void;
  disposeWebuiEntry(entry: DesktopWebuiRuntimeView): void;
}

import type { DesktopRuntimeRecord } from '../../shared/types.js';

/**
 * Safely open external URLs, validating against allowed protocols.
 */
export function safeOpenExternal(target: string): void {
  let protocol: string;
  try {
    protocol = new URL(target).protocol;
  } catch {
    return;
  }
  if (OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has(protocol)) {
    void import('electron')
      .then(({ shell }) => shell.openExternal(target))
      .catch(() => {
        /* safeOpenExternal is best-effort */
      });
  }
}

/**
 * Check if two URLs share the same origin.
 */
export function sameOrigin(candidate: string, base: string | null): boolean {
  if (!base) return false;
  try {
    const candidateUrl = new URL(candidate);
    const baseUrl = new URL(base);
    return candidateUrl.origin === baseUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Create a new WebUI view entry for a runtime.
 */
export function ensureWebuiEntry(
  ctx: ViewManagerContext,
  runtimeId: string,
): DesktopWebuiRuntimeView | null {
  const mainWindow = ctx.getMainWindow();
  if (!mainWindow) return null;

  const existing = ctx.getWebuiViews().get(runtimeId);
  if (existing) return existing;

  const view = new WebContentsView({
    webPreferences: {
      preload: webuiPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const entry: DesktopWebuiRuntimeView = {
    runtimeId,
    view,
    url: null,
    status: { runtimeId, status: 'idle' },
    bridgeReady: false,
    attached: false,
    pendingCommands: [],
    pendingFlushTimer: null,
    pendingFlushAttempts: 0,
  };

  view.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (event, url) => {
    if (sameOrigin(url, entry.url)) return;
    event.preventDefault();
    safeOpenExternal(url);
  });

  view.webContents.on('did-start-loading', () => {
    if (ctx.getWebuiViews().get(runtimeId) !== entry) return;
    entry.bridgeReady = false;
    ctx.setEntryWebuiStatus(entry, { runtimeId, status: 'loading' });
  });

  view.webContents.on('did-finish-load', () => {
    if (ctx.getWebuiViews().get(runtimeId) !== entry) return;
    ctx.schedulePendingWebuiFlush(entry);
    try {
      entry.view.webContents.send('desktop:webui-locale-changed', ctx.getI18n().getMainLocale());
    } catch {
      /* webui was destroyed mid-send */
    }
  });

  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (ctx.getWebuiViews().get(runtimeId) !== entry || errorCode === -3) return;
    ctx.setEntryWebuiStatus(entry, {
      runtimeId,
      status: 'error',
      error: errorDescription,
    });
  });

  view.webContents.on('render-process-gone', (_event, details) => {
    if (ctx.getWebuiViews().get(runtimeId) !== entry) return;
    ctx.setEntryWebuiStatus(entry, {
      runtimeId,
      status: 'error',
      error: `WebUI renderer exited: ${details.reason}`,
    });
  });

  ctx.getWebuiViews().set(runtimeId, entry);
  return entry;
}

/**
 * Attach a WebUI view to the main window.
 */
export function attachWebuiEntry(
  ctx: ViewManagerContext,
  entry: DesktopWebuiRuntimeView,
): void {
  const mainWindow = ctx.getMainWindow();
  if (!mainWindow) return;
  if (entry.attached) return;
  mainWindow.contentView.addChildView(entry.view);
  entry.attached = true;
}

/**
 * Remove a WebUI view and clean up resources.
 */
export function disposeWebuiEntry(
  ctx: ViewManagerContext,
  entry: DesktopWebuiRuntimeView,
): void {
  ctx.getWebuiViews().delete(entry.runtimeId);
  entry.pendingCommands.length = 0;

  if (entry.pendingFlushTimer) {
    clearTimeout(entry.pendingFlushTimer);
    entry.pendingFlushTimer = null;
  }

  const mainWindow = ctx.getMainWindow();
  if (mainWindow && entry.attached) {
    mainWindow.contentView.removeChildView(entry.view);
  }
  entry.attached = false;

  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close();
  }

  if (ctx.getActiveWebuiRuntimeId() === entry.runtimeId) {
    // Will be set to null by caller
  }
}

/**
 * Remove all WebUI views for runtimes that are no longer running.
 */
export function pruneWebuiEntries(
  ctx: ViewManagerContext,
  runtimeIds: string[],
): void {
  const live = new Set(runtimeIds);
  for (const [id, entry] of ctx.getWebuiViews()) {
    if (!live.has(id)) {
      disposeWebuiEntry(ctx, entry);
    }
  }
}
