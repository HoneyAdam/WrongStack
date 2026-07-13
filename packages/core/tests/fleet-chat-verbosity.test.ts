import { describe, expect, it } from 'vitest';
import { resolveFleetChatVerbosity } from '../src/types/config.js';

describe('resolveFleetChatVerbosity', () => {
  it('defaults to compact when nothing is set', () => {
    expect(resolveFleetChatVerbosity(undefined)).toBe('compact');
    expect(resolveFleetChatVerbosity({})).toBe('compact');
  });

  it('explicit enum always wins', () => {
    expect(resolveFleetChatVerbosity({ fleetChatVerbosity: 'off' })).toBe('off');
    expect(resolveFleetChatVerbosity({ fleetChatVerbosity: 'compact' })).toBe('compact');
    expect(resolveFleetChatVerbosity({ fleetChatVerbosity: 'full' })).toBe('full');
    // …even against a contradicting legacy boolean.
    expect(
      resolveFleetChatVerbosity({ fleetChatVerbosity: 'full', streamFleet: false }),
    ).toBe('full');
    expect(
      resolveFleetChatVerbosity({ fleetChatVerbosity: 'off', streamFleet: true }),
    ).toBe('off');
  });

  it('legacy streamFleet false maps to off; true keeps the compact default', () => {
    expect(resolveFleetChatVerbosity({ streamFleet: false })).toBe('off');
    // streamFleet true was the DEFAULTS value, so it carries no signal —
    // the new compact default applies.
    expect(resolveFleetChatVerbosity({ streamFleet: true })).toBe('compact');
  });

  it('falls through an invalid enum value to the legacy/default ladder', () => {
    expect(
      resolveFleetChatVerbosity({ fleetChatVerbosity: 'loud' as never, streamFleet: false }),
    ).toBe('off');
    expect(resolveFleetChatVerbosity({ fleetChatVerbosity: '' as never })).toBe('compact');
  });
});
