import { useEffect } from 'react';
import type { Action } from '../app-reducer.js';

export interface FleetStreamController {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export interface EnhanceController {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export interface AgentsMonitorController {
  visible: boolean;
  setVisible: (visible: boolean) => void;
}

export interface UseTuiControllersOptions {
  dispatch: React.Dispatch<Action>;
  streamFleet: boolean;
  enhanceEnabled: boolean;
  agentsMonitorOpen: boolean;
  fleetStreamController?: FleetStreamController | undefined;
  enhanceController?: EnhanceController | undefined;
  agentsMonitorController?: AgentsMonitorController | undefined;
  /**
   * Mutable ref for opening TUI panels from slash commands. The slash commands
   * call `onPanelOpen.current(action)` to open panels. The App sets
   * `onPanelOpen.current` to its actual dispatch function on mount.
   */
  onPanelOpen?: { current: ((action: string) => boolean) | null } | undefined;
}

/**
 * Bridge mutable slash-command controllers into reducer-backed TUI state.
 *
 * These controllers are owned by the CLI/slash-command layer, but while the
 * TUI is mounted they should dispatch into React state instead of mutating
 * inert mirrors. On unmount we restore mirror-only setters for late callbacks.
 */
export function useTuiControllers({
  dispatch,
  streamFleet,
  enhanceEnabled,
  agentsMonitorOpen,
  fleetStreamController,
  enhanceController,
  agentsMonitorController,
  onPanelOpen,
}: UseTuiControllersOptions): void {
  useEffect(() => {
    if (!fleetStreamController) return;
    fleetStreamController.enabled = streamFleet;
    fleetStreamController.setEnabled = (enabled: boolean) => {
      dispatch({ type: 'setStreamFleet', enabled });
    };
    return () => {
      fleetStreamController.setEnabled = (enabled: boolean) => {
        fleetStreamController.enabled = enabled;
      };
    };
  }, [dispatch, fleetStreamController, streamFleet]);

  useEffect(() => {
    if (fleetStreamController) fleetStreamController.enabled = streamFleet;
  }, [fleetStreamController, streamFleet]);

  useEffect(() => {
    if (!enhanceController) return;
    enhanceController.enabled = enhanceEnabled;
    enhanceController.setEnabled = (enabled: boolean) => {
      dispatch({ type: 'enhanceSet', enabled });
    };
    return () => {
      enhanceController.setEnabled = (enabled: boolean) => {
        enhanceController.enabled = enabled;
      };
    };
  }, [dispatch, enhanceController, enhanceEnabled]);

  useEffect(() => {
    if (!agentsMonitorController) return;
    agentsMonitorController.visible = agentsMonitorOpen;
    agentsMonitorController.setVisible = (visible: boolean) => {
      if (visible !== agentsMonitorOpen) {
        dispatch({ type: 'toggleAgentsMonitor' });
      }
    };
    return () => {
      agentsMonitorController.setVisible = (visible: boolean) => {
        agentsMonitorController.visible = visible;
      };
    };
  }, [agentsMonitorController, agentsMonitorOpen, dispatch]);

  useEffect(() => {
    if (agentsMonitorController) agentsMonitorController.visible = agentsMonitorOpen;
  }, [agentsMonitorController, agentsMonitorOpen]);

  // Wire onPanelOpen — slash commands call `onPanelOpen.current(action)` to open panels.
  useEffect(() => {
    if (!onPanelOpen) return;
    onPanelOpen.current = (action: string) => {
      // All known F-key panel actions are simple toggles or opens.
      // Dispatch the action and return true to indicate success.
      dispatch({ type: action } as Action);
      return true;
    };
    return () => {
      onPanelOpen.current = null;
    };
  }, [onPanelOpen, dispatch]);
}
