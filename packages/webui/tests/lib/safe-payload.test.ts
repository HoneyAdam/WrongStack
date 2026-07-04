import { describe, expect, it } from 'vitest';
import { safePayload } from '../../src/lib/ws-client-utils';
import type { WSServerMessage } from '../../src/types';

function msg(payload: Record<string, unknown>): WSServerMessage {
  return { type: 'provider.text_delta', payload } as unknown as WSServerMessage;
}

describe('safePayload', () => {
  it('returns the payload when all required keys match their kind', () => {
    const m = msg({ text: 'hi', messageId: 'm1', n: 3 });
    const p = safePayload<{ text: string; messageId: string; n: number }>(m, {
      text: 'string',
      messageId: 'string',
      n: 'number',
    });
    expect(p).not.toBeNull();
    expect(p?.text).toBe('hi');
    expect(p?.messageId).toBe('m1');
    expect(p?.n).toBe(3);
  });

  it('returns null when a required key is missing', () => {
    const m = msg({ text: 'hi' });
    const p = safePayload(m, { text: 'string', messageId: 'string' });
    expect(p).toBeNull();
  });

  it('returns null when a required key has the wrong type', () => {
    const m = msg({ text: 42, messageId: 'm1' });
    const p = safePayload(m, { text: 'string', messageId: 'string' });
    expect(p).toBeNull();
  });

  it('validates optional keys only when present', () => {
    const m = msg({ text: 'hi', messageId: 'm1', cost: 0.5 });
    const p = safePayload<{ text: string; messageId: string; cost?: number }>(
      m,
      { text: 'string', messageId: 'string' },
      { cost: 'number' },
    );
    expect(p?.cost).toBe(0.5);
  });

  it('rejects an optional key with the wrong type', () => {
    const m = msg({ text: 'hi', messageId: 'm1', cost: 'free' });
    const p = safePayload(m, { text: 'string', messageId: 'string' }, { cost: 'number' });
    expect(p).toBeNull();
  });

  it('accepts object and array kinds', () => {
    const m = msg({ input: { a: 1 }, tags: ['x', 'y'] });
    const p = safePayload<{ input: object; tags: string[] }>(m, {
      input: 'object',
      tags: 'array',
    });
    expect(p?.input).toEqual({ a: 1 });
    expect(p?.tags).toEqual(['x', 'y']);
  });

  it('rejects null for a required key', () => {
    const m = msg({ text: null, messageId: 'm1' });
    const p = safePayload(m, { text: 'string' });
    expect(p).toBeNull();
  });

  it('handles a missing payload gracefully', () => {
    const m = { type: 'provider.text_delta' } as unknown as WSServerMessage;
    const p = safePayload(m, { text: 'string' });
    expect(p).toBeNull();
  });
});
