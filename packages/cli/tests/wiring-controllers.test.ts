import { readFileSync } from 'node:fs';
import path from 'node:path';
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

  it('fleet stream controller: setMode drives mode and mirrors the boolean', () => {
    const stream = createFleetStreamController();
    expect(stream.mode).toBe('compact'); // default
    expect(stream.enabled).toBe(true);
    stream.setMode('off');
    expect(stream.mode).toBe('off');
    expect(stream.enabled).toBe(false);
    stream.setMode('full');
    expect(stream.mode).toBe('full');
    expect(stream.enabled).toBe(true);
  });

  it('fleet stream controller: legacy setEnabled maps to full/off', () => {
    const stream = createFleetStreamController();
    stream.setEnabled(true);
    expect(stream.mode).toBe('full');
    stream.setEnabled(false);
    expect(stream.mode).toBe('off');
  });

  it('fleet stream controller: seeds from the persisted mode', () => {
    const stream = createFleetStreamController('off');
    expect(stream.mode).toBe('off');
    expect(stream.enabled).toBe(false);
  });

  it('seeds and updates enhance state from config', () => {
    const controller = createEnhanceController({ autonomy: { enhance: false } } as never);
    expect(controller.enabled).toBe(false);
    controller.setEnabled(true);
    expect(controller.enabled).toBe(true);
  });

  it('uses safe no-op interrupt/reset hooks until a surface binds them', async () => {
    const controller = createInterruptController();
    expect(controller.abortLeader()).toBe(false);
    expect(controller.resetSession()).toBeUndefined();
    await expect(controller.waitForIdle()).resolves.toBeUndefined();
  });

  it('preserves the grouped ExecuteDeps object at the wiring boundary', () => {
    const deps = { core: { marker: true } } as unknown as ExecuteDeps;
    expect(toExecuteDeps(deps)).toBe(deps);
  });

  // agentTranscripts is an OPTIONAL prop at every hop, so a dropped hop
  // compiles fine and silently renders the fallback UI (no F3 transcript).
  // Assert each hop still forwards it so a refactor can't lose the chain:
  //   cli-main (fleet deps) → execution (destructure + runTui opts)
  //   → tui run-tui (App prop) → App → AgentsMonitor.
  it('threads agentTranscripts through every optional-prop hop', () => {
    const read = (rel: string) =>
      readFileSync(path.join(__dirname, '..', rel), 'utf8');
    expect(read('src/cli-main.ts')).toMatch(/agentTranscripts:\s*agentMonitor/);
    const execution = read('src/execution.ts');
    expect(execution).toMatch(/agentsMonitorController,\s*agentTranscripts,/s);
    expect(execution).toMatch(/\n\s+agentTranscripts,\n/);
    const runTui = readFileSync(
      path.join(__dirname, '..', '..', 'tui', 'src', 'run-tui.ts'),
      'utf8',
    );
    expect(runTui).toMatch(/agentTranscripts:\s*opts\.agentTranscripts/);
    const app = readFileSync(
      path.join(__dirname, '..', '..', 'tui', 'src', 'app.tsx'),
      'utf8',
    );
    expect(app).toMatch(/transcripts=\{agentTranscripts\}/);
  });
});
