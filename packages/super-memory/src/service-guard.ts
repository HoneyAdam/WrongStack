import type { MemoryStore } from '@wrongstack/core';
import type { SuperMemoryServiceLike } from './service-contract.js';

const SUPER_MEMORY_METHODS = [
  'retrieveForPath',
  'searchSuper',
  'graphFor',
  'verify',
  'hygiene',
  'listCandidates',
  'createCandidate',
  'resolveCandidate',
  'acceptCandidate',
  'rejectCandidate',
  'rememberSuper',
  'updateSuperMemory',
  'deleteSuperMemory',
  'recoverSuperMemory',
  'backfillRecoverable',
  'findMemoriesForFile',
  'getSuperMemory',
] as const satisfies readonly (keyof SuperMemoryServiceLike)[];

/** Canonical capability guard used before exposing the Super Memory tool set. */
export function isSuperMemoryService(value: MemoryStore): value is SuperMemoryServiceLike {
  const candidate = value as unknown as Record<string, unknown>;
  return SUPER_MEMORY_METHODS.every((method) => typeof candidate[method] === 'function');
}
