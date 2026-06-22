import type { Action } from './app-reducer.js';
import type { StatuslineItem } from './components/statusline-picker.js';

export type FKeyPanelAction =
  | 'projectPickerOpen'
  | 'toggleMonitor'
  | 'toggleAgentsMonitor'
  | 'toggleWorktreeMonitor'
  | 'togglePlanPanel'
  | 'toggleTodosMonitor'
  | 'toggleQueuePanel'
  | 'toggleProcessList'
  | 'toggleGoalPanel'
  | 'toggleSessionsPanel'
  | 'toggleCoordinatorMonitor'
  | 'statuslineOpen';

/** A single F-key panel entry shared by the picker, help overlay, and tests. */
export interface FKeyPanelEntry {
  key: number;
  label: string;
  action: FKeyPanelAction;
  /** Shortcut label for user-facing help, including Ctrl aliases when available. */
  helpKeys: string;
  /** Short user-facing description for the help overlay. */
  helpDescription: string;
}

/** All 12 F-key panels in order. */
export const F_KEY_PANEL_ENTRIES: readonly FKeyPanelEntry[] = [
  {
    key: 1,
    label: 'Project switcher',
    action: 'projectPickerOpen',
    helpKeys: 'F1 or /project',
    helpDescription: 'project switcher (F1 may open terminal help)',
  },
  {
    key: 2,
    label: 'Fleet orchestration monitor',
    action: 'toggleMonitor',
    helpKeys: 'F2 or /fleet',
    helpDescription: 'fleet monitor (Ctrl+F may be terminal Find)',
  },
  {
    key: 3,
    label: 'Agents live monitor',
    action: 'toggleAgentsMonitor',
    helpKeys: 'F3 or Ctrl+G',
    helpDescription: 'agents live monitor (F3 is safer)',
  },
  {
    key: 4,
    label: 'Worktree monitor',
    action: 'toggleWorktreeMonitor',
    helpKeys: 'F4 or /worktree',
    helpDescription: 'worktree monitor (Ctrl+T may be reserved)',
  },
  {
    key: 5,
    label: 'Plan panel',
    action: 'togglePlanPanel',
    helpKeys: 'F5 or /plan',
    helpDescription: 'plan panel (F5 may be host refresh/run)',
  },
  {
    key: 6,
    label: 'Todos monitor overlay',
    action: 'toggleTodosMonitor',
    helpKeys: 'F6',
    helpDescription: 'todos monitor overlay',
  },
  {
    key: 7,
    label: 'Queue panel',
    action: 'toggleQueuePanel',
    helpKeys: 'F7',
    helpDescription: 'queue panel',
  },
  {
    key: 8,
    label: 'Process list overlay',
    action: 'toggleProcessList',
    helpKeys: 'F8',
    helpDescription: 'process list overlay',
  },
  {
    key: 9,
    label: 'Goal panel',
    action: 'toggleGoalPanel',
    helpKeys: 'F9',
    helpDescription: 'goal panel',
  },
  {
    key: 10,
    label: 'Live sessions panel',
    action: 'toggleSessionsPanel',
    helpKeys: 'F10 or /resume',
    helpDescription: 'live sessions panel (F10 may open host menu)',
  },
  {
    key: 11,
    label: 'Coordinator monitor',
    action: 'toggleCoordinatorMonitor',
    helpKeys: 'F11 or /coordinator',
    helpDescription: 'coordinator monitor (F11 may toggle fullscreen)',
  },
  {
    key: 12,
    label: 'Status line picker',
    action: 'statuslineOpen',
    helpKeys: 'F12 or /sl',
    helpDescription: 'status line picker (F12 may be host/devtools)',
  },
];

type FKeyDispatchAction = Extract<
  Action,
  | { type: 'toggleMonitor' }
  | { type: 'toggleAgentsMonitor' }
  | { type: 'toggleWorktreeMonitor' }
  | { type: 'togglePlanPanel' }
  | { type: 'toggleTodosMonitor' }
  | { type: 'toggleQueuePanel' }
  | { type: 'toggleProcessList' }
  | { type: 'toggleGoalPanel' }
  | { type: 'toggleSessionsPanel' }
  | { type: 'toggleCoordinatorMonitor' }
  | { type: 'statuslineOpen' }
>;

const PAYLOAD_FREE_ACTIONS = new Set<FKeyPanelAction>([
  'toggleMonitor',
  'toggleAgentsMonitor',
  'toggleWorktreeMonitor',
  'togglePlanPanel',
  'toggleTodosMonitor',
  'toggleQueuePanel',
  'toggleProcessList',
  'toggleGoalPanel',
  'toggleSessionsPanel',
  'toggleCoordinatorMonitor',
]);

/**
 * Convert a picker entry into the reducer action it can dispatch directly.
 * Returns null for entries that need host-side work before dispatching, such as
 * F1/projectPickerOpen, which must load project items before opening.
 */
export function actionForFKeyPanel(
  entry: FKeyPanelEntry,
  hiddenItems: readonly StatuslineItem[] = [],
): FKeyDispatchAction | null {
  if (entry.action === 'projectPickerOpen') return null;
  if (entry.action === 'statuslineOpen') {
    return { type: 'statuslineOpen', hiddenItems: [...hiddenItems] };
  }
  if (PAYLOAD_FREE_ACTIONS.has(entry.action)) {
    return { type: entry.action } as FKeyDispatchAction;
  }
  return null;
}
