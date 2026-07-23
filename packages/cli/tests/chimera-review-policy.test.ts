import { describe, expect, it } from 'vitest';
import {
  applyChimeraReviewerReadOnlyPolicy,
  CHIMERA_REVIEW_READ_ONLY_TOOLS,
} from '../src/execution.js';

describe('Chimera reviewer tool policy', () => {
  it('exposes only read-only inspection tools', () => {
    const config = applyChimeraReviewerReadOnlyPolicy({
      name: 'chimera-review',
      tools: ['edit', 'write', 'patch', 'exec'],
      allowedCapabilities: ['fs.write', 'shell.exec'],
    });

    expect(config.tools).toEqual([...CHIMERA_REVIEW_READ_ONLY_TOOLS]);
    expect(config.allowedCapabilities).toEqual(['fs.read']);
    expect(config.worktree).toBe('off');
    expect(config.tools).not.toEqual(
      expect.arrayContaining([
        'edit',
        'write',
        'patch',
        'update',
        'replace',
        'format',
        'bash',
        'exec',
        'git',
      ]),
    );
  });
});
