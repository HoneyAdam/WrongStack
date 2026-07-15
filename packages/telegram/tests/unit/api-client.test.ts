import { describe, expect, it, vi } from 'vitest';
import {
  buildTelegramBotApiBaseUrl,
  TelegramApiClient,
  TelegramBotApiError,
  TelegramHttpError,
  TelegramNetworkError,
  TelegramResponseParseError,
} from '../../src/api-client.js';

const TOKEN = '123456:super-secret-token';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('TelegramApiClient', () => {
  it('builds one canonical Bot API base URL and exposes only its redacted form', () => {
    expect(buildTelegramBotApiBaseUrl(TOKEN, 'https://telegram.test///')).toBe(
      `https://telegram.test/bot${TOKEN}`,
    );

    const client = new TelegramApiClient({ token: TOKEN, apiRoot: 'https://telegram.test/' });
    expect(client.safeBaseUrl).toBe('https://telegram.test/bot[REDACTED]');
    expect(client.safeBaseUrl).not.toContain(TOKEN);
  });

  it('performs a typed GET for getUpdates with encoded query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: [{ update_id: 7 }],
      }),
    );
    const client = new TelegramApiClient({ token: TOKEN, fetch: fetchMock });

    await expect(client.getUpdates({ offset: 4, timeoutSeconds: 10 })).resolves.toEqual([
      { update_id: 7 },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=4&timeout=10`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('performs a typed JSON POST for sendMessage', async () => {
    const result = {
      message_id: 42,
      chat: { id: 99, type: 'private' },
      date: 1_700_000_000,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result }));
    const client = new TelegramApiClient({ token: TOKEN, fetch: fetchMock });

    await expect(client.sendMessage(99, 'hello')).resolves.toEqual(result);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: '99',
      text: 'hello',
      disable_web_page_preview: true,
    });
  });

  it('distinguishes an HTTP failure without exposing the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('', { status: 502, statusText: `upstream ${TOKEN}` }),
    );
    const client = new TelegramApiClient({ token: TOKEN, fetch: fetchMock });

    const error = await client.getMe().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramHttpError);
    expect(error).toMatchObject({ kind: 'http', method: 'getMe', status: 502 });
    expect((error as Error).message).toContain('[REDACTED]');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('distinguishes malformed JSON and a malformed Bot API envelope', async () => {
    const malformedJson = new TelegramApiClient({
      token: TOKEN,
      fetch: vi.fn().mockResolvedValue(
        new Response('{not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });
    await expect(malformedJson.getMe()).rejects.toMatchObject({
      kind: 'parse',
      method: 'getMe',
    });

    const malformedEnvelope = new TelegramApiClient({
      token: TOKEN,
      fetch: vi.fn().mockResolvedValue(jsonResponse({ result: {} })),
    });
    await expect(malformedEnvelope.getMe()).rejects.toBeInstanceOf(TelegramResponseParseError);
  });

  it('preserves typed Bot API metadata while redacting its description', async () => {
    const client = new TelegramApiClient({
      token: TOKEN,
      fetch: vi.fn().mockResolvedValue(
        jsonResponse(
          {
            ok: false,
            error_code: 429,
            description: `rate limited for ${TOKEN}`,
            parameters: { retry_after: 12, migrate_to_chat_id: -10042 },
          },
          { status: 429 },
        ),
      ),
    });

    const error = await client.sendMessage(99, 'hello').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramBotApiError);
    expect(error).toMatchObject({
      kind: 'api',
      method: 'sendMessage',
      errorCode: 429,
      retryAfterSeconds: 12,
      migrateToChatId: -10042,
      description: 'rate limited for [REDACTED]',
    });
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('distinguishes network failures and redacts token-bearing details', async () => {
    const client = new TelegramApiClient({
      token: TOKEN,
      fetch: vi.fn().mockRejectedValue(new Error(`connect failed at /bot${TOKEN}`)),
    });

    const error = await client.getMe().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramNetworkError);
    expect(error).toMatchObject({ kind: 'network', method: 'getMe', aborted: false });
    expect((error as TelegramNetworkError).detail).toContain('[REDACTED]');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('marks AbortError as an aborted network failure', async () => {
    const abort = new Error(`aborted ${TOKEN}`);
    abort.name = 'AbortError';
    const client = new TelegramApiClient({
      token: TOKEN,
      fetch: vi.fn().mockRejectedValue(abort),
    });

    await expect(client.getUpdates({ offset: 0, timeoutSeconds: 10 })).rejects.toMatchObject({
      kind: 'network',
      method: 'getUpdates',
      aborted: true,
      detail: 'aborted [REDACTED]',
    });
  });
});
