import { describe, expect, it } from 'vitest';
import { sddLifecycleEntry } from '../src/sdd-lifecycle-entry.js';

describe('sddLifecycleEntry', () => {
  // ── Live cleanupWorktrees() → bare number ───────────────────────────────
  describe('bare count from cleanupWorktrees', () => {
    it('returns info when count > 0 (plural)', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', 3);
      expect(r).toEqual({ kind: 'info', text: 'Cleaned 3 SDD worktrees.' });
    });

    it('returns info when count === 1 (singular)', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', 1);
      expect(r).toEqual({ kind: 'info', text: 'Cleaned 1 SDD worktree.' });
    });

    it('returns warn when count === 0', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', 0);
      expect(r).toEqual({
        kind: 'warn',
        text: 'No SDD worktrees to clean (stop the run first if it is live).',
      });
    });

    it('returns warn when count is negative (edge case)', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', -1);
      expect(r).toEqual({
        kind: 'warn',
        text: 'No SDD worktrees to clean (stop the run first if it is live).',
      });
    });
  });

  // ── Live rollback() → { ok, reverted, reason? } ─────────────────────────
  describe('live rollback result (no `op` field)', () => {
    it('returns info when ok and reverted > 0 (plural)', () => {
      const r = sddLifecycleEntry('rollback', { ok: true, reverted: 2 });
      expect(r).toEqual({
        kind: 'info',
        text: 'Rolled back 2 run commits (revert commits added).',
      });
    });

    it('returns info when ok and reverted === 1 (singular)', () => {
      const r = sddLifecycleEntry('rollback', { ok: true, reverted: 1 });
      expect(r).toEqual({
        kind: 'info',
        text: 'Rolled back 1 run commit (revert commits added).',
      });
    });

    it('returns info when ok and reverted === 0', () => {
      const r = sddLifecycleEntry('rollback', { ok: true, reverted: 0 });
      expect(r).toEqual({ kind: 'info', text: 'Nothing to roll back.' });
    });

    it('returns warn when !ok with reason', () => {
      const r = sddLifecycleEntry('rollback', {
        ok: false,
        reverted: 0,
        reason: 'conflict detected',
      });
      expect(r).toEqual({
        kind: 'warn',
        text: 'Rollback failed: conflict detected',
      });
    });

    it('returns warn when !ok without reason', () => {
      const r = sddLifecycleEntry('rollback', { ok: false, reverted: 0 });
      expect(r).toEqual({
        kind: 'warn',
        text: 'Rollback failed: unknown error',
      });
    });
  });

  // ── Host SddLifecycleResult (has `op` field) ───────────────────────────
  describe('host SddLifecycleResult — cleanup_worktrees', () => {
    it('returns info when removed > 0 (plural)', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', {
        ok: true,
        op: 'cleanup_worktrees',
        removed: 5,
      });
      expect(r).toEqual({ kind: 'info', text: 'Cleaned 5 SDD worktrees.' });
    });

    it('returns info when removed === 1 (singular)', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', {
        ok: true,
        op: 'cleanup_worktrees',
        removed: 1,
      });
      expect(r).toEqual({ kind: 'info', text: 'Cleaned 1 SDD worktree.' });
    });

    it('returns warn when removed === 0', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', {
        ok: true,
        op: 'cleanup_worktrees',
        removed: 0,
      });
      expect(r).toEqual({ kind: 'warn', text: 'No SDD worktrees to clean.' });
    });

    it('falls back removed ?? 0 when removed is undefined', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', {
        ok: true,
        op: 'cleanup_worktrees',
      } as any);
      expect(r).toEqual({ kind: 'warn', text: 'No SDD worktrees to clean.' });
    });

    it('returns warn when !ok with reason', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', {
        ok: false,
        op: 'cleanup_worktrees',
        reason: 'timeout',
      });
      expect(r).toEqual({
        kind: 'warn',
        text: 'Clean failed: timeout',
      });
    });

    it('returns warn when !ok without reason', () => {
      const r = sddLifecycleEntry('cleanup_worktrees', {
        ok: false,
        op: 'cleanup_worktrees',
      });
      expect(r).toEqual({
        kind: 'warn',
        text: 'Clean failed: unknown error',
      });
    });
  });

  describe('host SddLifecycleResult — rollback', () => {
    it('returns info when reverted > 0 (plural)', () => {
      const r = sddLifecycleEntry('rollback', {
        ok: true,
        op: 'rollback',
        reverted: 3,
      });
      expect(r).toEqual({
        kind: 'info',
        text: 'Rolled back 3 run commits.',
      });
    });

    it('returns info when reverted === 1 (singular)', () => {
      const r = sddLifecycleEntry('rollback', {
        ok: true,
        op: 'rollback',
        reverted: 1,
      });
      expect(r).toEqual({
        kind: 'info',
        text: 'Rolled back 1 run commit.',
      });
    });

    it('returns info with nothing-to-rollback when reverted === 0', () => {
      const r = sddLifecycleEntry('rollback', {
        ok: true,
        op: 'rollback',
        reverted: 0,
      });
      expect(r).toEqual({
        kind: 'info',
        text: 'Nothing to roll back.',
      });
    });

    it('falls back reverted ?? 0 when reverted is undefined', () => {
      const r = sddLifecycleEntry('rollback', {
        ok: true,
        op: 'rollback',
      } as any);
      expect(r).toEqual({
        kind: 'info',
        text: 'Nothing to roll back.',
      });
    });

    it('returns warn when !ok with reason', () => {
      const r = sddLifecycleEntry('rollback', {
        ok: false,
        op: 'rollback',
        reason: 'merge conflict',
      });
      expect(r).toEqual({
        kind: 'warn',
        text: 'Rollback failed: merge conflict',
      });
    });
  });

  describe('host SddLifecycleResult — destroy', () => {
    it('returns info with full details when all fields present (plural)', () => {
      const r = sddLifecycleEntry('destroy', {
        ok: true,
        op: 'destroy',
        removed: 2,
        deleted: ['main', 'feature'],
        reverted: 1,
        reason: 'completed',
      });
      expect(r).toEqual({
        kind: 'info',
        text: 'SDD project destroyed — 2 worktrees removed · deleted main, feature · 1 commit reverted. (completed)',
      });
    });

    it('returns info when only removed is present (singular)', () => {
      const r = sddLifecycleEntry('destroy', {
        ok: true,
        op: 'destroy',
        removed: 1,
      });
      expect(r).toEqual({
        kind: 'info',
        text: 'SDD project destroyed — 1 worktree removed.',
      });
    });

    it('returns info when removed is 0 and no deleted/reverted', () => {
      const r = sddLifecycleEntry('destroy', {
        ok: true,
        op: 'destroy',
        removed: 0,
      });
      expect(r).toEqual({
        kind: 'info',
        text: 'SDD project destroyed — 0 worktrees removed.',
      });
    });

    it('returns info when deleted is empty and reverted is 0', () => {
      const r = sddLifecycleEntry('destroy', {
        ok: true,
        op: 'destroy',
        deleted: [],
        reverted: 0,
      });
      expect(r).toEqual({
        kind: 'info',
        text: 'SDD project destroyed — 0 worktrees removed.',
      });
    });

    it('falls back removed ?? 0, reverted ?? 0 when undefined', () => {
      const r = sddLifecycleEntry('destroy', {
        ok: true,
        op: 'destroy',
      } as any);
      expect(r).toEqual({
        kind: 'info',
        text: 'SDD project destroyed — 0 worktrees removed.',
      });
    });
  });

  describe('host SddLifecycleResult — unknown op label', () => {
    it('uses the op value directly in the label for unknown ops', () => {
      const r = sddLifecycleEntry('destroy' as any, {
        ok: false,
        op: 'destroy' as any,
        reason: 'something broke',
      });
      expect(r).toEqual({
        kind: 'warn',
        text: 'Destroy failed: something broke',
      });
    });
  });
});
