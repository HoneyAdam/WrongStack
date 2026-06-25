/**
 * The fallback-model extension moved to `@wrongstack/core` so the runtime light
 * subagent factory can reuse it (it only ever depended on core types). This file
 * remains as a re-export so existing CLI imports (`./fallback-model.js`) keep
 * working unchanged — the leader, the director/host factory, and the `/fallback`
 * slash command all import from here.
 */
export {
  createFallbackModelExtension,
  parseModelRef,
  smartDefaultFallbackChain,
  effectiveFallbackChain,
  type FallbackModelDeps,
} from '@wrongstack/core';
