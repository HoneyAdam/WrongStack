import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureDistDir, resolveDistDir } from '../src/webui-server/static-serve.js';

describe('resolveDistDir', () => {
  it('resolves the built dist beside the @wrongstack/webui server entry', () => {
    const serverEntry = path.join('C:', 'workspace', 'packages', 'webui', 'dist', 'server.js');
    expect(
      resolveDistDir({
        resolvePackageJson: () => serverEntry,
      }),
    ).toBe(path.dirname(serverEntry));
  });

  it('returns null when @wrongstack/webui cannot be resolved', () => {
    expect(() =>
      resolveDistDir({
        resolvePackageJson: () => {
          throw new Error('not found');
        },
      }),
    ).toThrow('@wrongstack/webui');
  });

  it('honors an explicit distDir override when provided', () => {
    expect(
      resolveDistDir({
        explicitDistDir: 'C:\\some\\custom\\path',
      }),
    ).toBe(path.resolve('C:\\some\\custom\\path'));
  });
});

describe('ensureDistDir', () => {
  const manifest = path.join('C:', 'workspace', 'packages', 'webui', 'package.json');
  const pkgDir = path.dirname(manifest);
  const distDir = path.join(pkgDir, 'dist');

  it('returns the resolved dist immediately when it already exists (no build triggered)', async () => {
    const runBuild = vi.fn();
    const result = await ensureDistDir(undefined, {
      resolvePackageJson: () => manifest,
      exists: () => true,
      runBuild,
    });
    expect(result).toBe(distDir);
    expect(runBuild).not.toHaveBeenCalled();
  });

  it('triggers an auto-build when dist is missing, then resolves after build', async () => {
    let built = false;
    const result = await ensureDistDir(undefined, {
      resolvePackageJson: () => manifest,
      exists: (file: string) => {
        if (file.endsWith('index.html')) return built;
        return true;
      },
      runBuild: () => {
        built = true;
      },
      findWorkspaceRoot: () => 'C:\\workspace',
    });
    expect(result).toBe(distDir);
    expect(built).toBe(true);
  });

  it('passes the workspace root to runBuild', async () => {
    let receivedCwd: string | undefined;
    let built = false;
    await ensureDistDir(undefined, {
      resolvePackageJson: () => manifest,
      exists: (file: string) => {
        if (file.endsWith('index.html')) return built;
        return true;
      },
      runBuild: (cwd: string) => {
        receivedCwd = cwd;
        built = true;
      },
      findWorkspaceRoot: () => 'C:\\my-root',
    });
    expect(receivedCwd).toBe('C:\\my-root');
  });

  it('throws a descriptive error when the build itself fails', async () => {
    await expect(
      ensureDistDir(undefined, {
        resolvePackageJson: () => manifest,
        exists: () => false,
        runBuild: () => {
          throw new Error('pnpm not found');
        },
        findWorkspaceRoot: () => 'C:\\workspace',
      }),
    ).rejects.toThrow('webui.auto_build.failed');
  });

  it('throws a not-in-workspace error when no pnpm-workspace.yaml is reachable', async () => {
    await expect(
      ensureDistDir(undefined, {
        resolvePackageJson: () => manifest,
        exists: () => false,
        runBuild: () => {},
        findWorkspaceRoot: () => null,
      }),
    ).rejects.toThrow('not inside a pnpm workspace');
  });

  it('throws a package-unresolvable error when @wrongstack/webui is missing', async () => {
    await expect(
      ensureDistDir(undefined, {
        resolvePackageJson: () => {
          throw new Error('not found');
        },
        exists: () => false,
        runBuild: () => {},
        findWorkspaceRoot: () => 'C:\\workspace',
      }),
    ).rejects.toThrow('webui package could not be resolved');
  });

  it('returns null immediately when an explicit distDir is given but missing (no auto-build)', async () => {
    const runBuild = vi.fn();
    const result = await ensureDistDir('C:\\some\\missing\\path', {
      resolvePackageJson: () => manifest,
      exists: () => false,
      runBuild,
    });
    expect(result).toBeNull();
    expect(runBuild).not.toHaveBeenCalled();
  });
});
