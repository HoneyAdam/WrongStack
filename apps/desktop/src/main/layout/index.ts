/**
 * Layout management for the desktop shell.
 * Handles window sizing, sidebar dimensions, and view arrangement.
 */
import type { BaseWindow, WebContentsView } from 'electron';
import type { IRuntimeManager } from '../state/types.js';
import {
  SIDEBAR_WIDTH_WIDE,
  SIDEBAR_WIDTH_MEDIUM,
  SIDEBAR_WIDTH_NARROW,
  SIDEBAR_WIDTH_COLLAPSED,
} from '../state/constants.js';

export { getSidebarWidth } from './sidebar.js';

/**
 * Main layout function - updates both shell view and webui views.
 */
export function layoutViews(
  mainWindow: BaseWindow | null,
  shellView: WebContentsView | null,
  runtimeManager: IRuntimeManager,
  shellSidebarCollapsed: boolean,
  webuiViews: Map<string, { runtimeId: string; view: WebContentsView }>,
): void {
  if (!mainWindow || !shellView) return;

  const size = mainWindow.getContentSize();
  const width = size[0] ?? 0;
  const height = size[1] ?? 0;

  shellView.setBounds({ x: 0, y: 0, width, height });
  layoutWebuiViews(mainWindow, runtimeManager, shellSidebarCollapsed, webuiViews, width, height);
}

/**
 * Layout all WebUI views within the main window.
 * Only the active runtime's view is visible, others are hidden.
 */
export function layoutWebuiViews(
  mainWindow: BaseWindow | null,
  runtimeManager: IRuntimeManager,
  shellSidebarCollapsed: boolean,
  webuiViews: Map<string, { runtimeId: string; view: WebContentsView }>,
  windowWidth?: number,
  windowHeight?: number,
): void {
  if (!mainWindow) return;

  const size = mainWindow.getContentSize();
  const width = windowWidth ?? size[0] ?? 0;
  const height = windowHeight ?? size[1] ?? 0;

  const snapshot = runtimeManager.snapshot();
  const active = snapshot.runtimes.find((runtime) => runtime.id === snapshot.activeRuntimeId);
  const sidebarWidth = getSidebarWidth(width, shellSidebarCollapsed);
  const contentWidth = Math.max(0, width - sidebarWidth);

  for (const entry of webuiViews.values()) {
    const runtime = snapshot.runtimes.find((r) => r.id === entry.runtimeId);
    if (active?.id === entry.runtimeId && runtime?.status === 'running') {
      entry.view.setBounds({ x: sidebarWidth, y: 0, width: contentWidth, height });
    } else {
      entry.view.setBounds({ x: sidebarWidth, y: 0, width: 0, height });
    }
  }
}

/**
 * Calculate the sidebar width based on window width and collapse state.
 */
export function getSidebarWidth(windowWidth: number, collapsed: boolean): number {
  if (collapsed) return SIDEBAR_WIDTH_COLLAPSED;
  if (windowWidth < 900) return SIDEBAR_WIDTH_NARROW;
  if (windowWidth < 1180) return SIDEBAR_WIDTH_MEDIUM;
  return SIDEBAR_WIDTH_WIDE;
}

/**
 * Schedule a window state save with debouncing.
 */
export function scheduleWindowStateSave(
  saveState: () => Promise<void>,
  timerRef: { current: ReturnType<typeof setTimeout> | null },
): void {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    void saveState();
  }, 350);
}
