import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureSimpleUiDistDir, resolveSimpleUiDistDir } from '../src/simpleui-dist.js';

describe('resolveSimpleUiDistDir', () => {
  it('resolves the built dist beside the package manifest', () => {
    const manifest = path.join('C:', 'workspace', 'packages', 'simpleui', 'package.json');
    expect(
      resolveSimpleUiDistDir({
        resolvePackageJson: () => manifest,
        exists: () => true,
      }),
    ).toBe(path.join(path.dirname(manifest), 'dist'));
  });

  it('never falls back to the full WebUI when SimpleUI is unbuilt', () => {
    expect(() =>
      resolveSimpleUiDistDir({
        resolvePackageJson: () => '/workspace/simpleui/package.json',
        exists: () => false,
      }),
    ).toThrow('SimpleUI frontend is not built');
  });
});

describe('ensureSimpleUiDistDir', () => {
  const manifest = path.join('C:', 'workspace', 'packages', 'simpleui', 'package.json');
  const pkgDir = path.dirname(manifest);

  it('returns immediately when dist already exists (no build triggered)', () => {
    const runBuild = vi.fn();
    const result = ensureSimpleUiDistDir({
      resolvePackageJson: () => manifest,
      exists: () => true,
      runBuild,
    });
    expect(result).toBe(path.join(pkgDir, 'dist'));
    expect(runBuild).not.toHaveBeenCalled();
  });

  it('auto-builds when dist is missing, then resolves', () => {
    let built = false;
    const result = ensureSimpleUiDistDir({
      resolvePackageJson: () => manifest,
      exists: (file: string) => {
        // After the build "runs", index.html exists.
        if (file.endsWith('index.html')) return built;
        return true;
      },
      runBuild: () => { built = true; },
      findWorkspaceRoot: () => 'C:\\workspace',
    });
    expect(result).toBe(path.join(pkgDir, 'dist'));
    expect(built).toBe(true);
  });

  it('passes the workspace root to runBuild', () => {
    let receivedCwd: string | undefined;
    let built = false;
    ensureSimpleUiDistDir({
      resolvePackageJson: () => manifest,
      exists: (file: string) => {
        if (file.endsWith('index.html')) return built;
        return true;
      },
      runBuild: (cwd: string) => { receivedCwd = cwd; built = true; },
      findWorkspaceRoot: () => 'C:\\my-root',
    });
    expect(receivedCwd).toBe('C:\\my-root');
  });

  it('throws a descriptive error when the build itself fails', () => {
    expect(() =>
      ensureSimpleUiDistDir({
        resolvePackageJson: () => manifest,
        exists: () => false,
        runBuild: () => { throw new Error('pnpm not found'); },
        findWorkspaceRoot: () => 'C:\\workspace',
      }),
    ).toThrow('SimpleUI auto-build failed');
  });

  it('throws the original error when dist is still missing after build', () => {
    expect(() =>
      ensureSimpleUiDistDir({
        resolvePackageJson: () => manifest,
        exists: () => false, // build "succeeds" but dist still missing
        runBuild: () => {},
        findWorkspaceRoot: () => 'C:\\workspace',
      }),
    ).toThrow('SimpleUI frontend is not built');
  });

  it('throws when the package itself cannot be resolved', () => {
    expect(() =>
      ensureSimpleUiDistDir({
        resolvePackageJson: () => { throw new Error('not found'); },
        exists: () => false,
      }),
    ).toThrow('SimpleUI package could not be resolved');
  });
});
