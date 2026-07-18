/**
 * Tests for cli-bundled-prompts.ts — bundled prompts directory resolution.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBundledPromptsDir } from '../src/cli-bundled-prompts.js';

describe('resolveBundledPromptsDir', () => {
  it('returns a path string pointing to prompts directory', () => {
    const result = resolveBundledPromptsDir();
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    // Should end with 'data/prompts' or similar
    expect(result).toMatch(/prompts/);
  });
});

/**
 * Tests for cli-bundled-skills.ts — bundled skills directory resolution.
 */
import { resolveBundledSkillsDir } from '../src/cli-bundled-skills.js';

describe('resolveBundledSkillsDir', () => {
  it('returns a path string pointing to skills directory', () => {
    const result = resolveBundledSkillsDir();
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    // Should end with 'skills' or similar
    expect(result).toMatch(/skills/);
  });

  it('ships the WrongStack operational skills used across projects', () => {
    const result = resolveBundledSkillsDir();
    expect(result).toBeDefined();

    for (const name of ['auto-review', 'mailbox-bridge', 'mnemosyne', 'wrongstack-mailbox']) {
      expect(fs.existsSync(path.join(result!, name, 'SKILL.md')), `${name} must be packaged`).toBe(
        true,
      );
    }
  });
});
