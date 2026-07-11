import { describe, it, expect } from 'vitest';
import {
  isDestructivePendingConfirm,
  resolveYoloEligiblePendingConfirms,
  resolveAllPendingConfirms,
} from '../src/server/pending-confirms.js';

describe('pending-confirms', () => {
  describe('isDestructivePendingConfirm', () => {
    it('returns true when riskTier is destructive', () => {
      expect(isDestructivePendingConfirm({ resolve: () => {}, riskTier: 'destructive' })).toBe(true);
    });

    it('returns true when decisionSource is yolo_destructive', () => {
      expect(isDestructivePendingConfirm({ resolve: () => {}, decisionSource: 'yolo_destructive' })).toBe(true);
    });

    it('returns true when both conditions are true', () => {
      expect(isDestructivePendingConfirm({
        resolve: () => {},
        riskTier: 'destructive',
        decisionSource: 'yolo_destructive',
      })).toBe(true);
    });

    it('returns false for standard riskTier', () => {
      expect(isDestructivePendingConfirm({ resolve: () => {}, riskTier: 'standard' })).toBe(false);
    });

    it('returns false for safe riskTier', () => {
      expect(isDestructivePendingConfirm({ resolve: () => {}, riskTier: 'safe' })).toBe(false);
    });

    it('returns false when riskTier is undefined', () => {
      expect(isDestructivePendingConfirm({ resolve: () => {} })).toBe(false);
    });
  });

  describe('resolveYoloEligiblePendingConfirms', () => {
    it('resolves all pending confirms with "yes"', () => {
      const resolves: string[] = [];
      const pending = new Map([
        ['id1', { resolve: (d: string) => resolves.push(d) }],
        ['id2', { resolve: (d: string) => resolves.push(d) }],
      ]);

      resolveYoloEligiblePendingConfirms(pending);

      expect(resolves).toEqual(['yes', 'yes']);
      expect(pending.size).toBe(0);
    });

    it('handles empty map', () => {
      const pending = new Map();
      expect(() => resolveYoloEligiblePendingConfirms(pending)).not.toThrow();
      expect(pending.size).toBe(0);
    });
  });

  describe('resolveAllPendingConfirms', () => {
    it('resolves all pending confirms with given decision', () => {
      const resolves: string[] = [];
      const pending = new Map([
        ['id1', { resolve: (d: string) => resolves.push(d) }],
        ['id2', { resolve: (d: string) => resolves.push(d) }],
      ]);

      resolveAllPendingConfirms(pending, 'deny');

      expect(resolves).toEqual(['deny', 'deny']);
      expect(pending.size).toBe(0);
    });

    it('handles empty map', () => {
      const pending = new Map();
      expect(() => resolveAllPendingConfirms(pending, 'always')).not.toThrow();
      expect(pending.size).toBe(0);
    });

    it('works with "always" decision', () => {
      const resolves: string[] = [];
      const pending = new Map([
        ['id1', { resolve: (d: string) => resolves.push(d) }],
      ]);

      resolveAllPendingConfirms(pending, 'always');

      expect(resolves).toEqual(['always']);
    });
  });
});
