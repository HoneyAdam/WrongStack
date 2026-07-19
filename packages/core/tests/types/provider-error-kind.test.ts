import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  StreamHangError,
  classifyProviderError,
  isContextOverflowShaped,
  isRetryableKind,
} from '../../src/types/provider.js';
import { ERROR_CODES } from '../../src/types/errors.js';

describe('classifyProviderError', () => {
  it('classifies by status code', () => {
    expect(classifyProviderError(0)).toBe('network');
    expect(classifyProviderError(408)).toBe('timeout');
    expect(classifyProviderError(429)).toBe('rate_limit');
    expect(classifyProviderError(529)).toBe('overloaded');
    expect(classifyProviderError(500)).toBe('server');
    expect(classifyProviderError(503)).toBe('server');
    expect(classifyProviderError(599)).toBe('stream_hang');
    expect(classifyProviderError(401)).toBe('auth');
    expect(classifyProviderError(403)).toBe('auth');
    expect(classifyProviderError(413)).toBe('context_overflow');
    expect(classifyProviderError(400)).toBe('invalid_request');
    expect(classifyProviderError(404)).toBe('invalid_request');
  });

  it('lets provider body.type override an ambiguous status', () => {
    // Anthropic sometimes wraps overload in a 503; rate limits in odd statuses
    expect(classifyProviderError(400, { type: 'rate_limit_error' })).toBe('rate_limit');
    expect(classifyProviderError(400, { type: 'overloaded_error' })).toBe('overloaded');
    expect(classifyProviderError(400, { type: 'authentication_error' })).toBe('auth');
    expect(classifyProviderError(400, { type: 'permission_error' })).toBe('auth');
  });

  it('detects more overflow phrasings on 4xx', () => {
    expect(classifyProviderError(400, undefined, 'too many tokens in the request')).toBe(
      'context_overflow',
    );
    expect(classifyProviderError(400, undefined, 'please reduce the length of your messages')).toBe(
      'context_overflow',
    );
    expect(classifyProviderError(400, undefined, 'your input is too large')).toBe(
      'context_overflow',
    );
    expect(
      classifyProviderError(400, undefined, 'your messages resulted in 130000 tokens'),
    ).toBe('context_overflow');
  });

  it('detects context overflow from message shapes on 4xx', () => {
    expect(classifyProviderError(400, { message: 'prompt is too long: 250000 tokens' })).toBe(
      'context_overflow',
    );
    expect(
      classifyProviderError(400, {
        message: "This model's maximum context length is 128000 tokens",
      }),
    ).toBe('context_overflow');
    expect(classifyProviderError(400, undefined, 'context length exceeded')).toBe(
      'context_overflow',
    );
    // ... but NOT on 5xx (server error wins) and not without an overflow-shaped message
    expect(classifyProviderError(500, { message: 'context length exceeded' })).toBe('server');
    expect(classifyProviderError(400, { message: 'bad temperature value' })).toBe(
      'invalid_request',
    );
  });

  it('detects content-filter refusals', () => {
    expect(classifyProviderError(400, { type: 'content_filter' })).toBe('content_filter');
    expect(
      classifyProviderError(400, { message: 'The response was filtered due to content policy' }),
    ).toBe('content_filter');
  });
});

describe('isRetryableKind', () => {
  it('marks capacity/transport failures retryable, request failures not', () => {
    expect(isRetryableKind('rate_limit')).toBe(true);
    expect(isRetryableKind('overloaded')).toBe(true);
    expect(isRetryableKind('server')).toBe(true);
    expect(isRetryableKind('timeout')).toBe(true);
    expect(isRetryableKind('network')).toBe(true);
    expect(isRetryableKind('stream_hang')).toBe(true);
    expect(isRetryableKind('auth')).toBe(false);
    expect(isRetryableKind('invalid_request')).toBe(false);
    expect(isRetryableKind('context_overflow')).toBe(false);
    expect(isRetryableKind('content_filter')).toBe(false);
    expect(isRetryableKind('unknown')).toBe(false);
  });
});

describe('ProviderError.kind', () => {
  it('is computed at construction from status + body + message', () => {
    expect(new ProviderError('x', 429, true, 'p').kind).toBe('rate_limit');
    expect(new ProviderError('prompt is too long', 400, false, 'p').kind).toBe('context_overflow');
  });

  it('honours an explicit kind override', () => {
    const err = new ProviderError('x', 400, false, 'p', { kind: 'content_filter' });
    expect(err.kind).toBe('content_filter');
  });

  it('drives the WrongStackError code', () => {
    expect(new ProviderError('x', 429, true, 'p').code).toBe(ERROR_CODES.PROVIDER_RATE_LIMITED);
    expect(new ProviderError('x', 403, false, 'p').code).toBe(ERROR_CODES.PROVIDER_AUTH_FAILED);
    expect(new ProviderError('prompt is too long', 400, false, 'p').code).toBe(
      ERROR_CODES.PROVIDER_CONTEXT_OVERFLOW,
    );
  });

  it('StreamHangError classifies as stream_hang via its 599 sentinel', () => {
    const err = new StreamHangError({
      providerId: 'p',
      model: 'm',
      hangTimeoutMs: 1000,
      bytesReceived: 10,
      elapsedMs: 1200,
    });
    expect(err.kind).toBe('stream_hang');
    expect(isRetryableKind(err.kind)).toBe(true);
  });
});

describe('ProviderError.describe — new kind labels', () => {
  it('labels 599 as a stream hang, not a generic server error', () => {
    const err = new StreamHangError({
      providerId: 'zai',
      model: 'm',
      hangTimeoutMs: 1000,
      bytesReceived: 10,
      elapsedMs: 1200,
    });
    expect(err.describe()).toContain('zai stream hang (599)');
  });

  it('labels content_filter bodies as content filtered', () => {
    const err = new ProviderError('x', 400, false, 'azure', {
      body: { type: 'content_filter', message: 'The response was filtered' },
    });
    expect(err.describe()).toBe('azure content filtered (400): The response was filtered');
  });
});

describe('isContextOverflowShaped', () => {
  it('is true for a cleanly-classified context_overflow', () => {
    const err = new ProviderError('prompt is too long', 413, false, 'anthropic');
    expect(err.kind).toBe('context_overflow');
    expect(isContextOverflowShaped(err)).toBe(true);
  });

  it('is true for an overflow mislabeled as invalid_request by a gateway', () => {
    // A gateway forces kind=invalid_request but the message is clearly an overflow.
    const err = new ProviderError(
      'This request exceeds the context window: 200000 tokens',
      400,
      false,
      'gateway',
      { kind: 'invalid_request' },
    );
    expect(err.kind).toBe('invalid_request'); // mislabeled
    expect(isContextOverflowShaped(err)).toBe(true); // but shape is detected
  });

  it('is true for a bare 413 regardless of message', () => {
    const err = new ProviderError('Request Entity Too Large', 413, false, 'proxy', {
      kind: 'invalid_request',
    });
    expect(isContextOverflowShaped(err)).toBe(true);
  });

  it('is false for a genuine invalid_request and for non-ProviderErrors', () => {
    const err = new ProviderError('messages.0.role is invalid', 400, false, 'anthropic');
    expect(isContextOverflowShaped(err)).toBe(false);
    expect(isContextOverflowShaped(new Error('boom'))).toBe(false);
    expect(isContextOverflowShaped(undefined)).toBe(false);
  });
});
