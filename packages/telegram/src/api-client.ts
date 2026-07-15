// ---------------------------------------------------------------------------
// Telegram Bot API models used by the plugin
// ---------------------------------------------------------------------------

export interface TelegramApiUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string | undefined;
}

export type TelegramApiChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TelegramApiChat {
  id: number;
  type: TelegramApiChatType;
  title?: string | undefined;
  username?: string | undefined;
}

export interface TelegramApiMessage {
  message_id: number;
  from?: TelegramApiUser | undefined;
  chat: TelegramApiChat;
  date: number;
  text?: string | undefined;
}

export interface TelegramApiCallbackQuery {
  id: string;
  from?: TelegramApiUser | undefined;
  message?: { message_id: number; chat: TelegramApiChat } | undefined;
  data?: string | undefined;
}

export interface TelegramApiUpdate {
  update_id: number;
  message?: TelegramApiMessage | undefined;
  edited_message?: TelegramApiMessage | undefined;
  callback_query?: TelegramApiCallbackQuery | undefined;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface TelegramApiEnvelope<T> {
  ok: boolean;
  result?: T | undefined;
  description?: string | undefined;
  error_code?: number | undefined;
  parameters?: {
    retry_after?: number | undefined;
    migrate_to_chat_id?: number | undefined;
  } | undefined;
}

// ---------------------------------------------------------------------------
// Structured, token-safe failure model
// ---------------------------------------------------------------------------

export type TelegramApiClientErrorKind = 'network' | 'http' | 'parse' | 'api';

export abstract class TelegramApiClientError extends Error {
  readonly kind: TelegramApiClientErrorKind;
  readonly method: string;

  protected constructor(kind: TelegramApiClientErrorKind, method: string, message: string) {
    super(message);
    this.kind = kind;
    this.method = method;
  }
}

export class TelegramNetworkError extends TelegramApiClientError {
  readonly detail: string;
  readonly aborted: boolean;

  constructor(method: string, detail: string, aborted = false) {
    super('network', method, `Telegram network error during ${method}: ${detail}`);
    this.name = 'TelegramNetworkError';
    this.detail = detail;
    this.aborted = aborted;
  }
}

export class TelegramHttpError extends TelegramApiClientError {
  readonly status: number;

  constructor(method: string, status: number, statusText?: string | undefined) {
    const suffix = statusText ? ` ${statusText}` : '';
    super('http', method, `Telegram HTTP error during ${method}: ${status}${suffix}`);
    this.name = 'TelegramHttpError';
    this.status = status;
  }
}

export class TelegramResponseParseError extends TelegramApiClientError {
  constructor(method: string, detail: string) {
    super('parse', method, `Telegram response parse error during ${method}: ${detail}`);
    this.name = 'TelegramResponseParseError';
  }
}

export class TelegramBotApiError extends TelegramApiClientError {
  readonly errorCode?: number | undefined;
  readonly httpStatus?: number | undefined;
  readonly description: string;
  readonly retryAfterSeconds?: number | undefined;
  readonly migrateToChatId?: number | undefined;

  constructor(
    method: string,
    opts: {
      errorCode?: number | undefined;
      httpStatus?: number | undefined;
      description: string;
      retryAfterSeconds?: number | undefined;
      migrateToChatId?: number | undefined;
    },
  ) {
    const code = opts.errorCode === undefined ? 'unknown' : String(opts.errorCode);
    super('api', method, `Telegram API error ${code} during ${method}: ${opts.description}`);
    this.name = 'TelegramBotApiError';
    this.errorCode = opts.errorCode;
    this.httpStatus = opts.httpStatus;
    this.description = opts.description;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.migrateToChatId = opts.migrateToChatId;
  }
}

// ---------------------------------------------------------------------------
// Typed transport
// ---------------------------------------------------------------------------

type TelegramFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TelegramApiClientOptions {
  token: string;
  /** Override used by deterministic tests or Bot API proxies. */
  apiRoot?: string | undefined;
  /** Optional transport injection. Defaults to globalThis.fetch at call time. */
  fetch?: TelegramFetch | undefined;
}

export interface TelegramRequestOptions {
  signal?: AbortSignal | undefined;
}

export interface TelegramGetUpdatesOptions extends TelegramRequestOptions {
  deadlineMs?: number | undefined;

  offset: number;
  timeoutSeconds: number;
}

/** Build the one canonical, token-bearing Bot API base URL. Never log this value. */
export function buildTelegramBotApiBaseUrl(
  token: string,
  apiRoot = 'https://api.telegram.org',
): string {
  return `${apiRoot.replace(/\/+$/, '')}/bot${token}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function abortableSleep(ms: number, signal?: AbortSignal | undefined): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('The operation was aborted', 'AbortError')); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('The operation was aborted', 'AbortError')); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Compose optional parent signal + deadline into one AbortSignal. Returns undefined when neither is set. */
function composedSignal(signal?: AbortSignal | undefined, deadlineMs?: number | undefined): AbortSignal | undefined {
  if (deadlineMs !== undefined && signal) {
    return AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
  }
  if (deadlineMs !== undefined) return AbortSignal.timeout(deadlineMs);
  return signal;
}

export class TelegramApiClient {
  readonly safeBaseUrl: string;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchOverride?: TelegramFetch | undefined;

  constructor(opts: TelegramApiClientOptions) {
    this.token = opts.token;
    this.baseUrl = buildTelegramBotApiBaseUrl(opts.token, opts.apiRoot);
    this.safeBaseUrl = this.redact(this.baseUrl);
    this.fetchOverride = opts.fetch;
  }

  getMe(opts?: TelegramRequestOptions): Promise<TelegramApiUser> {
    return this.request<TelegramApiUser>('getMe', { signal: composedSignal(opts?.signal) });
  }

  getUpdates(opts: TelegramGetUpdatesOptions): Promise<TelegramApiUpdate[]> {
    const query = new URLSearchParams({
      offset: String(opts.offset),
      timeout: String(opts.timeoutSeconds),
    });
    return this.request<TelegramApiUpdate[]>('getUpdates', {
      query,
      signal: composedSignal(opts.signal, opts.deadlineMs),
    });
  }

  sendMessage(
    chatId: string | number,
    text: string,
    opts?: TelegramRequestOptions,
  ): Promise<TelegramApiMessage> {
    return this.request<TelegramApiMessage>('sendMessage', {
      body: {
        chat_id: String(chatId),
        text,
        disable_web_page_preview: true,
      },
      signal: composedSignal(opts?.signal),
    });
  }

  sendMessageWithKeyboard(
    chatId: string | number,
    text: string,
    buttons: readonly TelegramInlineKeyboardButton[],
    opts?: TelegramRequestOptions,
  ): Promise<TelegramApiMessage> {
    return this.request<TelegramApiMessage>('sendMessage', {
      body: {
        chat_id: String(chatId),
        text,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            buttons.map((button) => ({
              text: button.text,
              callback_data: button.callback_data,
            })),
          ],
        },
      },
      signal: composedSignal(opts?.signal),
    });
  }

  answerCallbackQuery(
    callbackQueryId: string,
    text: string,
    showAlert: boolean,
    opts?: TelegramRequestOptions,
  ): Promise<boolean> {
    return this.request<boolean>('answerCallbackQuery', {
      body: {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      },
      signal: composedSignal(opts?.signal),
    });
  }

  private async request<T>(
    method: string,
    opts?: {
      body?: Record<string, unknown> | undefined;
      query?: URLSearchParams | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<T> {
    const query = opts?.query?.toString();
    const url = `${this.baseUrl}/${method}${query ? `?${query}` : ''}`;
    const init: RequestInit = {
      method: opts?.body ? 'POST' : 'GET',
    };
    if (opts?.signal) init.signal = opts.signal;
    if (opts?.body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }

    let response: Response;
    try {
      const fetchImpl = this.fetchOverride ?? globalThis.fetch;
      response = await fetchImpl(url, init);
    } catch (error) {
      const detail = this.redact(errorDetail(error));
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new TelegramNetworkError(method, detail, aborted);
    }

    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch (error) {
      if (!response.ok) {
        throw new TelegramHttpError(method, response.status, this.redact(response.statusText));
      }
      throw new TelegramResponseParseError(method, this.redact(errorDetail(error)));
    }

    if (!isRecord(decoded) || typeof decoded.ok !== 'boolean') {
      if (!response.ok) {
        throw new TelegramHttpError(method, response.status, this.redact(response.statusText));
      }
      throw new TelegramResponseParseError(method, 'expected a Bot API response envelope');
    }

    const envelope = decoded as unknown as TelegramApiEnvelope<T>;
    if (!envelope.ok) {
      throw new TelegramBotApiError(method, {
        errorCode: envelope.error_code,
        httpStatus: response.status,
        description: this.redact(envelope.description ?? 'Unknown Bot API error'),
        retryAfterSeconds: envelope.parameters?.retry_after,
        migrateToChatId: envelope.parameters?.migrate_to_chat_id,
      });
    }
    if (!response.ok) {
      throw new TelegramHttpError(method, response.status, this.redact(response.statusText));
    }
    if (envelope.result === undefined || envelope.result === null) {
      throw new TelegramResponseParseError(method, 'successful response did not include result');
    }

    return envelope.result;
  }

  private redact(value: string): string {
    return value.replaceAll(this.token, '[REDACTED]');
  }
}
