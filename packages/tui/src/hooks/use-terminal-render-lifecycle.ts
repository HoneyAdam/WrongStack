import { writeOut } from '@wrongstack/core/utils';
import React, {
  type Dispatch,
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type { Action, State } from '../app-state.js';

/** Owns terminal live-region cleanup and resize-safe panel restoration. */
export function useTerminalRenderLifecycle(
  state: State,
  stateRef: MutableRefObject<State>,
  dispatch: Dispatch<Action>,
): void {
  // Live-region shrink mitigation. Ink's log-update tracks the previous
  // render's logical line count; when content visually wraps past the
  // terminal width, the visual-row count exceeds the logical count and
  // log-update's clear-and-rewrite leaves the extra visual rows behind.
  // Those extras then slide into native scrollback as the next render
  // commits new Static items above the live region — looking to the user
  // like an extra echo of the input (the empty input sliding into
  // scrollback when Enter is pressed without text).
  //
  // We can't reach log-update directly, but we can issue an erase-below-
  // cursor (\x1b[J) at the moments most likely to leak: when a picker /
  // dialog transitions from open → closed (the live region's height
  // drops sharply), when a fresh history entry was just committed, and
  // when the terminal resizes (Ink re-renders the live region but the
  // cleanup logic above doesn't fire since none of its deps changed).
  // \x1b[J only touches what's below the cursor, so committed Static
  // history above is preserved.
  const prevAnyOverlayOpen = useRef(false);
  const prevEntriesCount = useRef(0);
  // Track tool-stream text length so we can fire eraseLiveRegion when the
  // live tool-output box grows — prevents the ◆ bash ⏱ Xms header line
  // from duplicating into scrollback on every 500ms tick.
  const prevToolStreamLen = useRef(0);
  // Stable erase function — only calls process.stdout.write which is a stable global.
  const eraseLiveRegion = useCallback(() => {
    try {
      // \x1b[J = erase from cursor to end of screen. The cursor sits at the
      // top of log-update's live region, so this clears the stale live
      // region only and leaves committed Static history (in scrollback)
      // untouched. Do NOT prefix with \x1b[H: homing to (0,0) wipes the
      // visible committed output and forces the input/status bar to redraw
      // at the top of the viewport instead of staying pinned to the bottom.
      writeOut('\x1b[J');
    } catch {
      // stdout might be detached during shutdown — ignore.
    }
  }, []);
  // useLayoutEffect fires synchronously in the commit phase, BEFORE Ink
  // flushes the new tree to the terminal. This means \x1b[J cleans the old
  // live region BEFORE new Static items are written — preventing stale
  // input/statusbar content from bleeding into scrollback.
  // useEffect (async microtask) was too late: the terminal had already
  // scrolled the old content into scrollback by the time it fired.
  React.useLayoutEffect(() => {
    const anyOpenNow =
      state.picker.open ||
      state.slashPicker.open ||
      state.modelPicker.open ||
      state.autonomyPicker.open ||
      state.designPicker.open ||
      state.resumePicker.open ||
      state.settingsPicker.open ||
      state.enhanceBusy ||
      state.enhance != null ||
      state.refineFailure != null ||
      state.continueConfirm != null ||
      state.clearConfirm != null ||
      state.slashConfirm != null ||
      state.coordinator.monitorOpen ||
      state.escConfirm != null ||
      state.sendModePicker != null ||
      state.confirmQueue.length > 0 ||
      state.shellCommandWarning != null ||
      state.brainPrompt != null;
    const overlayClosed = prevAnyOverlayOpen.current && !anyOpenNow;
    const newEntryCommitted = state.entries.length > prevEntriesCount.current;
    const curToolStreamLen = state.toolStream?.text.length ?? 0;
    const toolStreamGrew = curToolStreamLen > 0 && curToolStreamLen > prevToolStreamLen.current;
    prevAnyOverlayOpen.current = anyOpenNow;
    prevEntriesCount.current = state.entries.length;
    prevToolStreamLen.current = curToolStreamLen;
    if (overlayClosed || newEntryCommitted || toolStreamGrew) {
      eraseLiveRegion();
    }
  }, [
    state.picker.open,
    state.slashPicker.open,
    state.modelPicker.open,
    state.autonomyPicker.open,
    state.designPicker.open,
    state.settingsPicker.open,
    state.enhanceBusy,
    state.enhance,
    state.refineFailure,
    state.continueConfirm,
    state.clearConfirm,
    state.slashConfirm,
    state.coordinator.monitorOpen,
    state.escConfirm,
    state.sendModePicker,
    state.confirmQueue.length,
    state.shellCommandWarning,
    state.brainPrompt,
    state.entries.length,
    state.toolStream?.text,
    eraseLiveRegion,
  ]);

  // ── Terminal resize: close panels, let terminal settle, restore ──
  // When the terminal resizes, the terminal itself reflows visible text
  // BEFORE Ink can react. This reflow corrupts rendered content (Unicode
  // borders, ANSI-styled text, wrapped input) in a way that scrolls into
  // the terminal's native scrollback before Ink's next render can fix it.
  // By closing all overlays BEFORE the reflow, the live region shrinks to
  // its minimal height (input + status bar), which resizes cleanly. After
  // a short debounce the panels are restored at the new dimensions.
  const resizeGateRef = useRef(0);
  const preResizePanelsRef = useRef<{
    settings: boolean;
    projectPicker: boolean;
    help: boolean;
    monitor: boolean;
    agents: boolean;
    worktree: boolean;
    todos: boolean;
    queue: boolean;
    processList: boolean;
    cronMonitor: boolean;
    planPanel: boolean;
    kanbanPanel: boolean;
    goalPanel: boolean;
    sessionsPanel: boolean;
    coordinator: boolean;
  } | null>(null);
  const resizeRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    const handleResize = () => {
      // Debounce: terminal emitters often fire 2-3 resize events in quick
      // succession during a drag. Gate to one "close" cycle per burst, plus
      // one final "restore" at the end.
      const seq = ++resizeGateRef.current;

      // Capture current panel state from the latest render.
      preResizePanelsRef.current = {
        settings: stateRef.current.settingsPicker.open,
        projectPicker: stateRef.current.projectPicker.open,
        help: stateRef.current.helpOpen,
        monitor: stateRef.current.monitorOpen,
        agents: stateRef.current.agentsMonitorOpen,
        worktree: stateRef.current.worktreeMonitorOpen,
        todos: stateRef.current.todosMonitorOpen,
        queue: stateRef.current.queuePanelOpen,
        processList: stateRef.current.processListOpen,
        cronMonitor: stateRef.current.cronMonitorOpen,
        planPanel: stateRef.current.planPanelOpen,
        kanbanPanel: stateRef.current.kanbanPanelOpen,
        goalPanel: stateRef.current.goalPanelOpen,
        sessionsPanel: stateRef.current.sessionsPanelOpen,
        coordinator: stateRef.current.coordinator.monitorOpen,
      };

      // Close all open panels so the live region shrinks to input+statusbar.
      dispatch({ type: 'closeAllPanels' });
      // Close secondary overlays that closeAllPanels doesn't cover.
      if (stateRef.current.modelPicker.open) dispatch({ type: 'modelPickerClose' });
      if (stateRef.current.autonomyPicker.open) dispatch({ type: 'autonomyPickerClose' });
      if (stateRef.current.designPicker.open) dispatch({ type: 'designPickerClose' });
      if (stateRef.current.promptPicker.open) dispatch({ type: 'promptPickerClose' });
      if (stateRef.current.resumePicker.open) dispatch({ type: 'resumePickerClose' });
      if (stateRef.current.slashPicker.open) dispatch({ type: 'slashPickerClose' });
      if (stateRef.current.picker.open) dispatch({ type: 'pickerClose' });
      if (stateRef.current.rewindOverlay) dispatch({ type: 'rewindOverlayClose' });

      eraseLiveRegion();

      // After the terminal settles at the new size, restore panels that
      // were open. The 300ms delay gives Ink time to re-render the minimal
      // live region at the new width before we grow it again.
      resizeRestoreTimerRef.current = setTimeout(() => {
        // Guard: if the component unmounted, don't dispatch.
        if (!mountedRef.current) return;
        // If another resize happened while we waited, discard this restore.
        if (resizeGateRef.current !== seq) return;
        const prev = preResizePanelsRef.current;
        if (!prev) return;
        if (prev.settings) {
          const sp = stateRef.current.settingsPicker;
          dispatch({
            type: 'settingsOpen',
            mode: sp.mode,
            delayMs: sp.delayMs,
            titleAnimation: sp.titleAnimation,
            yolo: sp.yolo,
            fleetChat: sp.fleetChat,
            chime: sp.chime,
            confirmExit: sp.confirmExit,
            nextPrediction: sp.nextPrediction,
            featureMcp: sp.featureMcp,
            featurePlugins: sp.featurePlugins,
            featureMemory: sp.featureMemory,
            featureSkills: sp.featureSkills,
            featureModelsRegistry: sp.featureModelsRegistry,
            tokenSavingTier: sp.tokenSavingTier,
            allowOutsideProjectRoot: sp.allowOutsideProjectRoot,
            contextAutoCompact: sp.contextAutoCompact,
            contextStrategy: sp.contextStrategy,
            contextMode: sp.contextMode,
            maxConcurrent: sp.maxConcurrent,
            logLevel: sp.logLevel,
            auditLevel: sp.auditLevel,
            indexOnStart: sp.indexOnStart,
            multiDiffSummaryThreshold: sp.multiDiffSummaryThreshold,
            lastSettingsField: sp.lastSettingsField,
            maxIterations: sp.maxIterations,
            autoProceedMaxIterations: sp.autoProceedMaxIterations,
            enhanceDelayMs: sp.enhanceDelayMs,
            enhanceEnabled: sp.enhanceEnabled,
            enhanceLanguage: sp.enhanceLanguage,
            debugStream: sp.debugStream,
            statuslineMode: sp.statuslineMode,
            reasoningMode: sp.reasoningMode,
            reasoningEffort: sp.reasoningEffort,
            reasoningPreserve: sp.reasoningPreserve,
            thinkingWord: sp.thinkingWord,
            cacheTtl: sp.cacheTtl,
            configScope: sp.configScope,
            animationStyle: sp.animationStyle,
            breakerEnabled: sp.breakerEnabled,
            breakerAutoKillResetMs: sp.breakerAutoKillResetMs,
            showModelReasoning: sp.showModelReasoning,
          });
        }
        if (prev.projectPicker) {
          const pp = stateRef.current.projectPicker;
          dispatch({ type: 'projectPickerOpen', items: pp.allItems });
        }
        if (prev.help) dispatch({ type: 'toggleHelp' });
        if (prev.monitor) dispatch({ type: 'toggleMonitor' });
        if (prev.agents) dispatch({ type: 'toggleAgentsMonitor' });
        if (prev.worktree) dispatch({ type: 'toggleWorktreeMonitor' });
        if (prev.todos) dispatch({ type: 'toggleTodosMonitor' });
        if (prev.queue) dispatch({ type: 'toggleQueuePanel' });
        if (prev.processList) dispatch({ type: 'toggleProcessList' });
        if (prev.cronMonitor) dispatch({ type: 'toggleCronMonitor' });
        if (prev.planPanel) dispatch({ type: 'togglePlanPanel' });
        if (prev.kanbanPanel) dispatch({ type: 'toggleKanbanPanel' });
        if (prev.goalPanel) dispatch({ type: 'toggleGoalPanel' });
        if (prev.sessionsPanel) dispatch({ type: 'toggleSessionsPanel' });
        if (prev.coordinator) dispatch({ type: 'toggleCoordinatorMonitor' });
        preResizePanelsRef.current = null;
        resizeRestoreTimerRef.current = null;
      }, 300);
    };

    process.stdout.on('resize', handleResize);
    return () => {
      // Clear any pending resize-restore timer and mark the component
      // as unmounted so the callback doesn't dispatch to a dead reducer.
      if (resizeRestoreTimerRef.current) {
        clearTimeout(resizeRestoreTimerRef.current);
        resizeRestoreTimerRef.current = null;
      }
      mountedRef.current = false;
      process.stdout.off('resize', handleResize);
    };
  }, [eraseLiveRegion]);

  // While the prompt-refinement flow is active, the EnhancePanel's countdown
  // re-renders the live region every second. In inline mode each redraw can
  // bleed the region's top rows into native scrollback, so the preview
  // "clones" itself. Erase the stale region before every paint — no dep
  // array so this runs pre-flush on *every* render, not just state transitions.
  React.useLayoutEffect(() => {
    if (
      state.enhanceBusy ||
      state.enhance != null ||
      state.refineFailure != null ||
      state.continueConfirm != null
    )
      eraseLiveRegion();
  });

}
