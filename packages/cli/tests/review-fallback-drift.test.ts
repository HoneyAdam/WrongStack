/**
 * Drift guard for the reviewer default fallback chain.
 *
 * DEFAULT_REVIEW_FALLBACK_MODELS is defined once in
 * packages/core/src/plugins/auto-review-plugin.ts and shared with the CLI
 * reviewer spawn in packages/cli/src/execution.ts. These tests fail CI if a
 * future edit re-introduces a divergent hardcoded list on the CLI side, which
 * is exactly the drift that could reopen the chimera-review `provider_auth`
 * (1 iter / 0 tools) failure on one spawn seam but not the other.
 *
 * See: fix(auto-review) 623bd441a + refactor(auto-review) a93f3310a.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REVIEW_FALLBACK_MODELS } from '@wrongstack/core';

const executionSrc = readFileSync(
  fileURLToPath(new URL('../src/execution.ts', import.meta.url)),
  'utf8',
);

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

  it('CLI reviewer spawn imports the shared constant instead of redefining it', () => {
    // The import must reference the shared core constant...
    expect(executionSrc).toContain('DEFAULT_REVIEW_FALLBACK_MODELS');
    // ...and the local reviewer default must be derived from it by spread,
    // not from a fresh inline array literal.
    expect(executionSrc).toMatch(
      /defaultReviewFallbackModels\s*=\s*\[\s*\.\.\.DEFAULT_REVIEW_FALLBACK_MODELS\s*\]/,
    );
  });

  it('CLI does not re-hardcode a literal provider/model reviewer list', () => {
    // Any of the well-known default entries appearing as a string literal in
    // execution.ts would mean someone re-introduced a divergent hardcoded list.
    for (const ref of DEFAULT_REVIEW_FALLBACK_MODELS) {
      expect(
        executionSrc.includes(`'${ref}'`) || executionSrc.includes(`"${ref}"`),
        `execution.ts must not hardcode the reviewer fallback ref "${ref}" — import DEFAULT_REVIEW_FALLBACK_MODELS from @wrongstack/core instead`,
      ).toBe(false);
    }
  });
});
