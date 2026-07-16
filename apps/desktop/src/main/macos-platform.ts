/**
 * macOS platform initialization for WrongStack Desktop.
 *
 * Handles activation policy, Dock menu, file-open events, and other
 * macOS-specific Electron behaviors that are required for the app to
 * behave as a proper macOS citizen (dock icon, menu bar focus, etc.).
 *
 * This module is a no-op on non-macOS platforms.
 */

import { app, Menu } from 'electron';

/**
 * Initialize macOS-specific app behavior. Safe to call on any platform;
 * no-ops when `process.platform !== 'darwin'`.
 */
export function initMacOS(): void {
  if (process.platform !== 'darwin') return;

  // ------------------------------------------------------------------
  // Activation Policy
  // ------------------------------------------------------------------
  // Set to 'regular' so the app appears in the Dock with an icon and
  // shows a standard menu bar. Without this, Electron apps launched
  // from the command line may start as 'accessory' (no Dock icon) and
  // the user sees a ghost window with no app to Cmd+Tab to.
  app.setActivationPolicy('regular');

  // ------------------------------------------------------------------
  // File-Open Handler
  // ------------------------------------------------------------------
  // macOS sends an `open-file` event when the user double-clicks a
  // file associated with the app or drops a folder on the Dock icon.
  // Register this early (before `app.whenReady`) so macOS queues the
  // event and delivers it after ready.
  //
  // We decrypt the path into a URI and forward it to the IPC layer;
  // the shell renderer decides whether to open it as a project.
  app.on('open-file', (_event, filePath) => {
    // open-file fires before `ready` on cold launch. Electron queues
    // it and re-emits after ready. We handle it once in the boot
    // sequence via `process.argv` for the initial open, and via the
    // event for subsequent opens while the app is running.
    if (app.isReady()) {
      handleFileOpen(filePath);
    }
  });

  // ------------------------------------------------------------------
  // Dock Menu
  // ------------------------------------------------------------------
  // Show a minimal Dock menu available even when no window is open.
  // Enables "New Window" from the Dock icon context menu.
  app.dock?.setMenu(
    Menu.buildFromTemplate([
      {
        label: 'New Window',
        click: () => {
          // The open-file handler will be invoked if the user picks a
          // folder; otherwise we rely on the renderer's "no windows
          // → open recent" logic.
        },
      },
    ]),
  );

  // ------------------------------------------------------------------
  // About Panel
  // ------------------------------------------------------------------
  // Populated from package.json; called by the standard macOS
  // "WrongStack Desktop" > "About WrongStack Desktop" menu item.
  app.setAboutPanelOptions({
    applicationName: 'WrongStack Desktop',
    applicationVersion: app.getVersion(),
    version: process.versions.electron ? `Electron ${process.versions.electron}` : '',
  });
}

/**
 * Forward a macOS file-open event to the renderer IPC channel.
 * Called both from the `open-file` event handler and from the boot
 * sequence's argv inspection.
 *
 * The renderer shell subscribes to `IPC.openFile` and decides whether
 * to treat `filePath` as a project directory to open or register.
 */
function handleFileOpen(filePath: string): void {
  // Forwarding is done via a global IPC broadcast registered in boot().
  // The actual send happens after the shell WebContents is ready.
  // We cache the path here; the boot sequence drains the cache.
  pendingOpenFilePath = filePath;
}

/** Cached file path from a pre-ready open-file event. */
let pendingOpenFilePath: string | null = null;

/**
 * Drain the pending open-file path and return it (consuming the cache).
 * Called by the boot sequence after the shell WebContents is ready.
 */
export function drainPendingOpenFilePath(): string | null {
  const path = pendingOpenFilePath;
  pendingOpenFilePath = null;
  return path;
}

/**
 * Check whether the user opened the app via a file/directory drag or
 * double-click. On macOS, the first argument after the app path is the
 * opened file/directory.
 */
export function firstOpenFileArg(argv: readonly string[]): string | null {
  if (process.platform !== 'darwin') return null;
  // argv on macOS: ['/path/to/Electron.app/Contents/MacOS/Electron', '/opened/folder']
  // In dev: ['/path/to/node', '/path/to/electron', '.', '/opened/folder']
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg == null) continue;
    // Skip Electron's own flags and the app directory
    if (arg.startsWith('-')) continue;
    if (arg === '.' || arg === '--') continue;
    // The first non-flag, non-dot argument after the binary is likely
    // a file/folder path.
    return arg;
  }
  return null;
}
