import { describe, expect, it } from 'vitest';
import {
  getInputString,
  isClearlyDestructiveBashCommand,
  pathLooksInsideProject,
} from '../../src/security/yolo-risk.js';

const ROOT = process.platform === 'win32' ? 'C:\\proj' : '/proj';
const OUTSIDE = process.platform === 'win32' ? 'C:\\other\\x' : '/other/x';

describe('yolo-risk — extra coverage', () => {
  describe('getInputString', () => {
    it('returns undefined for non-object inputs', () => {
      expect(getInputString(null, 'k')).toBeUndefined();
      expect(getInputString('str', 'k')).toBeUndefined();
      expect(getInputString(42, 'k')).toBeUndefined();
    });
    it('returns the string value or undefined for a non-string field', () => {
      expect(getInputString({ k: 'v' }, 'k')).toBe('v');
      expect(getInputString({ k: 123 }, 'k')).toBeUndefined();
    });
  });

  describe('pathLooksInsideProject', () => {
    it('returns false without a project root', () => {
      expect(pathLooksInsideProject('x', undefined)).toBe(false);
    });
    it('treats ~ as outside the project', () => {
      expect(pathLooksInsideProject('~', ROOT)).toBe(false);
      expect(pathLooksInsideProject('~/cache', ROOT)).toBe(false);
    });
    it('recognizes a path inside the project and rejects an escape', () => {
      expect(pathLooksInsideProject('src/index.ts', ROOT)).toBe(true);
      expect(pathLooksInsideProject('../escape', ROOT)).toBe(false);
    });
  });

  describe('isClearlyDestructiveBashCommand', () => {
    it('returns false for an empty command', () => {
      expect(isClearlyDestructiveBashCommand('   ', ROOT)).toBe(false);
    });
    it('flags rm -rf with no target (whole-cwd wipe)', () => {
      expect(isClearlyDestructiveBashCommand('rm -rf', ROOT)).toBe(true);
    });
    it('flags a filesystem / drive / home root wipe', () => {
      expect(isClearlyDestructiveBashCommand('rm -rf /', ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand('rm -rf ~', ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand('rm -rf C:\\', ROOT)).toBe(true);
    });
    it('does NOT flag deleting an outside non-system path (recoverable-scale)', () => {
      // A few files or an arbitrary sibling dir is recoverable, not catastrophic.
      expect(isClearlyDestructiveBashCommand(`rm -rf ${OUTSIDE}`, ROOT)).toBe(false);
      expect(isClearlyDestructiveBashCommand('rm -rf node_modules', ROOT)).toBe(false);
    });
    it('flags Windows rmdir /s, del, and Remove-Item -Recurse on a system directory', () => {
      expect(isClearlyDestructiveBashCommand('rmdir /s C:\\Windows', ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand('del C:\\Windows', ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand('Remove-Item -Recurse C:\\Users', ROOT)).toBe(true);
    });
    it('skips empty quoted tokens without crashing', () => {
      expect(isClearlyDestructiveBashCommand('echo ""', ROOT)).toBe(false);
      // Empty delete target → isCatastrophicDeleteTarget's empty-token guard.
      expect(isClearlyDestructiveBashCommand('rm -rf ""', ROOT)).toBe(false);
    });
    it('flags catastrophic disk/partition patterns', () => {
      expect(isClearlyDestructiveBashCommand('mkfs.ext4 /dev/sda1', ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand('diskpart', ROOT)).toBe(true);
    });
    it('does NOT flag recoverable dev operations (git/db/chmod) or reads', () => {
      expect(isClearlyDestructiveBashCommand('git reset --hard', ROOT)).toBe(false);
      expect(isClearlyDestructiveBashCommand('DROP TABLE users', ROOT)).toBe(false);
      expect(isClearlyDestructiveBashCommand('cd ..', ROOT)).toBe(false);
      expect(isClearlyDestructiveBashCommand(`cat ${OUTSIDE}`, ROOT)).toBe(false);
    });
    it('does NOT flag a single-file write outside the project, but flags a raw device write', () => {
      expect(isClearlyDestructiveBashCommand(`echo x > ${OUTSIDE}`, ROOT)).toBe(false);
      expect(isClearlyDestructiveBashCommand('cat payload > /dev/sda', ROOT)).toBe(true);
    });
    it('auto-approves a Windows `cd /d <root> && dir … | findstr` chain (regression)', () => {
      // Reported false-positive: the old `cd /…` heuristic matched `cd /d`, so a
      // plain directory listing prompted under YOLO. Navigation + read must not gate.
      const cmd = `cd /d "${ROOT}" && dir docs\\ 2>nul | findstr /i "ideas research notes"`;
      expect(isClearlyDestructiveBashCommand(cmd, ROOT)).toBe(false);
    });
  });
});
