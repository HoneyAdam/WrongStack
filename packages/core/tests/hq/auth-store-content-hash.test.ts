/**
 * Focused unit tests for `hqAuthContentHash`.
 *
 * The helper computes a SHA-256 over a *redacted* projection of an
 * `HqAuthFile`. These tests pin its two governing invariants:
 *
 *   - **Secret-stable** — rotating any combination of raw token strings,
 *     `passwordHash`, or `cookieSecret` (without touching structural
 *     state) must NOT flip the hash. This is what makes the hash safe to
 *     log: a leaked hash can't be reversed to recover secrets, and a
 *     secret rotation doesn't make every prior audit entry's hash stale.
 *
 *   - **Structure-sensitive** — any change an operator would care about
 *     (token id / label / capabilities / expiry, `version`, alert rules,
 *     redaction policy, presence-vs-absence of password / cookie secret)
 *     MUST flip the hash, otherwise the forensic-tie-back purpose fails.
 *
 * The function is pure and synchronous, so every case is a one-shot
 * `expect(...).toBe(...)` / `.not.toBe(...)` — no async, no fixtures.
 *
 * @vitest-environment node
 */
import {
  HQ_AUTH_CONTENT_HASH_REDACTED,
  HQ_AUTH_FILE_VERSION,
  hqAuthContentHash,
  mintHqToken,
  type HqAuthFile,
  type HqToken,
} from '@wrongstack/core';
import { describe, expect, it } from 'vitest';

const FIXED_UPDATED_AT = '2026-07-19T12:00:00.000Z';

function makeToken(overrides: Partial<HqToken> = {}): HqToken {
  return {
    ...mintHqToken(),
    id: 'token-id-stable',
    createdAt: '2026-07-19T11:00:00.000Z',
    ...overrides,
  };
}

function makeFile(overrides: Partial<HqAuthFile> = {}): HqAuthFile {
  return {
    version: HQ_AUTH_FILE_VERSION,
    updatedAt: FIXED_UPDATED_AT,
    browserTokens: [makeToken()],
    ...overrides,
  };
}

describe('hqAuthContentHash — secret-stable invariants', () => {
  it('is unchanged when only a raw token string rotates', () => {
    const baseline = makeFile();
    const rotated = makeFile({
      browserTokens: [makeToken({ token: 'a-different-raw-secret' })],
    });
    expect(hqAuthContentHash(rotated)).toBe(hqAuthContentHash(baseline));
  });

  it('is unchanged when only the passwordHash rotates', () => {
    const baseline = makeFile({ passwordHash: 'hash-v1' });
    const rotated = makeFile({ passwordHash: 'hash-v2' });
    expect(hqAuthContentHash(rotated)).toBe(hqAuthContentHash(baseline));
  });

  it('is unchanged when only the cookieSecret rotates', () => {
    const baseline = makeFile({ cookieSecret: 'cookie-v1' });
    const rotated = makeFile({ cookieSecret: 'cookie-v2' });
    expect(hqAuthContentHash(rotated)).toBe(hqAuthContentHash(baseline));
  });

  it('is unchanged when every secret rotates simultaneously', () => {
    const baseline = makeFile({
      browserTokens: [makeToken({ token: 'tok-1' })],
      passwordHash: 'hash-1',
      cookieSecret: 'cookie-1',
    });
    const rotated = makeFile({
      browserTokens: [makeToken({ token: 'tok-2' })],
      passwordHash: 'hash-2',
      cookieSecret: 'cookie-2',
    });
    expect(hqAuthContentHash(rotated)).toBe(hqAuthContentHash(baseline));
  });
});

describe('hqAuthContentHash — structure-sensitive invariants', () => {
  it('flips when a token id changes', () => {
    const baseline = makeFile();
    const relabeled = makeFile({
      browserTokens: [makeToken({ id: 'token-id-different' })],
    });
    expect(hqAuthContentHash(relabeled)).not.toBe(hqAuthContentHash(baseline));
  });

  it('flips when a token label is added', () => {
    const baseline = makeFile();
    const relabeled = makeFile({
      browserTokens: [makeToken({ label: 'production' })],
    });
    expect(hqAuthContentHash(relabeled)).not.toBe(hqAuthContentHash(baseline));
  });

  it('flips when capabilities change', () => {
    const baseline = makeFile({
      browserTokens: [makeToken({ capabilities: ['control.enqueue'] })],
    });
    const widened = makeFile({
      browserTokens: [makeToken({ capabilities: ['control.enqueue', 'control.execute'] })],
    });
    expect(hqAuthContentHash(widened)).not.toBe(hqAuthContentHash(baseline));
  });

  it('flips when expiresAt is added', () => {
    const baseline = makeFile();
    const expiring = makeFile({
      browserTokens: [makeToken({ expiresAt: '2026-08-19T12:00:00.000Z' })],
    });
    expect(hqAuthContentHash(expiring)).not.toBe(hqAuthContentHash(baseline));
  });

  it('flips when the schema version changes', () => {
    const baseline = makeFile();
    const upgraded = makeFile({ version: 2 as unknown as typeof HQ_AUTH_FILE_VERSION });
    expect(hqAuthContentHash(upgraded)).not.toBe(hqAuthContentHash(baseline));
  });

  it('flips when alert rules are added', () => {
    const baseline = makeFile();
    const withRules = makeFile({
      alertRules: {
        cost: { enabled: true, thresholdUsd: 10 },
      } as unknown as HqAuthFile['alertRules'],
    });
    expect(hqAuthContentHash(withRules)).not.toBe(hqAuthContentHash(baseline));
  });

  it('flips when the redaction policy changes', () => {
    const baseline = makeFile();
    const tightened = makeFile({
      redactionPolicy: { redactToolResults: true } as unknown as HqAuthFile['redactionPolicy'],
    });
    expect(hqAuthContentHash(tightened)).not.toBe(hqAuthContentHash(baseline));
  });

  it('flips when a password is added (presence vs absence)', () => {
    const baseline = makeFile(); // no passwordHash
    const withPassword = makeFile({ passwordHash: 'new-hash' });
    expect(hqAuthContentHash(withPassword)).not.toBe(hqAuthContentHash(baseline));
  });

  it('flips when a cookie secret is added (presence vs absence)', () => {
    const baseline = makeFile(); // no cookieSecret
    const withCookie = makeFile({ cookieSecret: 'new-cookie' });
    expect(hqAuthContentHash(withCookie)).not.toBe(hqAuthContentHash(baseline));
  });
});

describe('hqAuthContentHash — format + identity invariants', () => {
  it('returns a 64-char lowercase-hex SHA-256 digest', () => {
    const hash = hqAuthContentHash(makeFile());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: the same file hashes identically across calls', () => {
    const file = makeFile();
    expect(hqAuthContentHash(file)).toBe(hqAuthContentHash(file));
  });

  it('references the exported HQ_AUTH_CONTENT_HASH_REDACTED sentinel', () => {
    // Sanity-check the sentinel is the documented literal — if this ever
    // drifts, downstream forensic tooling that substitutes the constant
    // would silently produce different hashes than the helper.
    expect(HQ_AUTH_CONTENT_HASH_REDACTED).toBe('<redacted>');
  });
});
