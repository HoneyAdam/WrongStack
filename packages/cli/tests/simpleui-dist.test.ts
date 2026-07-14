import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSimpleUiDistDir } from '../src/simpleui-dist.js';

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
