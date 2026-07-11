import { describe, expect, it } from 'vitest';
import type { ExecuteDeps } from '../src/execute-deps.js';
import {
  createAgentsMonitorController,
  createEnhanceController,
  createFleetStreamController,
  createInterruptController,
} from '../src/wiring/controllers.js';
import { toExecuteDeps } from '../src/wiring/to-execute-deps.js';

describe('CLI wiring controllers', () => {
  it('keeps fleet stream and agents monitor state mutable through their shared controllers', () => {
    const stream = createFleetStreamController();
    const agents = createAgentsMonitorController();
    stream.setEnabled(false);
    agents.setVisible(true);
    expect(stream.enabled).toBe(false);
    expect(agents.visible).toBe(true);
  });

  it('seeds and updates enhance state from config', () => {
    const controller = createEnhanceController({ autonomy: { enhance: false } } as never);
    expect(controller.enabled).toBe(false);
    controller.setEnabled(true);
    expect(controller.enabled).toBe(true);
  });

  it('uses a safe no-op interrupt controller until a surface binds it', () => {
    expect(createInterruptController().abortLeader()).toBe(false);
  });

  it('preserves the grouped ExecuteDeps object at the wiring boundary', () => {
    const deps = { core: { marker: true } } as unknown as ExecuteDeps;
    expect(toExecuteDeps(deps)).toBe(deps);
  });
});
