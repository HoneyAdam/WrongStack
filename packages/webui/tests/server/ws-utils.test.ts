import { describe, expect, it } from 'vitest';
import { errMessage, generateAuthToken } from '../../src/server/ws-utils.js';

describe('errMessage', () => {
  it('extracts message from Error', () => {
    expect(errMessage(new Error('something broke'))).toBe('something broke');
  });

  it('stringifies non-Error values', () => {
    expect(errMessage('plain string')).toBe('plain string');
    expect(errMessage(42)).toBe('42');
    expect(errMessage(null)).toBe('null');
    expect(errMessage(undefined)).toBe('undefined');
  });

  it('handles Error subclass', () => {
    expect(errMessage(new TypeError('bad type'))).toBe('bad type');
  });
});

describe('generateAuthToken', () => {
  it('returns a 32-character hex string', () => {
    const token = generateAuthToken();
    expect(token).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(token)).toBe(true);
  });

  it('generates unique tokens', () => {
    const a = generateAuthToken();
    const b = generateAuthToken();
    expect(a).not.toBe(b);
  });
});
