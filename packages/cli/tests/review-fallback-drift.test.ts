/**
 * Drift guard for the reviewer default fallback chain.
 *
 * DEFAULT_REVIEW_FALLBACK_MODELS is defined once in
 * packages/core/src/plugins/auto-review-plugin.ts and shared with the CLI
 * reviewer spawn in packages/cli/src/execution.ts via the exported
 * resolveReviewerFallbackModels() helper. These tests assert, by strict
 * runtime value equality against the real production code path, that the two
 * spawn seams cannot diverge — which is exactly the drift that could reopen the
 * chimera-review `provider_auth` (1 iter / 0 tools) failure on one seam but not
 * the other.
 *
 * See: fix(auto-review) 623bd441a + refactor(auto-review) a93f3310a.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_REVIEW_FALLBACK_MODELS } from '@wrongstack/core/plugin';
import { resolveReviewerFallbackModels } from '../src/execution.js';

describe('reviewer fallback-chain drift guard', () => {
  it('exposes a non-empty shared DEFAULT_REVIEW_FALLBACK_MODELS from @wrongstack/core', () => {
    expect(Array.isArray(DEFAULT_REVIEW_FALLBACK_MODELS)).toBe(true);
    expect(DEFAULT_REVIEW_FALLBACK_MODELS.length).toBeGreaterThan(0);
  });

  it('every default entry is a well-formed provider/model ref', () => {
    // Guards against a malformed default list (e.g. a bare profile name or a
    // model with no provider) that would 401 as "Model is not supported".
    for (const ref of DEFAULT_REVIEW_FALLBACK_MODELS) {
      expect(typeof ref).toBe('string');
      const slash = ref.indexOf('/');
      expect(slash, `"${ref}" must be provider/model`).toBeGreaterThan(0);
      expect(slash, `"${ref}" must have a model after the slash`).toBeLessThan(
        ref.length - 1,
      );
    }
  });

  it('CLI reviewer spawn resolves exactly the shared default when no bundle chain is present', () => {
    // Strict runtime value comparison against the production code path: the
    // manual/ordinary-Chimera reviewer spawn calls resolveReviewerFallbackModels()
    // with no bundle chain, so it MUST equal the shared core default. If a future
    // edit re-hardcodes a divergent local list, this equality fails in CI.
    expect(resolveReviewerFallbackModels()).toEqual([
      ...DEFAULT_REVIEW_FALLBACK_MODELS,
    ]);
    expect(resolveReviewerFallbackModels(undefined)).toEqual([
      ...DEFAULT_REVIEW_FALLBACK_MODELS,
    ]);
    expect(resolveReviewerFallbackModels([])).toEqual([
      ...DEFAULT_REVIEW_FALLBACK_MODELS,
    ]);
  });

  it('returns a fresh mutable copy (never aliases the shared frozen constant)', () => {
    const a = resolveReviewerFallbackModels();
    const b = resolveReviewerFallbackModels();
    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_REVIEW_FALLBACK_MODELS);
    // SubagentConfig.fallbackModels is a mutable string[]; mutating the result
    // must not corrupt the shared source constant.
    a.push('mutation/check');
    expect(resolveReviewerFallbackModels()).toEqual([
      ...DEFAULT_REVIEW_FALLBACK_MODELS,
    ]);
  });

  it('uses the auto-review bundle chain verbatim when one is supplied', () => {
    // When the bundle already resolved a chain, the reviewer must use it as-is
    // rather than the default — the other half of the spawn contract.
    const bundleChain = ['minimax-coding-plan/MiniMax-M3', 'zai-coding-plan/glm-5.2'];
    expect(resolveReviewerFallbackModels(bundleChain)).toEqual(bundleChain);
  });
});
