import { describe, expect, it, vi, beforeEach } from 'vitest';

// SkillInstaller is mocked — its real behavior (GitHub fetch, file extraction)
// is covered in its own tests under packages/core/tests/skills.
const installerMocks = vi.hoisted(() => ({
  install: vi.fn(),
  update: vi.fn(),
  uninstall: vi.fn(),
  listInstalled: vi.fn(),
}));

vi.mock('@wrongstack/core/skills', () => ({
  SkillInstaller: class {
    install = installerMocks.install;
    update = installerMocks.update;
    uninstall = installerMocks.uninstall;
    listInstalled = installerMocks.listInstalled;
  },
}));

import {
  buildSkillInstallCommand,
  buildSkillUpdateCommand,
  buildSkillUninstallCommand,
} from '../src/slash-commands/skill-install.js';

function emptyOpts() {
  return {
    config: {},
    container: {},
    renderer: { writeError: vi.fn(), write: vi.fn(), writeInfo: vi.fn() },
    skillLoader: undefined,
  } as never;
}

function fakeCtx() {
  return { projectRoot: '/tmp/proj' } as never;
}

beforeEach(() => {
  installerMocks.install.mockReset();
  installerMocks.update.mockReset();
  installerMocks.uninstall.mockReset();
  installerMocks.listInstalled.mockReset();
});

// ── /skill-install ───────────────────────────────────────────────────────────

describe('buildSkillInstallCommand', () => {
  it('exposes name and frontmatter', () => {
    const cmd = buildSkillInstallCommand(emptyOpts());
    expect(cmd.name).toBe('skill-install');
    expect(cmd.argsHint).toBeDefined();
    expect(cmd.help).toBeDefined();
  });

  it('returns usage when ref missing', async () => {
    const cmd = buildSkillInstallCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('Usage:');
  });

  it('reports "no skills found" when install returns empty', async () => {
    installerMocks.install.mockResolvedValue([]);
    const cmd = buildSkillInstallCommand(emptyOpts());
    const res = await cmd.run('user/repo', fakeCtx());
    expect(res?.message).toContain('No skills found');
  });

  it('installs to project scope by default', async () => {
    installerMocks.install.mockResolvedValue([
      { name: 'thing', source: 'user/repo', ref: 'main', path: '/skills/thing' },
    ]);
    const cmd = buildSkillInstallCommand(emptyOpts());
    const res = await cmd.run('user/repo', fakeCtx());
    expect(installerMocks.install).toHaveBeenCalledWith('user/repo', { global: false });
    expect(res?.message).toContain('[project]');
    expect(res?.message).toContain('thing');
    expect(res?.message).toContain('/skills/thing');
  });

  it('--global routes to user-global scope', async () => {
    installerMocks.install.mockResolvedValue([
      { name: 'thing', source: 'user/repo', ref: 'main', path: '/p' },
    ]);
    const cmd = buildSkillInstallCommand(emptyOpts());
    const res = await cmd.run('user/repo --global', fakeCtx());
    expect(installerMocks.install).toHaveBeenCalledWith('user/repo', { global: true });
    expect(res?.message).toContain('[user-global]');
  });

  it('surfaces error message on install failure', async () => {
    installerMocks.install.mockRejectedValue(new Error('network down'));
    const opts = emptyOpts();
    const cmd = buildSkillInstallCommand(opts);
    const res = await cmd.run('user/repo', fakeCtx());
    expect(res?.message).toContain('Install failed: network down');
    expect(opts.renderer.writeError).toHaveBeenCalled();
  });

  it('handles non-Error throws', async () => {
    installerMocks.install.mockRejectedValue('plain string');
    const cmd = buildSkillInstallCommand(emptyOpts());
    const res = await cmd.run('user/repo', fakeCtx());
    expect(res?.message).toContain('plain string');
  });
});

// ── /skill-update ────────────────────────────────────────────────────────────

describe('buildSkillUpdateCommand', () => {
  it('renders "no installed skills" when result has nothing', async () => {
    installerMocks.update.mockResolvedValue({ updated: [], unchanged: [], errors: [] });
    const cmd = buildSkillUpdateCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('No installed skills');
  });

  it('reports updates with ref transitions', async () => {
    installerMocks.update.mockResolvedValue({
      updated: [
        { name: 'a', oldRef: 'v1', newRef: 'v2' },
        { name: 'b', oldRef: 'main', newRef: 'main' },
      ],
      unchanged: [],
      errors: [],
    });
    const cmd = buildSkillUpdateCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('Updated 2 skill');
    expect(res?.message).toContain('v1 → v2');
    expect(res?.message).toContain('(refreshed)');
  });

  it('reports unchanged skills', async () => {
    installerMocks.update.mockResolvedValue({
      updated: [],
      unchanged: ['x', 'y'],
      errors: [],
    });
    const cmd = buildSkillUpdateCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('Up to date: x, y');
  });

  it('reports per-skill errors', async () => {
    installerMocks.update.mockResolvedValue({
      updated: [],
      unchanged: [],
      errors: [{ name: 'broken', error: 'auth failed' }],
    });
    const cmd = buildSkillUpdateCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('broken: auth failed');
  });

  it('passes a specific name+global flag through', async () => {
    installerMocks.update.mockResolvedValue({ updated: [], unchanged: [], errors: [] });
    const cmd = buildSkillUpdateCommand(emptyOpts());
    await cmd.run('my-skill --global', fakeCtx());
    expect(installerMocks.update).toHaveBeenCalledWith('my-skill', { global: true });
  });

  it('catches thrown errors', async () => {
    installerMocks.update.mockRejectedValue(new Error('boom'));
    const cmd = buildSkillUpdateCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('Update failed: boom');
  });
});

// ── /skill-uninstall ─────────────────────────────────────────────────────────

describe('buildSkillUninstallCommand', () => {
  it('lists installed skills when no name given (project scope)', async () => {
    installerMocks.listInstalled.mockResolvedValue([
      { name: 'a', source: 'u/r', ref: 'v1', installedAt: '2026-01-15T00:00:00Z', scope: 'project' },
      { name: 'b', source: 'u/s', ref: 'main', installedAt: '2026-02-01T00:00:00Z', scope: 'user' },
    ]);
    const cmd = buildSkillUninstallCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('Installed skills (project)');
    expect(res?.message).toContain('a');
    expect(res?.message).not.toContain('b'); // filtered to project scope
  });

  it('lists nothing when both scopes empty', async () => {
    installerMocks.listInstalled.mockResolvedValue([]);
    const cmd = buildSkillUninstallCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('No installed skills');
  });

  it('lists nothing when scope filter empties result', async () => {
    installerMocks.listInstalled.mockResolvedValue([
      { name: 'a', source: 's', ref: 'r', installedAt: '2026-01-01T00:00:00Z', scope: 'user' },
    ]);
    const cmd = buildSkillUninstallCommand(emptyOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('No installed skills found (project scope)');
  });

  it('--global lists user-scoped skills', async () => {
    installerMocks.listInstalled.mockResolvedValue([
      { name: 'g', source: 's', ref: 'r', installedAt: '2026-02-01T00:00:00Z', scope: 'user' },
    ]);
    const cmd = buildSkillUninstallCommand(emptyOpts());
    const res = await cmd.run('--global', fakeCtx());
    expect(res?.message).toContain('Installed skills (user)');
    expect(res?.message).toContain('g');
  });

  it('uninstalls by name when name given', async () => {
    installerMocks.uninstall.mockResolvedValue(undefined);
    const cmd = buildSkillUninstallCommand(emptyOpts());
    const res = await cmd.run('thing', fakeCtx());
    expect(installerMocks.uninstall).toHaveBeenCalledWith('thing', { global: false });
    expect(res?.message).toContain('uninstalled');
  });

  it('--global routes to user-scope uninstall', async () => {
    installerMocks.uninstall.mockResolvedValue(undefined);
    const cmd = buildSkillUninstallCommand(emptyOpts());
    await cmd.run('thing --global', fakeCtx());
    expect(installerMocks.uninstall).toHaveBeenCalledWith('thing', { global: true });
  });

  it('reports failure when uninstall throws', async () => {
    installerMocks.uninstall.mockRejectedValue(new Error('ENOENT'));
    const cmd = buildSkillUninstallCommand(emptyOpts());
    const res = await cmd.run('missing', fakeCtx());
    expect(res?.message).toContain('Uninstall failed: ENOENT');
  });

  it('handles non-Error throws on uninstall', async () => {
    installerMocks.uninstall.mockRejectedValue('reason');
    const cmd = buildSkillUninstallCommand(emptyOpts());
    const res = await cmd.run('m', fakeCtx());
    expect(res?.message).toContain('reason');
  });
});
