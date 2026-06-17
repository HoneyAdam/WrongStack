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
    it('flags rm -rf an outside path but allows an in-project path', () => {
      expect(isClearlyDestructiveBashCommand(`rm -rf ${OUTSIDE}`, ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand('rm -rf node_modules', ROOT)).toBe(false);
    });
    it('flags Windows rmdir /s, del/erase, and Remove-Item -Recurse on outside paths', () => {
      expect(isClearlyDestructiveBashCommand(`rmdir /s ${OUTSIDE}`, ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand(`del ${OUTSIDE}`, ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand(`Remove-Item -Recurse ${OUTSIDE}`, ROOT)).toBe(true);
    });
    it('skips empty quoted tokens without crashing', () => {
      expect(isClearlyDestructiveBashCommand('echo ""', ROOT)).toBe(false);
      // Empty delete target → pathTokenIsOutsideProject's empty-token guard.
      expect(isClearlyDestructiveBashCommand('rm -rf ""', ROOT)).toBe(false);
    });
    it('flags known destructive patterns', () => {
      expect(isClearlyDestructiveBashCommand('git reset --hard', ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand('DROP TABLE users', ROOT)).toBe(true);
    });
    it('flags cd / path escapes outside the project', () => {
      expect(isClearlyDestructiveBashCommand('cd ..', ROOT)).toBe(true);
      expect(isClearlyDestructiveBashCommand(`cat ${OUTSIDE}`, ROOT)).toBe(true);
    });
  });
});
