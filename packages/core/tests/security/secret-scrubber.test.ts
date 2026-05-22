import { describe, expect, it } from 'vitest';
import { DefaultSecretScrubber } from '../../src/security/secret-scrubber.js';

const s = new DefaultSecretScrubber();

describe('SecretScrubber', () => {
  it('redacts anthropic-style keys', () => {
    const inp = 'token=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGh';
    expect(s.scrub(inp)).toContain('[REDACTED:anthropic_key]');
  });
  it('redacts github PAT', () => {
    const inp = 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';
    expect(s.scrub(inp)).toContain('[REDACTED:github_pat]');
  });
  it('redacts AWS access keys', () => {
    expect(s.scrub('AKIAIOSFODNN7EXAMPLE')).toContain('[REDACTED:aws_access_key]');
  });
  it('redacts JWT-like tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(s.scrub(jwt)).toContain('[REDACTED:jwt]');
  });
  it('redacts mongodb URIs', () => {
    expect(s.scrub('mongodb://user:pass@host/db')).toContain('[REDACTED:mongodb_uri]');
  });
  it('redacts high-entropy env-style assignments', () => {
    expect(s.scrub('MY_API_KEY=abcdef1234567890abcdef1234567890')).toContain(
      '[REDACTED:high_entropy_env]',
    );
  });
  it('leaves normal text untouched', () => {
    expect(s.scrub('hello world')).toBe('hello world');
  });
  it('scrubObject recurses', () => {
    const obj = { nested: { token: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123' } };
    const out = s.scrubObject(obj);
    expect(out.nested.token).toContain('[REDACTED');
  });

  it('scrubs across the 64KB chunk boundary without missing secrets', () => {
    // Inputs larger than SCRUB_CHUNK_BYTES go through the chunked branch.
    // Build a 100KB payload with a secret in each half so we exercise both
    // the early chunk and a chunk after the newline-break boundary.
    const filler = 'x '.repeat(20_000); // ~40 KB
    const newlines = '\n'.repeat(2000); // ~2 KB of newlines for boundary-snap
    const secret1 = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const secret2 = 'ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const blob = `${filler}\n${secret1}\n${newlines}\n${filler}\n${secret2}\n`;
    expect(blob.length).toBeGreaterThan(64 * 1024);
    const scrubbed = s.scrub(blob);
    expect(scrubbed).toContain('[REDACTED:anthropic_key]');
    expect(scrubbed).toContain('[REDACTED:github_pat]');
    expect(scrubbed).not.toContain(secret1);
    expect(scrubbed).not.toContain(secret2);
  });

  it('chunked path keeps total length roughly preserved (no truncation)', () => {
    // A long innocuous text should pass through every chunk and stay intact.
    const blob = 'safe-text\n'.repeat(8000); // ~80 KB
    const out = s.scrub(blob);
    expect(out.length).toBeGreaterThan(70_000);
    expect(out).toContain('safe-text');
  });
});
