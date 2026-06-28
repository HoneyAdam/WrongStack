import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const updateMocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../src/update-check.js', () => ({
  checkForUpdate: updateMocks.checkForUpdate,
}));

vi.mock('node:child_process', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    spawn: (...args: unknown[]) => updateMocks.spawn(...args),
  };
});

import { detectUpdatePackageManager, updateCmd } from '../src/subcommands/handlers/update.js';

let writes: string[];
let deps: Parameters<typeof updateCmd>[1];

beforeEach(() => {
  writes = [];
  updateMocks.checkForUpdate.mockReset();
  updateMocks.spawn.mockReset();
  vi.stubEnv('WRONGSTACK_UPDATE_PM', 'npm');
  deps = {
    cwd: '/tmp',
    renderer: {
      write: (s: string) => {
        writes.push(s);
      },
    },
  } as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function makeFakeChild(exitCode: number | null, errOnSpawn?: Error, stderrChunks: string[] = []) {
  const ee = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter | null;
    stdout: EventEmitter | null;
  };
  ee.stderr = new EventEmitter();
  ee.stdout = new EventEmitter();
  setImmediate(() => {
    if (errOnSpawn) {
      ee.emit('error', errOnSpawn);
      return;
    }
    for (const c of stderrChunks) ee.stderr?.emit('data', Buffer.from(c));
    ee.emit('close', exitCode);
  });
  return ee;
}

describe('updateCmd subcommand', () => {
  it('--check-only on outdated prints "Update available"', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    const code = await updateCmd(['--check-only'], deps);
    expect(code).toBe(0);
    expect(writes.join('')).toContain('Update available: v1.0.0 → v1.2.3');
    expect(updateMocks.spawn).not.toHaveBeenCalled();
  });

  it('--check-only on up-to-date prints latest message', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: false,
      current: '2.0.0',
      latest: '2.0.0',
    });
    const code = await updateCmd(['--check-only'], deps);
    expect(code).toBe(0);
    expect(writes.join('')).toContain('You are on the latest version: v2.0.0');
  });

  it('-c is an alias for --check-only', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: false,
      current: '1.0.0',
      latest: '1.0.0',
    });
    await updateCmd(['-c'], deps);
    expect(writes.join('')).toContain('You are on the latest version');
    expect(updateMocks.spawn).not.toHaveBeenCalled();
  });

  it('when already latest, returns 0 without spawning npm', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: false,
      current: '1.0.0',
      latest: '1.0.0',
    });
    const code = await updateCmd([], deps);
    expect(code).toBe(0);
    expect(writes.join('')).toContain('already on the latest version');
    expect(updateMocks.spawn).not.toHaveBeenCalled();
  });

  it('runs npm install -g --ignore-scripts wrongstack@latest by default', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    updateMocks.spawn.mockReturnValue(makeFakeChild(0));
    const code = await updateCmd([], deps);
    expect(code).toBe(0);
    expect(updateMocks.spawn).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '-g', '--ignore-scripts', 'wrongstack@latest'],
      expect.objectContaining({ cwd: '/tmp', stdio: 'pipe' }),
    );
    const out = writes.join('');
    expect(out).toContain('Updating wrongstack from v1.0.0 to v1.2.3');
    expect(out).toContain('Updated to v1.2.3');
  });

  it('omits --ignore-scripts when --allow-scripts is passed', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    updateMocks.spawn.mockReturnValue(makeFakeChild(0));
    const code = await updateCmd(['--allow-scripts'], deps);
    expect(code).toBe(0);
    expect(updateMocks.spawn).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '-g', 'wrongstack@latest'],
      expect.objectContaining({ cwd: '/tmp', stdio: 'pipe' }),
    );
  });

  it('runs the selected package manager when --pm is provided (with --ignore-scripts)', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    updateMocks.spawn.mockReturnValue(makeFakeChild(0));
    const code = await updateCmd(['--pm', 'pnpm'], deps);
    expect(code).toBe(0);
    expect(updateMocks.spawn).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['add', '-g', '--ignore-scripts', 'wrongstack@latest'],
      expect.objectContaining({ cwd: '/tmp', stdio: 'pipe' }),
    );
    expect(writes.join('')).toContain('Running: pnpm add -g --ignore-scripts wrongstack@latest');
  });

  it.each([
    { pm: 'yarn', argv: ['global', 'add', '--ignore-scripts', 'wrongstack@latest'] },
    { pm: 'bun', argv: ['add', '-g', '--ignore-scripts', 'wrongstack@latest'] },
  ] as const)('passes --ignore-scripts to $pm global add', async ({ pm, argv }) => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    updateMocks.spawn.mockReturnValue(makeFakeChild(0));
    const code = await updateCmd(['--pm', pm], deps);
    expect(code).toBe(0);
    // Bun uses `bun` directly on every platform; the others get `.cmd` on win32.
    const expectedExe = process.platform === 'win32' && pm !== 'bun' ? `${pm}.cmd` : pm;
    expect(updateMocks.spawn).toHaveBeenCalledWith(
      expectedExe,
      argv,
      expect.objectContaining({ cwd: '/tmp', stdio: 'pipe' }),
    );
  });

  it('rejects an invalid --pm value before checking for updates', async () => {
    const code = await updateCmd(['--pm', 'pip'], deps);
    expect(code).toBe(1);
    expect(writes.join('')).toContain('Invalid package manager: pip');
    expect(updateMocks.checkForUpdate).not.toHaveBeenCalled();
    expect(updateMocks.spawn).not.toHaveBeenCalled();
  });

  it('reports failure when npm exits non-zero', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    updateMocks.spawn.mockReturnValue(makeFakeChild(2, undefined, ['npm err\n']));
    const code = await updateCmd([], deps);
    expect(code).toBe(2);
    expect(writes.join('')).toContain('Update failed with exit code 2');
  });

  it('surfaces npm stderr and package-manager guidance on failure (#13)', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    // Exit 243 with a real reason in stderr — previously discarded, leaving the
    // user with only the opaque code.
    updateMocks.spawn.mockReturnValue(
      makeFakeChild(243, undefined, [
        'npm error code EACCES\n',
        'npm error EACCES: permission denied\n',
      ]),
    );
    const code = await updateCmd([], deps);
    expect(code).toBe(243);
    const out = writes.join('');
    expect(out).toContain('Update failed with exit code 243');
    // The underlying npm reason is now shown.
    expect(out).toContain('EACCES: permission denied');
    // And the alternative package managers are offered.
    expect(out).toContain('pnpm add -g --ignore-scripts wrongstack@latest');
    expect(out).toContain('yarn global add --ignore-scripts wrongstack@latest');
    expect(out).toContain('bun add -g --ignore-scripts wrongstack@latest');
  });

  it('handles ENOENT (npm not installed)', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    updateMocks.spawn.mockImplementation(() => {
      throw new Error('spawn npm ENOENT');
    });
    const code = await updateCmd([], deps);
    expect(code).toBe(1);
    expect(writes.join('')).toContain('npm not found in PATH');
  });

  it('reports generic error string when spawn throws non-ENOENT', async () => {
    updateMocks.checkForUpdate.mockResolvedValue({
      outdated: true,
      current: '1.0.0',
      latest: '1.2.3',
    });
    updateMocks.spawn.mockImplementation(() => {
      throw 'boom';
    });
    const code = await updateCmd([], deps);
    expect(code).toBe(1);
    expect(writes.join('')).toContain('Update failed: boom');
  });
});

describe('detectUpdatePackageManager', () => {
  it('uses WRONGSTACK_UPDATE_PM when present', () => {
    expect(detectUpdatePackageManager({ WRONGSTACK_UPDATE_PM: 'pnpm' }, [])).toBe('pnpm');
  });

  it('detects package managers from npm_config_user_agent', () => {
    expect(
      detectUpdatePackageManager({ npm_config_user_agent: 'pnpm/11.5.3 npm/? node/v24' }, []),
    ).toBe('pnpm');
    expect(
      detectUpdatePackageManager({ npm_config_user_agent: 'yarn/1.22.22 npm/? node/v24' }, []),
    ).toBe('yarn');
    expect(
      detectUpdatePackageManager({ npm_config_user_agent: 'bun/1.2.0 npm/? node/v24' }, []),
    ).toBe('bun');
  });
});
