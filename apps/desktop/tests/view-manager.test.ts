/**
 * Unit tests for WebUI view-manager module.
 * Tests the pure utility functions that don't require Electron runtime.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock electron module (hoisted to top) to prevent dynamic import errors
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}));

import { safeOpenExternal, sameOrigin } from '../src/main/webui/view-manager.js';
import { OPEN_EXTERNAL_ALLOWED_PROTOCOLS } from '../src/main/state/constants.js';

// ============================================================================
// safeOpenExternal Tests
// ============================================================================

describe('safeOpenExternal', () => {
  it('should return early for invalid URLs', () => {
    // Should not throw for invalid URLs
    expect(() => safeOpenExternal('not-a-url')).not.toThrow();
  });

  it('should return early for empty string', () => {
    expect(() => safeOpenExternal('')).not.toThrow();
  });

  it('should handle protocol validation without error', () => {
    // These are valid protocols - function checks and conditionally opens
    expect(() => safeOpenExternal('https://example.com')).not.toThrow();
    expect(() => safeOpenExternal('http://example.com')).not.toThrow();
    expect(() => safeOpenExternal('mailto:test@example.com')).not.toThrow();
  });

  it('should handle disallowed protocols without error', () => {
    expect(() => safeOpenExternal('file:///etc/passwd')).not.toThrow();
    expect(() => safeOpenExternal('javascript:alert(1)')).not.toThrow();
    expect(() => safeOpenExternal('ftp://example.com')).not.toThrow();
  });

  it('should handle special characters in URL', () => {
    expect(() => safeOpenExternal('https://example.com/path?q=a b&c=d')).not.toThrow();
    expect(() => safeOpenExternal('https://例子.测试')).not.toThrow();
  });
});

// ============================================================================
// sameOrigin Tests
// ============================================================================

describe('sameOrigin', () => {
  it('should return true for identical origins', () => {
    expect(sameOrigin('https://example.com/page1', 'https://example.com/page2')).toBe(true);
  });

  it('should return false for different origins', () => {
    expect(sameOrigin('https://example.com', 'https://other.com')).toBe(false);
  });

  it('should return false for different schemes', () => {
    expect(sameOrigin('http://example.com', 'https://example.com')).toBe(false);
  });

  it('should return false for different ports', () => {
    expect(sameOrigin('https://example.com:8080', 'https://example.com:9090')).toBe(false);
  });

  it('should return true for same origin default port', () => {
    expect(sameOrigin('https://example.com:443/path', 'https://example.com/other')).toBe(true);
  });

  it('should return false when base URL is null', () => {
    expect(sameOrigin('https://example.com', null)).toBe(false);
  });

  it('should return false for invalid candidate URL', () => {
    expect(sameOrigin('not-a-url', 'https://example.com')).toBe(false);
  });

  it('should return false for invalid base URL', () => {
    expect(sameOrigin('https://example.com', 'not-a-url')).toBe(false);
  });

  it('should handle localhost URLs', () => {
    expect(sameOrigin('http://localhost:3000/page1', 'http://localhost:3000/page2')).toBe(true);
    expect(sameOrigin('http://localhost:3000', 'http://localhost:4000')).toBe(false);
  });

  it('should handle IP address URLs', () => {
    expect(sameOrigin('http://127.0.0.1:8080/test', 'http://127.0.0.1:8080/other')).toBe(true);
    expect(sameOrigin('http://127.0.0.1:8080', 'http://127.0.0.2:8080')).toBe(false);
  });
});

// ============================================================================
// OPEN_EXTERNAL_ALLOWED_PROTOCOLS Tests
// ============================================================================

describe('OPEN_EXTERNAL_ALLOWED_PROTOCOLS', () => {
  it('should allow http protocol', () => {
    expect(OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has('http:')).toBe(true);
  });

  it('should allow https protocol', () => {
    expect(OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has('https:')).toBe(true);
  });

  it('should allow mailto protocol', () => {
    expect(OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has('mailto:')).toBe(true);
  });

  it('should not allow file protocol', () => {
    expect(OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has('file:')).toBe(false);
  });

  it('should not allow javascript protocol', () => {
    expect(OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has('javascript:')).toBe(false);
  });

  it('should not allow ftp protocol', () => {
    expect(OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has('ftp:')).toBe(false);
  });

  it('should have exactly 3 allowed protocols', () => {
    expect(OPEN_EXTERNAL_ALLOWED_PROTOCOLS.size).toBe(3);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('URL handling edge cases', () => {
  describe('safeOpenExternal', () => {
    it('should handle URLs with credentials', () => {
      expect(() => safeOpenExternal('https://user:pass@example.com')).not.toThrow();
    });

    it('should handle URLs with fragments', () => {
      expect(() => safeOpenExternal('https://example.com/page#section')).not.toThrow();
    });

    it('should handle URLs with query parameters', () => {
      expect(() => safeOpenExternal('https://example.com?key=value&foo=bar')).not.toThrow();
    });
  });

  describe('sameOrigin', () => {
    it('should handle case-insensitive hostnames', () => {
      expect(sameOrigin('https://EXAMPLE.com', 'https://example.com')).toBe(true);
    });

    it('should handle empty candidate URL', () => {
      expect(sameOrigin('', 'https://example.com')).toBe(false);
    });

    it('should handle very long URLs', () => {
      const longPath = '/'.repeat(1000);
      expect(sameOrigin(`https://example.com${longPath}`, 'https://example.com')).toBe(true);
    });

    it('should handle data URLs as base', () => {
      expect(sameOrigin('https://example.com', 'data:text/html,hello')).toBe(false);
    });

    it('should handle blob URLs', () => {
      // blob: URLs have origin of their creator
      expect(sameOrigin('blob:https://example.com/uuid', 'https://example.com')).toBe(true);
    });
  });
});
