/**
 * Sidebar width calculation utilities.
 * Main layout logic is in index.ts.
 */
import {
  SIDEBAR_WIDTH_WIDE,
  SIDEBAR_WIDTH_MEDIUM,
  SIDEBAR_WIDTH_NARROW,
  SIDEBAR_WIDTH_COLLAPSED,
} from '../state/constants.js';

/**
 * Calculate the sidebar width based on window width and collapse state.
 */
export function getSidebarWidth(windowWidth: number, collapsed: boolean): number {
  if (collapsed) return SIDEBAR_WIDTH_COLLAPSED;
  if (windowWidth < 900) return SIDEBAR_WIDTH_NARROW;
  if (windowWidth < 1180) return SIDEBAR_WIDTH_MEDIUM;
  return SIDEBAR_WIDTH_WIDE;
}
