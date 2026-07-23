import { describe, expect, it } from 'vitest';
import { resolveAgentSwarmPanelVisibility } from '../src/app-status-region.js';

describe('resolveAgentSwarmPanelVisibility', () => {
  it('defaults the persistent panel to visible when no setting is stored', () => {
    expect(resolveAgentSwarmPanelVisibility(false, false, undefined)).toBe(true);
  });

  it('uses the persisted setting while the settings picker is closed', () => {
    expect(resolveAgentSwarmPanelVisibility(false, true, false)).toBe(false);
    expect(resolveAgentSwarmPanelVisibility(false, false, true)).toBe(true);
  });

  it('previews the picker value live while /settings is open', () => {
    expect(resolveAgentSwarmPanelVisibility(true, false, true)).toBe(false);
    expect(resolveAgentSwarmPanelVisibility(true, true, false)).toBe(true);
  });
});
