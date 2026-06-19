import { describe, expect, it } from 'vitest';
import { normalizeTokenSavingTier, type TokenSavingTier } from '../../src/types/config.js';

describe('normalizeTokenSavingTier', () => {
  describe('boolean input (backward compatibility)', () => {
    it('returns "off" for undefined', () => {
      expect(normalizeTokenSavingTier(undefined)).toBe('off');
    });

    it('returns "off" for false', () => {
      expect(normalizeTokenSavingTier(false)).toBe('off');
    });

    it('returns "medium" for true', () => {
      expect(normalizeTokenSavingTier(true)).toBe('medium');
    });
  });

  describe('string input (tier values)', () => {
    it('returns "off" for "off"', () => {
      expect(normalizeTokenSavingTier('off')).toBe('off');
    });

    it('returns "minimal" for "minimal"', () => {
      expect(normalizeTokenSavingTier('minimal')).toBe('minimal');
    });

    it('returns "light" for "light"', () => {
      expect(normalizeTokenSavingTier('light')).toBe('light');
    });

    it('returns "medium" for "medium"', () => {
      expect(normalizeTokenSavingTier('medium')).toBe('medium');
    });

    it('returns "aggressive" for "aggressive"', () => {
      expect(normalizeTokenSavingTier('aggressive')).toBe('aggressive');
    });
  });

  describe('invalid string input → "off"', () => {
    it('returns "off" for unknown tier string', () => {
      expect(normalizeTokenSavingTier('tiny')).toBe('off');
      expect(normalizeTokenSavingTier('MAX')).toBe('off');
      expect(normalizeTokenSavingTier('')).toBe('off');
    });

    it('returns "off" for random garbage', () => {
      expect(normalizeTokenSavingTier('foobar' as TokenSavingTier)).toBe('off');
    });
  });

  describe('return type is always TokenSavingTier', () => {
    it('all valid inputs produce valid TokenSavingTier values', () => {
      const tiers: TokenSavingTier[] = ['off', 'minimal', 'light', 'medium', 'aggressive'];
      for (const t of tiers) {
        expect(normalizeTokenSavingTier(t)).toBe(t);
      }
      // Boolean inputs
      expect(normalizeTokenSavingTier(true)).toBe('medium');
      expect(normalizeTokenSavingTier(false)).toBe('off');
      expect(normalizeTokenSavingTier(undefined)).toBe('off');
    });
  });
});
