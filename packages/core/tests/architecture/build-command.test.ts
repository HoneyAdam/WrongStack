import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoFile = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('build command invariants', () => {
  it('documents the repository topological build runner in the docker-deploy skill', () => {
    const dockerSkill = repoFile('packages/core/skills/docker-deploy/SKILL.md');
    expect(dockerSkill).toContain('`pnpm build`');
    expect(dockerSkill).not.toContain('pnpm -r build');
  });
});
