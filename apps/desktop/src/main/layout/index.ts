/**
 * Layout management for the desktop shell.
 * Handles window sizing, sidebar dimensions, and view arrangement.
 */
import type { BaseWindow, WebContentsView } from 'electron';
import type { IRuntimeManager } from '../state/types.js';
import { getSidebarWidth, layoutWebuiViews } from './sidebar.js';

export { getSidebarWidth } from './sidebar.js';

export interface LayoutContext {
  getMainWindow(): BaseWindow | null;
  getShellView(): WebContentsView | null;
  getRuntimeManager(): IRuntimeManager;
  getShellSidebarCollapsed(): boolean;
}

/**
 * Main layout function - updates both shell view and webui views.
 */
export function layoutViews(ctx: LayoutContext): void {
  const mainWindow = ctx.getMainWindow();
  const shellView = ctx.getShellView();
  if (!mainWindow || !shellView) return;

  const size = mainWindow.getContentSize();
  const width = size[0] ?? 0;
  const height = size[1] ?? 0;

  shellView.setBounds({ x: 0, y: 0, width, height });
  layoutWebuiViews(ctx, width, height);
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
