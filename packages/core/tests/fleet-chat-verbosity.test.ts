import { describe, expect, it } from 'vitest';
import { resolveFleetChatVerbosity } from '../src/types/config.js';

describe('resolveFleetChatVerbosity', () => {
  it('defaults to off when nothing is set', () => {
    expect(resolveFleetChatVerbosity(undefined)).toBe('off');
    expect(resolveFleetChatVerbosity({})).toBe('off');
  });

  it('explicit enum always wins', () => {
    expect(resolveFleetChatVerbosity({ fleetChatVerbosity: 'off' })).toBe('off');
    expect(resolveFleetChatVerbosity({ fleetChatVerbosity: 'full' })).toBe('full');
    // …even against a contradicting legacy boolean.
    expect(
      resolveFleetChatVerbosity({ fleetChatVerbosity: 'full', streamFleet: false }),
    ).toBe('full');
    expect(
      resolveFleetChatVerbosity({ fleetChatVerbosity: 'off', streamFleet: true }),
    ).toBe('off');
  });

  it('legacy streamFleet false maps to off; true returns off default', () => {
    expect(resolveFleetChatVerbosity({ streamFleet: false })).toBe('off');
    // streamFleet true is no longer a meaningful signal — off is the default.
    expect(resolveFleetChatVerbosity({ streamFleet: true })).toBe('off');
  });

  it('falls through an invalid enum value to the legacy/default ladder', () => {
    expect(
      resolveFleetChatVerbosity({ fleetChatVerbosity: 'loud' as never, streamFleet: false }),
    ).toBe('off');
    expect(resolveFleetChatVerbosity({ fleetChatVerbosity: '' as never })).toBe('off');
  });
});
