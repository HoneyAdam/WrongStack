import { describe, expect, it, vi } from 'vitest';
import type { ReviewContextBundle } from '../../src/plugins/chimera-plugin.js';
import {
  emitReviewIfChanged,
  recordCompletedReview,
  recordStartedReview,
} from '../../src/plugins/review-claim-registry.js';

function bundle(content: string): ReviewContextBundle {
  return {
    cwd: 'C:\\project',
    config: {
      enabled: true,
      provider: 'test',
      model: 'test',
      maxFiles: 15,
      autoFix: 'off',
      cascadeOn: 'off',
      maxCascadeDepth: 0,
    },
    files: [
      {
        path: 'src/file.ts',
        status: 'modified',
        content,
      },
    ],
  };
}

describe('review claim registry', () => {
  it('allows only one plugin to emit the same file content on a shared session bus', () => {
    const events = {};
    const firstEmit = vi.fn();
    const secondEmit = vi.fn();

    expect(
      emitReviewIfChanged({ events, emitCustom: firstEmit } as never, bundle('v1')),
    ).not.toBeNull();
    expect(
      emitReviewIfChanged({ events, emitCustom: secondEmit } as never, bundle('v1')),
    ).toBeNull();
    expect(firstEmit).toHaveBeenCalledOnce();
    expect(secondEmit).not.toHaveBeenCalled();
  });

  it('allows a later review when the file content changes', () => {
    const events = {};
    const emitCustom = vi.fn();

    expect(emitReviewIfChanged({ events, emitCustom } as never, bundle('v1'))).not.toBeNull();
    expect(emitReviewIfChanged({ events, emitCustom } as never, bundle('v2'))).not.toBeNull();
    expect(emitCustom).toHaveBeenCalledTimes(2);
  });

  it('counts an externally started manual review as a claim', () => {
    const events = {};
    const emitCustom = vi.fn();
    recordStartedReview(events as never, bundle('v1'));

    expect(emitReviewIfChanged({ events, emitCustom } as never, bundle('v1'))).toBeNull();
    expect(emitCustom).not.toHaveBeenCalled();
  });

  it('allows the same content to be reviewed again after completion', () => {
    const events = {};
    const emitCustom = vi.fn();
    const completedBundle = emitReviewIfChanged({ events, emitCustom } as never, bundle('v1'));

    expect(completedBundle).not.toBeNull();
    recordCompletedReview(events as never, { bundle: completedBundle });

    expect(emitReviewIfChanged({ events, emitCustom } as never, bundle('v1'))).not.toBeNull();
    expect(emitCustom).toHaveBeenCalledTimes(2);
  });

  it('keeps a newer content claim when an older review completes', () => {
    const events = {};
    const emitCustom = vi.fn();
    const olderBundle = emitReviewIfChanged({ events, emitCustom } as never, bundle('v1'));

    expect(olderBundle).not.toBeNull();
    expect(emitReviewIfChanged({ events, emitCustom } as never, bundle('v2'))).not.toBeNull();
    recordCompletedReview(events as never, { bundle: olderBundle });

    expect(emitReviewIfChanged({ events, emitCustom } as never, bundle('v2'))).toBeNull();
    expect(emitCustom).toHaveBeenCalledTimes(2);
  });

  it('rolls back the claim when synchronous event emission fails', () => {
    const events = {};
    const failedEmit = vi.fn(() => {
      throw new Error('emit failed');
    });
    const retryEmit = vi.fn();

    expect(() =>
      emitReviewIfChanged({ events, emitCustom: failedEmit } as never, bundle('v1')),
    ).toThrow('emit failed');
    expect(
      emitReviewIfChanged({ events, emitCustom: retryEmit } as never, bundle('v1')),
    ).not.toBeNull();
    expect(retryEmit).toHaveBeenCalledOnce();
  });
});
