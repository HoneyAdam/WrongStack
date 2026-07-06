/**
 * Sidebar width calculation and WebUI view layout.
 */
import type { BaseWindow, WebContentsView } from 'electron';
import type { IRuntimeManager } from '../state/types.js';
import {
  SIDEBAR_WIDTH_WIDE,
  SIDEBAR_WIDTH_MEDIUM,
  SIDEBAR_WIDTH_NARROW,
  SIDEBAR_WIDTH_COLLAPSED,
} from '../state/constants.js';

export interface SidebarContext {
  getMainWindow(): BaseWindow | null;
  getShellView(): WebContentsView | null;
  getRuntimeManager(): IRuntimeManager;
  getShellSidebarCollapsed(): boolean;
  getWebuiViews(): Map<string, import('../state/types.js').DesktopWebuiRuntimeView>;
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
 * Layout all WebUI views within the main window.
 * Only the active runtime's view is visible, others are hidden.
 */
export function layoutWebuiViews(ctx: SidebarContext, windowWidth?: number, windowHeight?: number): void {
  const mainWindow = ctx.getMainWindow();
  if (!mainWindow) return;

  const size = mainWindow.getContentSize();
  const width = windowWidth ?? size[0] ?? 0;
  const height = windowHeight ?? size[1] ?? 0;

  const snapshot = ctx.getRuntimeManager().snapshot();
  const active = snapshot.runtimes.find((runtime) => runtime.id === snapshot.activeRuntimeId);
  const sidebarWidth = getSidebarWidth(width, ctx.getShellSidebarCollapsed());
  const contentWidth = Math.max(0, width - sidebarWidth);

  for (const entry of ctx.getWebuiViews().values()) {
    if (active?.id === entry.runtimeId && active.status === 'running') {
      entry.view.setBounds({ x: sidebarWidth, y: 0, width: contentWidth, height });
    } else {
      entry.view.setBounds({ x: sidebarWidth, y: 0, width: 0, height });
    }
  }
}
