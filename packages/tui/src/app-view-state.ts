import type { State } from './app-state.js';
import { composerStatusFromState } from './components/composer-status-chip.js';
import { DEFAULT_INPUT_PROMPT, inputContentWidth } from './components/input.js';
import { layoutInputRows } from './input-tokens.js';

interface AppViewStateOptions {
  state: State;
  terminalColumns: number;
  displayThinkingWord: string;
  fleetRunning: number;
  liveAnimationStyle: State['settingsPicker']['animationStyle'];
}

/** Pure composer sizing/visibility and lower-panel projection. */
export function deriveAppViewState(options: AppViewStateOptions) {
  const { state, terminalColumns, displayThinkingWord, fleetRunning, liveAnimationStyle } = options;
  const inputHint =
    state.status === 'idle' && state.buffer.startsWith('/')
      ? 'slash command — Enter to dispatch'
      : '';
  const composerStatus = composerStatusFromState({
    status: state.status,
    confirmCount: state.confirmQueue.length,
    queueCount: state.queue.length,
    thinkingWord: displayThinkingWord,
    fleetRunning,
  });
  const composerAnimationStyle = state.settingsPicker.open
    ? state.settingsPicker.animationStyle
    : liveAnimationStyle;
  const enhanceActive = state.enhanceBusy || state.enhance != null;
  const inputHeight = Math.max(
    3,
    layoutInputRows(
      DEFAULT_INPUT_PROMPT,
      state.buffer,
      state.cursor,
      inputContentWidth(terminalColumns),
    ).length + 2,
  );
  const hideInput =
    enhanceActive ||
    state.refineFailure != null ||
    state.continueConfirm != null ||
    state.clearConfirm != null ||
    state.slashConfirm != null ||
    state.confirmQueue.length > 0 ||
    state.shellCommandWarning != null ||
    state.brainPrompt != null ||
    state.escConfirm != null ||
    state.sendModePicker != null ||
    state.helpOpen ||
    state.projectPicker.open ||
    state.monitorOpen ||
    state.agentsMonitorOpen ||
    state.worktreeMonitorOpen ||
    state.planPanelOpen ||
    state.todosMonitorOpen ||
    state.queuePanelOpen ||
    state.processListOpen ||
    state.goalPanelOpen ||
    state.contextPanelOpen ||
    state.sessionsPanelOpen ||
    state.authPanel.open;
  const lowerFunctionPanelOpen =
    state.monitorOpen ||
    state.agentsMonitorOpen ||
    (state.goalRun?.monitorOpen ?? false) ||
    state.worktreeMonitorOpen ||
    state.planPanelOpen ||
    state.kanbanPanelOpen ||
    state.todosMonitorOpen ||
    state.queuePanelOpen ||
    state.processListOpen ||
    state.goalPanelOpen ||
    state.sessionsPanelOpen;

  return {
    inputHint,
    composerStatus,
    composerAnimationStyle,
    inputHeight,
    hideInput,
    lowerFunctionPanelOpen,
  };
}
