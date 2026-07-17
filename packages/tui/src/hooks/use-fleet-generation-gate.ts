import { useCallback, useRef } from 'react';

/**
 * Session-generation gate for fleet event bridges.
 *
 * Fleet event bridges must discard events from subagents that were spawned
 * before the last `/clear`. This shared hook encapsulates that logic so any
 * bridge can apply it consistently. Currently consumed by
 * `useDirectorFleetBridge` (Director FleetBus streaming); `useSubagentEvents`
 * (EventBus lifecycle) does not gate on generation today.
 *
 * Usage:
 * ```ts
 * const gate = useFleetGenerationGate(sessionGenerationRef);
 * // On subagent spawn / first-seen:
 * gate.track(id);
 * // Before processing any event:
 * if (!gate.isLive(id)) return;
 * // On subagent removal:
 * gate.forget(id);
 * ```
 *
 * When `sessionGenerationRef` is absent (no /clear support wired), `isLive`
 * always returns `true` — backward-compatible no-op.
 */
export interface FleetGenerationGate {
  /** Record that a subagent was first seen at the current generation.
   *  Call on spawn or first event. No-op when no sessionGenerationRef. */
  track: (subagentId: string) => void;
  /** Returns true if the subagent's events should be processed.
   *  Returns false after /clear bumps the generation. */
  isLive: (subagentId: string) => boolean;
  /** Clean up tracking for a removed subagent. */
  forget: (subagentId: string) => void;
}

export function useFleetGenerationGate(
  sessionGenerationRef?: { current: number } | undefined,
): FleetGenerationGate {
  const spawnGenRef = useRef<Map<string, number>>(new Map());

  const track = useCallback(
    (subagentId: string): void => {
      if (sessionGenerationRef) {
        spawnGenRef.current.set(subagentId, sessionGenerationRef.current);
      }
    },
    [sessionGenerationRef],
  );

  const isLive = useCallback(
    (subagentId: string): boolean => {
      if (!sessionGenerationRef) return true;
      const gen = spawnGenRef.current.get(subagentId);
      if (gen === undefined) return true; // unknown agent — allow
      return gen === sessionGenerationRef.current;
    },
    [sessionGenerationRef],
  );

  const forget = useCallback((subagentId: string): void => {
    spawnGenRef.current.delete(subagentId);
  }, []);

  return { track, isLive, forget };
}
