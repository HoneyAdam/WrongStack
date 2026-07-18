import { describe, expect, it } from 'vitest';
import { formatWorkingDirChip } from '../src/hooks/use-working-dir-chip.js';

describe('formatWorkingDirChip', () => {
  it('returns undefined for empty, root, and current-project paths', () => {
    expect(formatWorkingDirChip(undefined, '/repo')).toBeUndefined();
    expect(formatWorkingDirChip('/repo', '/repo')).toBeUndefined();
    expect(formatWorkingDirChip('/repo/.', '/repo/.')).toBeUndefined();
  });

  it('returns a normalized relative path for subdirectories inside the project', () => {
    expect(formatWorkingDirChip('/repo/src/utils', '/repo')).toBe('src/utils');
  });

  // #249: this test uses Windows-style paths (backslash separators), which only
  // path.win32 handles correctly. Skip on non-Windows runners.
  it.skipIf(process.platform !== 'win32')(
    'normalizes Windows-style separators to forward slashes for display',
    () => {
      expect(formatWorkingDirChip('C:\\repo\\src\\utils', 'C:\\repo')).toBe('src/utils');
    },
  );

  it('normalizes a relative root marker back to undefined', () => {
    expect(formatWorkingDirChip('/repo/', '/repo')).toBeUndefined();
  });
});
