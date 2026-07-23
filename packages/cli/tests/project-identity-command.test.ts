import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectCmd } from '../src/subcommands/handlers/project.js';
import type { SubcommandDeps } from '../src/subcommands/index.js';

describe('wstack project identity commands', () => {
  let root: string;
  let output: string;
  let deps: SubcommandDeps;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-project-command-'));
    output = '';
    deps = {
      projectRoot: root,
      renderer: { write: (value: string) => (output += value) },
      flags: {},
    } as never as SubcommandDeps;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('initializes and reports the same committed identity', async () => {
    expect(await projectCmd(['init'], deps)).toBe(0);
    const saved = JSON.parse(
      await fs.readFile(path.join(root, '.wrongstack', 'project.json'), 'utf8'),
    ) as { projectId: string };
    output = '';

    expect(await projectCmd(['id'], deps)).toBe(0);
    expect(output).toContain(saved.projectId);
  });

  it('requires explicit confirmation before rekeying', async () => {
    await projectCmd(['init'], deps);
    const before = await fs.readFile(path.join(root, '.wrongstack', 'project.json'), 'utf8');
    output = '';

    expect(await projectCmd(['rekey'], deps)).toBe(1);
    expect(await fs.readFile(path.join(root, '.wrongstack', 'project.json'), 'utf8')).toBe(before);
    expect(output).toContain('--yes');
  });

  it('rekeys when the top-level --yes flag is present', async () => {
    await projectCmd(['init'], deps);
    const before = await fs.readFile(path.join(root, '.wrongstack', 'project.json'), 'utf8');
    deps.flags = { yes: true };

    expect(await projectCmd(['rekey'], deps)).toBe(0);
    expect(await fs.readFile(path.join(root, '.wrongstack', 'project.json'), 'utf8')).not.toBe(
      before,
    );
  });
});
