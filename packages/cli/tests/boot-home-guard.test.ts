import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isHomeDirectory } from '../src/boot.js';

/**
 * The home-directory guard prevents wstack from starting when `cwd` is the
 * user's home directory, so it never creates a `.git` repo at the top of
 * the filesystem. These tests pin the pure comparison logic; the warning
 * text and exit code are exercised by the call site in `boot()`.
 */
describe('isHomeDirectory (home-directory startup guard)', () => {
  it('returns true when cwd is exactly the home directory', () => {
    const home = os.homedir();
    expect(isHomeDirectory(home, home)).toBe(true);
  });

  it('returns true despite a trailing separator on cwd', () => {
    const home = os.homedir();
    expect(isHomeDirectory(home + path.sep, home)).toBe(true);
  });

  it('returns true despite a trailing separator on userHome', () => {
    const home = os.homedir();
    expect(isHomeDirectory(home, home + path.sep)).toBe(true);
  });

  it('returns false for a subdirectory of home', () => {
    const home = os.homedir();
    const subdir = path.join(home, 'projects', 'myapp');
    expect(isHomeDirectory(subdir, home)).toBe(false);
  });

  it('returns false for the parent of home', () => {
    const home = os.homedir();
    const parent = path.dirname(home);
    expect(isHomeDirectory(parent, home)).toBe(false);
  });

  it('returns false when cwd and userHome are different roots', () => {
    expect(isHomeDirectory('C:\\Codebox\\project', 'C:\\Users\\ersin')).toBe(false);
    expect(isHomeDirectory('/var/app', '/home/ersin')).toBe(false);
  });

  it('returns false when either argument is empty', () => {
    const home = os.homedir();
    expect(isHomeDirectory('', home)).toBe(false);
    expect(isHomeDirectory(home, '')).toBe(false);
    expect(isHomeDirectory('', '')).toBe(false);
  });

  it('handles relative path segments via resolve', () => {
    const home = os.homedir();
    // `.` inside the home dir should resolve back to home
    expect(isHomeDirectory(path.join(home, '.'), home)).toBe(true);
  });
});
