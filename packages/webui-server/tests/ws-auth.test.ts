import { describe, it, expect, vi } from 'vitest';

import {
  isLoopbackHostname,
  isLoopbackBind,
  isWildcardBind,
  tokenMatches,
  extractToken,
  extractTokenFromCookie,
  hostHeaderOk,
  verifyClient,
} from '../src/server/ws-auth.js';

describe('ws-auth', () => {
  describe('isLoopbackHostname', () => {
    it('returns true for localhost', () => {
      expect(isLoopbackHostname('localhost')).toBe(true);
    });

    it('returns true for 127.0.0.1', () => {
      expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    });

    it('returns true for ::1', () => {
      expect(isLoopbackHostname('::1')).toBe(true);
    });

    it('returns true for [::1]', () => {
      expect(isLoopbackHostname('[::1]')).toBe(true);
    });

    it('returns false for non-loopback hosts', () => {
      expect(isLoopbackHostname('example.com')).toBe(false);
      expect(isLoopbackHostname('192.168.1.1')).toBe(false);
    });
  });

  describe('isLoopbackBind', () => {
    it('returns true for 127.0.0.1', () => {
      expect(isLoopbackBind('127.0.0.1')).toBe(true);
    });

    it('returns true for ::1', () => {
      expect(isLoopbackBind('::1')).toBe(true);
    });

    it('returns true for localhost', () => {
      expect(isLoopbackBind('localhost')).toBe(true);
    });

    it('returns false for wildcard addresses', () => {
      expect(isLoopbackBind('0.0.0.0')).toBe(false);
      expect(isLoopbackBind('::')).toBe(false);
    });

    it('returns false for LAN addresses', () => {
      expect(isLoopbackBind('192.168.1.1')).toBe(false);
      expect(isLoopbackBind('10.0.0.1')).toBe(false);
    });
  });

  describe('isWildcardBind', () => {
    it('returns true for 0.0.0.0', () => {
      expect(isWildcardBind('0.0.0.0')).toBe(true);
    });

    it('returns true for ::', () => {
      expect(isWildcardBind('::')).toBe(true);
    });

    it('returns true for [::]', () => {
      expect(isWildcardBind('[::]')).toBe(true);
    });

    it('returns false for loopback addresses', () => {
      expect(isWildcardBind('127.0.0.1')).toBe(false);
      expect(isWildcardBind('localhost')).toBe(false);
    });
  });

  describe('tokenMatches', () => {
    it('returns true for matching tokens', () => {
      expect(tokenMatches('abc123', 'abc123')).toBe(true);
    });

    it('returns false for empty provided token', () => {
      expect(tokenMatches('', 'abc123')).toBe(false);
    });

    it('returns false for undefined token', () => {
      expect(tokenMatches(undefined, 'abc123')).toBe(false);
    });

    it('returns false for length mismatch', () => {
      expect(tokenMatches('short', 'very-long-token')).toBe(false);
    });

    it('returns false for different tokens of same length', () => {
      expect(tokenMatches('aaaaaa', 'bbbbbb')).toBe(false);
    });
  });

  describe('extractToken', () => {
    it('extracts token from query param', () => {
      expect(extractToken('/?token=mysecret')).toBe('mysecret');
    });

    it('extracts token with other params', () => {
      expect(extractToken('/path?foo=1&token=secret&bar=2')).toBe('secret');
    });

    it('returns undefined when no token param', () => {
      expect(extractToken('/?foo=bar')).toBeUndefined();
    });

    it('returns undefined on empty url', () => {
      expect(extractToken('')).toBeNull();
    });
  });

  describe('extractTokenFromCookie', () => {
    it('extracts ws_token from cookie header', () => {
      expect(extractTokenFromCookie('ws_token=mysecret; other=value')).toBe('mysecret');
    });

    it('handles array of cookie headers', () => {
      expect(extractTokenFromCookie(['ws_token=secret1', 'other=value'])).toBe('secret1');
    });

    it('returns undefined when no cookie header', () => {
      expect(extractTokenFromCookie(undefined)).toBeUndefined();
    });

    it('returns undefined when ws_token not present', () => {
      expect(extractTokenFromCookie('other=value')).toBeUndefined();
    });

    it('handles url-encoded cookie values', () => {
      expect(extractTokenFromCookie('ws_token=secret%20value')).toBe('secret value');
    });

    it('handles malformed url-encoding gracefully', () => {
      // %GG is invalid hex - should fall back to raw value
      const result = extractTokenFromCookie('ws_token=secret%GG');
      expect(result).toBeDefined();
    });

    it('handles empty parts in cookie header', () => {
      expect(extractTokenFromCookie(';; ws_token=val ;;')).toBe('val');
    });
  });

  describe('hostHeaderOk', () => {
    it('returns true for non-loopback binds', () => {
      expect(hostHeaderOk({ hostHeader: 'evil.com', wsHost: '0.0.0.0' })).toBe(true);
    });

    it('returns false for loopback bind with missing host', () => {
      expect(hostHeaderOk({ hostHeader: undefined, wsHost: '127.0.0.1' })).toBe(false);
    });

    it('returns false for loopback bind with empty host', () => {
      expect(hostHeaderOk({ hostHeader: '', wsHost: '127.0.0.1' })).toBe(false);
    });

    it('returns true for loopback bind with localhost host', () => {
      expect(hostHeaderOk({ hostHeader: 'localhost:3456', wsHost: '127.0.0.1' })).toBe(true);
    });

    it('returns true for loopback bind with 127.0.0.1 host', () => {
      expect(hostHeaderOk({ hostHeader: '127.0.0.1:3456', wsHost: '127.0.0.1' })).toBe(true);
    });

    it('returns false for loopback bind with non-loopback host', () => {
      expect(hostHeaderOk({ hostHeader: 'evil.com', wsHost: '127.0.0.1' })).toBe(false);
    });

    it('handles IPv6 host with port', () => {
      expect(hostHeaderOk({ hostHeader: '[::1]:3456', wsHost: '::1' })).toBe(true);
    });

    it('returns true when hostname is in allowedHostnames', () => {
      expect(hostHeaderOk({
        hostHeader: 'tunnel.example.com',
        wsHost: '127.0.0.1',
        allowedHostnames: ['tunnel.example.com'],
      })).toBe(true);
    });

    it('returns false when host header is unparseable', () => {
      expect(hostHeaderOk({ hostHeader: 'not a valid host header with spaces', wsHost: '127.0.0.1' })).toBe(false);
    });
  });

  describe('verifyClient', () => {
    const token = 'test-token-123';
    const makeInput = (overrides: Record<string, unknown> = {}) => ({
      url: '/',
      wsHost: '127.0.0.1',
      expectedToken: token,
      ...overrides,
    });

    it('allows loopback origin without token on loopback bind', () => {
      expect(verifyClient(makeInput({
        origin: 'http://localhost:3456',
      }))).toBe(true);
    });

    it('allows 127.0.0.1 origin without token on loopback bind', () => {
      expect(verifyClient(makeInput({
        origin: 'http://127.0.0.1:3456',
      }))).toBe(true);
    });

    it('rejects file:// origins on loopback bind', () => {
      expect(verifyClient(makeInput({
        origin: 'file:///index.html',
      }))).toBe(false);
    });

    it('rejects non-loopback origin without token cookie', () => {
      expect(verifyClient(makeInput({
        origin: 'http://example.com',
        wsHost: '127.0.0.1',
      }))).toBe(false);
    });

    it('allows non-loopback origin with valid cookie token', () => {
      expect(verifyClient(makeInput({
        origin: 'http://example.com',
        cookieHeader: 'ws_token=test-token-123',
      }))).toBe(true);
    });

    it('allows non-loopback origin with valid URL token for browser when allowBrowserUrlToken is set', () => {
      expect(verifyClient(makeInput({
        origin: 'http://tunnel.example.com',
        url: '/?token=test-token-123',
        allowBrowserUrlToken: true,
        allowedHostnames: ['tunnel.example.com'],
      }))).toBe(true);
    });

    it('rejects non-loopback origin without matching allowedHostname', () => {
      expect(verifyClient(makeInput({
        origin: 'http://evil.com',
        url: '/?token=test-token-123',
        allowBrowserUrlToken: true,
        allowedHostnames: ['good.example.com'],
      }))).toBe(false);
    });

    it('rejects unparseable origin', () => {
      expect(verifyClient(makeInput({
        origin: 'not a valid url',
      }))).toBe(false);
    });

    it('allows non-browser client with valid URL token on non-loopback bind', () => {
      expect(verifyClient(makeInput({
        origin: undefined,
        url: '/?token=test-token-123',
        wsHost: '0.0.0.0',
      }))).toBe(true);
    });

    it('rejects non-browser client from remote IP on wildcard bind without token', () => {
      expect(verifyClient(makeInput({
        origin: undefined,
        url: '/',
        wsHost: '0.0.0.0',
        remoteAddress: '192.168.1.1',
      }))).toBe(false);
    });

    it('allows non-browser client from loopback IP on wildcard bind without token', () => {
      expect(verifyClient(makeInput({
        origin: undefined,
        url: '/',
        wsHost: '0.0.0.0',
        remoteAddress: '127.0.0.1',
      }))).toBe(true);
    });

    it('allows non-browser client on loopback bind without token', () => {
      expect(verifyClient(makeInput({
        origin: undefined,
        url: '/',
      }))).toBe(true);
    });

    it('rejects client when hostHeader check fails on loopback bind', () => {
      expect(verifyClient(makeInput({
        hostHeader: 'evil.com',
        wsHost: '127.0.0.1',
      }))).toBe(false);
    });

    it('rejects loopback origin with requireToken=true without cookie', () => {
      expect(verifyClient(makeInput({
        origin: 'http://localhost:3456',
        requireToken: true,
      }))).toBe(false);
    });

    it('allows loopback origin with requireToken=true and valid cookie', () => {
      expect(verifyClient(makeInput({
        origin: 'http://localhost:3456',
        requireToken: true,
        cookieHeader: 'ws_token=test-token-123',
      }))).toBe(true);
    });

    it('rejects non-loopback origin on non-loopback bind without cookie', () => {
      expect(verifyClient(makeInput({
        origin: 'http://example.com',
        wsHost: '0.0.0.0',
      }))).toBe(false);
    });

    it('allows non-browser client with valid cookie token', () => {
      expect(verifyClient(makeInput({
        origin: undefined,
        cookieHeader: 'ws_token=test-token-123',
      }))).toBe(true);
    });
  });
});
