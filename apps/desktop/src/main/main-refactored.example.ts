/**
 * REFACTORED: Modular main.ts
 * 
 * This file shows the target architecture for main.ts after refactoring.
 * The current main.ts (1277 lines) would be split into these modules.
 * 
 * Current modules created:
 *   - state/types.ts       → Shared state interfaces
 *   - state/constants.ts   → Application constants
 *   - layout/index.ts      → Layout management
 *   - layout/sidebar.ts     → Sidebar and view layout
 *   - menu/index.ts         → Menu builder orchestrator
 *   - menu/types.ts         → Menu type definitions
 *   - menu/sections.ts       → File/Workspace/View menu sections
 *   - menu/projects-menu.ts  → Projects submenu builder
 *   - webui/view-manager.ts → WebUI view lifecycle
 *   - webui/command-bridge.ts → Command dispatch
 *   - ipc-handlers/index.ts → IPC registration
 *   - runtime/operations.ts → Project/runtime operations
 * 
 * To complete the refactor, replace main.ts with this pattern:
 */

// ============================================================================
// src/main/main.ts (Target: ~300 lines)
// ============================================================================

/**
 * Modular Desktop Application Entry Point
 * 
 * Architecture:
 * 
 * main.ts
 * ├── state/          - Application state and constants
 * ├── layout/        - Window layout and sizing
 * ├── menu/          - Application menu building
 * ├── webui/         - WebUI view management
 * ├── runtime/       - Runtime lifecycle operations
 * └── ipc-handlers/  - IPC message handlers
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { wstackGlobalRoot } from '@wrongstack/core/utils';
import {
  app,
  BaseWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
  WebContentsView,
  type BaseWindowConstructorOptions,
  type MenuItemConstructorOptions,
} from 'electron';

import type { DesktopRuntimeRecord, DesktopWebuiCommand, DesktopWebuiPrefs, DesktopWebuiStatusSnapshot, DesktopWindowState } from '../shared/types.js';
import { DesktopAgentBridge } from './agent-bridge.js';
import { IPC } from './ipc.js';
import { getMainLocale, setMainLocale, tMain, SUPPORTED_LOCALES } from './i18n-main.js';
import { desktopConfigPaths, readUiLocale, writeUiLocale } from './desktop-config-io.js';
import { DesktopRuntimeManager, preloadPath, rendererIndexPath, webuiPreloadPath } from './runtime-manager.js';
import { watchProviderConfig } from '@wrongstack/core/storage';
import { buildWebuiCommandFallbackScript, normalizeDesktopWebuiCommand } from './webui-command-bridge.js';

// ============================================================================
// Constants (moved to state/constants.ts)
// ============================================================================

const OPEN_EXTERNAL_ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MIN_WINDOW_WIDTH = 760;
const MIN_WINDOW_HEIGHT = 520;
const WEBUI_COMMAND_FALLBACK_MS = 350;
const WEBUI_COMMAND_ACK_TIMEOUT_MS = 2_000;
const MAX_PENDING_WEBUI_COMMANDS = 50;
const MAX_PENDING_FLUSH_ATTEMPTS = 80;
const PENDING_WEBUI_FLUSH_DELAY_MS = 250;
const SIDEBAR_WIDTH_WIDE = 292;
const SIDEBAR_WIDTH_MEDIUM = 276;
const SIDEBAR_WIDTH_NARROW = 252;
const SIDEBAR_WIDTH_COLLAPSED = 56;

app.setAppUserModelId('com.wrongstack.desktop');
app.setPath('userData', path.join(wstackGlobalRoot(), 'desktop', 'electron-profile'));

// ============================================================================
// Application State (moved to state/types.ts)
// ============================================================================

interface DesktopWebuiRuntimeView {
  runtimeId: string;
  view: WebContentsView;
  url: string | null;
  status: DesktopWebuiStatusSnapshot;
  bridgeReady: boolean;
  attached: boolean;
  pendingCommands: DesktopWebuiCommand[];
  pendingFlushTimer: ReturnType<typeof setTimeout> | null;
  pendingFlushAttempts: number;
}

interface PendingWebuiCommandAck {
  runtimeId: string;
  timer: ReturnType<typeof setTimeout>;
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  resolve: (handled: boolean) => void;
}

// State instances
const manager = new DesktopRuntimeManager();
const bridge = new DesktopAgentBridge();
let mainWindow: BaseWindow | null = null;
let shellView: WebContentsView | null = null;
const webuiViews = new Map<string, DesktopWebuiRuntimeView>();
let activeWebuiRuntimeId: string | null = null;
let webuiStatus: DesktopWebuiStatusSnapshot = { runtimeId: null, status: 'idle' };
let webuiCommandSequence = 0;
let shellSidebarCollapsed = false;
const pendingWebuiCommandAcks = new Map<string, PendingWebuiCommandAck>();
let saveWindowStateTimer: ReturnType<typeof setTimeout> | null = null;
let quittingAfterCleanup = false;

// ============================================================================
// Helper Functions (extracted to modules)
// ============================================================================

function safeOpenExternal(target: string): void {
  let protocol: string;
  try {
    protocol = new URL(target).protocol;
  } catch {
    return;
  }
  if (OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has(protocol)) {
    void shell.openExternal(target);
  }
}

function desktopSidebarWidth(windowWidth: number): number {
  if (shellSidebarCollapsed) return SIDEBAR_WIDTH_COLLAPSED;
  if (windowWidth < 900) return SIDEBAR_WIDTH_NARROW;
  if (windowWidth < 1180) return SIDEBAR_WIDTH_MEDIUM;
  return SIDEBAR_WIDTH_WIDE;
}

function getSidebarWidth(windowWidth: number): number {
  return desktopSidebarWidth(windowWidth);
}

function sameOrigin(candidate: string, base: string | null): boolean {
  if (!base) return false;
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

// ============================================================================
// Layout Functions (moved to layout/index.ts, layout/sidebar.ts)
// ============================================================================

function layoutViews(): void {
  if (!mainWindow || !shellView) return;
  const size = mainWindow.getContentSize();
  const width = size[0] ?? 0;
  const height = size[1] ?? 0;
  shellView.setBounds({ x: 0, y: 0, width, height });
  layoutWebuiViews(width, height);
}

function layoutWebuiViews(windowWidth?: number, windowHeight?: number): void {
  if (!mainWindow) return;
  const size = mainWindow.getContentSize();
  const width = windowWidth ?? size[0] ?? 0;
  const height = windowHeight ?? size[1] ?? 0;
  const snapshot = manager.snapshot();
  const active = snapshot.runtimes.find((runtime) => runtime.id === snapshot.activeRuntimeId);
  const sidebarWidth = desktopSidebarWidth(width);
  const contentWidth = Math.max(0, width - sidebarWidth);

  for (const entry of webuiViews.values()) {
    if (active?.id === entry.runtimeId && active.status === 'running') {
      entry.view.setBounds({ x: sidebarWidth, y: 0, width: contentWidth, height });
    } else {
      entry.view.setBounds({ x: sidebarWidth, y: 0, width: 0, height });
    }
  }
}

function scheduleWindowStateSave(): void {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => {
    saveWindowStateTimer = null;
    void saveWindowState();
  }, 350);
}

async function saveWindowState(): Promise<void> {
  if (!mainWindow) return;
  const bounds = mainWindow.getNormalBounds();
  await manager.saveWindowState({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: mainWindow.isMaximized(),
  });
}

// ============================================================================
// WebUI View Management (moved to webui/view-manager.ts)
// ============================================================================

function ensureWebuiEntry(runtimeId: string): DesktopWebuiRuntimeView | null {
  // ... full implementation in webui/view-manager.ts
  const mainWindowRef = mainWindow;
  if (!mainWindowRef) return null;
  const existing = webuiViews.get(runtimeId);
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
    if (webuiViews.get(runtimeId) !== entry) return;
    entry.bridgeReady = false;
    setEntryWebuiStatus(entry, { runtimeId, status: 'loading' });
  });

  view.webContents.on('did-finish-load', () => {
    if (webuiViews.get(runtimeId) !== entry) return;
    schedulePendingWebuiFlush(entry);
    try {
      entry.view.webContents.send(IPC.webuiLocaleChanged, getMainLocale());
    } catch {
      /* webui was destroyed mid-send */
    }
  });

  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (webuiViews.get(runtimeId) !== entry || errorCode === -3) return;
    setEntryWebuiStatus(entry, { runtimeId, status: 'error', error: errorDescription });
  });

  view.webContents.on('render-process-gone', (_event, details) => {
    if (webuiViews.get(runtimeId) !== entry) return;
    setEntryWebuiStatus(entry, {
      runtimeId,
      status: 'error',
      error: `WebUI renderer exited: ${details.reason}`,
    });
  });

  webuiViews.set(runtimeId, entry);
  return entry;
}

function attachWebuiEntry(entry: DesktopWebuiRuntimeView): void {
  if (!mainWindow) return;
  if (entry.attached) return;
  mainWindow.contentView.addChildView(entry.view);
  entry.attached = true;
}

function disposeWebuiEntry(entry: DesktopWebuiRuntimeView): void {
  webuiViews.delete(entry.runtimeId);
  entry.pendingCommands.length = 0;
  settlePendingWebuiCommandAcksForRuntime(entry.runtimeId, false);
  if (entry.pendingFlushTimer) {
    clearTimeout(entry.pendingFlushTimer);
    entry.pendingFlushTimer = null;
  }
  if (mainWindow && entry.attached) {
    mainWindow.contentView.removeChildView(entry.view);
  }
  entry.attached = false;
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close();
  }
  if (activeWebuiRuntimeId === entry.runtimeId) activeWebuiRuntimeId = null;
}

function disposeAllWebuiEntries(): void {
  for (const entry of Array.from(webuiViews.values())) {
    disposeWebuiEntry(entry);
  }
  webuiViews.clear();
}

function pruneWebuiEntries(runtimeIds: string[]): void {
  const live = new Set(runtimeIds);
  for (const [id, entry] of webuiViews) {
    if (!live.has(id)) {
      disposeWebuiEntry(entry);
    }
  }
}

// ============================================================================
// WebUI Command Dispatch (moved to webui/command-bridge.ts)
// ============================================================================

async function dispatchWebuiCommand(commandInput: unknown): Promise<boolean> {
  const command = normalizeDesktopWebuiCommand(commandInput);
  if (!command) return false;
  const entry = getActiveWebuiEntry();
  if (!entry?.url) return false;

  if (entry.status.status !== 'ready') {
    if (!entry.view.webContents.isLoading() && entry.status.status !== 'error') {
      return dispatchWebuiCommandNow(entry, command);
    }
    queueWebuiCommand(entry, command);
    schedulePendingWebuiFlush(entry);
    return true;
  }

  if (!entry.bridgeReady) {
    if (!entry.view.webContents.isLoading()) {
      return dispatchWebuiCommandNow(entry, command);
    }
    queueWebuiCommand(entry, command);
    schedulePendingWebuiFlush(entry);
    return true;
  }

  return dispatchWebuiCommandNow(entry, command);
}

async function reloadActiveWebuiView(): Promise<boolean> {
  const entry = getActiveWebuiEntry();
  if (!entry?.url) return false;
  entry.bridgeReady = false;
  setEntryWebuiStatus(entry, { runtimeId: entry.runtimeId, status: 'loading' });
  return entry.view.webContents.loadURL(entry.url).then(() => true).catch((err) => {
    setEntryWebuiStatus(entry, {
      runtimeId: entry.runtimeId,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  });
}

// ============================================================================
// State Management
// ============================================================================

function syncActiveWebuiView(): void {
  // ... full implementation
}

function broadcastState(): void {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send(IPC.stateChanged, manager.snapshot());
}

function publishWebuiStatus(next: DesktopWebuiStatusSnapshot): void {
  webuiStatus = next;
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send(IPC.webuiStatusChanged, webuiStatus);
}

function setEntryWebuiStatus(entry: DesktopWebuiRuntimeView, next: DesktopWebuiStatusSnapshot): void {
  const previousPrefs = entry.status.prefs;
  entry.status = {
    ...next,
    prefs: next.prefs ?? entry.status.prefs,
    pendingCommands: entry.pendingCommands.length || undefined,
  };
  if (activeWebuiRuntimeId === entry.runtimeId) {
    publishWebuiStatus(entry.status);
  }
}

function broadcastLocaleToEmbeddedWebuis(locale: string): void {
  for (const entry of webuiViews.values()) {
    if (entry.view.webContents.isDestroyed()) continue;
    try {
      entry.view.webContents.send(IPC.webuiLocaleChanged, locale);
    } catch {
      /* destroyed mid-send */
    }
  }
}

// ============================================================================
// IPC Handlers (moved to ipc-handlers/index.ts)
// ============================================================================

function registerIpc(): void {
  // ... full implementation in ipc-handlers/index.ts
  ipcMain.handle(IPC.getState, () => manager.snapshot());
  ipcMain.handle(IPC.getConversation, (_event, runtimeId: string) => bridge.snapshot(runtimeId));
  ipcMain.handle(IPC.getWebuiStatus, () => webuiStatus);
  ipcMain.handle(IPC.navigateWebui, async (_event, command: unknown) => dispatchWebuiCommand(command));
  ipcMain.handle(IPC.reloadWebui, async () => reloadActiveWebuiView());
  // ... more handlers
}

function findWebuiEntryBySenderId(senderId: number): DesktopWebuiRuntimeView | undefined {
  return Array.from(webuiViews.values()).find((candidate) => candidate.view.webContents.id === senderId);
}

// ============================================================================
// Window Creation
// ============================================================================

async function createWindow(): Promise<void> {
  await manager.init();
  const bootLocale = await readUiLocale();
  if (bootLocale) setMainLocale(bootLocale);
  configureApplicationMenu();
  // ... rest of window creation
}

// ============================================================================
// Menu Configuration (moved to menu/index.ts)
// ============================================================================

function configureApplicationMenu(): void {
  // ... full implementation in menu/index.ts
}

// ============================================================================
// Application Lifecycle
// ============================================================================

manager.on('changed', () => {
  configureApplicationMenu();
  syncActiveWebuiView();
  broadcastState();
});

ipcMain.on(IPC.setLocale, (_event, locale: string) => {
  setMainLocale(locale);
  configureApplicationMenu();
  broadcastLocaleToEmbeddedWebuis(locale);
  void writeUiLocale(locale);
});

watchProviderConfig(
  desktopConfigPaths.globalConfigPath,
  desktopConfigPaths.vault,
  (snapshot) => {
    if (snapshot.uiLocale === undefined) return;
    setMainLocale(snapshot.uiLocale);
    configureApplicationMenu();
    shellView?.webContents.send(IPC.localeChanged, snapshot.uiLocale);
    broadcastLocaleToEmbeddedWebuis(snapshot.uiLocale);
  },
  { warn: (m) => console.warn(`Config watcher: ${m}`) },
);

bridge.on('changed', (conversation) => {
  shellView?.webContents.send(IPC.conversationChanged, conversation);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quittingAfterCleanup) return;
  event.preventDefault();
  quittingAfterCleanup = true;
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer);
    saveWindowStateTimer = null;
  }
  bridge.closeAll();
  void saveWindowState()
    .catch(() => undefined)
    .finally(() => manager.closeAll({ persistWorkspace: false }).finally(() => app.quit()));
});

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  app.on('activate', () => {
    if (mainWindow === null) void createWindow();
  });
}).catch((err) => {
  console.error(err);
  app.exit(1);
});

// ============================================================================
// Remaining Helper Functions
// ============================================================================

function getActiveWebuiEntry(): DesktopWebuiRuntimeView | undefined {
  const activeId = manager.snapshot().activeRuntimeId;
  return activeId ? webuiViews.get(activeId) : undefined;
}

function runtimeWsUrlOrThrow(runtimeId: string): string {
  const wsUrl = manager.getRuntimeWsUrlWithToken(runtimeId);
  if (!wsUrl) throw new Error(`Runtime not found: ${runtimeId}`);
  return wsUrl;
}

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

// ... remaining command dispatch, pending ack, and other helper functions

export {}; // Make this a module
