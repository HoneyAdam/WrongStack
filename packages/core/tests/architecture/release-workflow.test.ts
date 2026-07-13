import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoFile = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('release workflow invariants', () => {
  const workflow = repoFile('.github/workflows/release.yml');

  it('uses the repository topological build runner everywhere it documents a build', () => {
    expect(workflow).toContain('run: pnpm build');
    expect(workflow).not.toContain('pnpm -r build');

    const dockerSkill = repoFile('packages/core/skills/docker-deploy/SKILL.md');
    expect(dockerSkill).toContain('`pnpm build`');
    expect(dockerSkill).not.toContain('pnpm -r build');
  });

  it('requires a package-version tag whose commit belongs to main', () => {
    expect(workflow).toContain(`EXPECTED_TAG="v\${PACKAGE_VERSION}"`);
    expect(workflow).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
  });

  it('keeps manual dispatches on main and dry-run only', () => {
    expect(workflow).toContain('if [ "$REF" != "refs/heads/main" ]');
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain('run: pnpm release:dry');
    expect(workflow).toContain("if: github.event_name == 'push'");
    expect(workflow).not.toContain('inputs.dry_run');
  });
});
