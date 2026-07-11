import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processMocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', () => processMocks);

import { languageInfoTool } from '../src/languages/tool.js';

let root: string;
const opts = { signal: new AbortController().signal };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-language-info-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function context() {
  return { cwd: root, workingDir: root, projectRoot: root } as any;
}

describe('languageInfoTool', () => {
  it('is an auto-approved read-only builtin with only fs.read capability', () => {
    expect(languageInfoTool).toMatchObject({
      name: 'language_info',
      permission: 'auto',
      mutating: false,
      riskTier: 'safe',
      capabilities: ['fs.read'],
    });
  });

  it('validates action-specific fields before execution', () => {
    expect(languageInfoTool.validate?.({ action: 'plan' })).toEqual([
      'operation is required when action=plan',
    ]);
    expect(languageInfoTool.validate?.({ action: 'detect', operation: 'test' })).toEqual([
      'operation is only valid when action=plan',
    ]);
  });

  it('lists immutable profile capabilities without filesystem mutation', async () => {
    const result = await languageInfoTool.execute({ action: 'capabilities' }, context(), opts);
    expect(result.action).toBe('capabilities');
    if (result.action === 'capabilities') {
      expect(result.profiles.map((profile) => profile.id)).toContain('rust');
      expect(result.profiles.find((profile) => profile.id === 'go')?.operations).toContain('test');
    }
  });

  it('detects and plans without invoking child-process APIs', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module x');
    await fs.writeFile(path.join(root, 'main.go'), 'package main');
    processMocks.spawn.mockClear();
    processMocks.execFile.mockClear();

    const detected = await languageInfoTool.execute({ action: 'detect' }, context(), opts);
    expect(detected.action).toBe('detect');
    const planned = await languageInfoTool.execute(
      { action: 'plan', language: 'go', operation: 'test' },
      context(),
      opts,
    );
    expect(planned).toMatchObject({ action: 'plan', status: 'planned' });
    expect(processMocks.spawn).not.toHaveBeenCalled();
    expect(processMocks.execFile).not.toHaveBeenCalled();
  });

  it('rejects cwd traversal through the existing realpath containment guard', async () => {
    await expect(
      languageInfoTool.execute({ action: 'detect', cwd: '..' }, context(), opts),
    ).rejects.toThrow(/outside project root/);
  });
});
