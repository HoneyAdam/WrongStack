// ---------------------------------------------------------------------------
// Telegram outbound queue integration.
//
// Provides a TelegramBot helper that routes manual sends (the
// telegram_send tool, /telegram:send) through the same bounded outbound
// queue used by automatic notifications, so user-triggered and
// notification-triggered sends share per-chat ordering and backpressure.
//
// Manual entries reject on overflow (caller sees the error), per the P1.4
// acceptance criterion "manual sends are never silently dropped".
// Notification entries are dropped on overflow per the same criterion.
// ---------------------------------------------------------------------------

import type { Logger } from '@wrongstack/core';
import type { TelegramApiMessage } from './api-client.js';
import type { TelegramBot, TelegramBotResponse } from './bot.js';
import { OutboundQueue, type OutboundEntry } from './outbound-queue.js';

export interface BotOutboundOptions {
  readonly bot: TelegramBot;
  /** Pass-through logger (defaults to bot's internal logger via the bot's debug hook). */
  readonly log: Logger;
  /** Optional override; defaults to 32 entries per chat. */
  readonly maxPerChat?: number;
  /** Optional override; defaults to 4 concurrent sends. */
  readonly maxConcurrency?: number;
}

export class TelegramBotOutbound {
  readonly #queue: OutboundQueue;
  readonly #bot: TelegramBot;
  readonly #log: Logger;
  #stopped = false;

  constructor(opts: BotOutboundOptions) {
    this.#bot = opts.bot;
    this.#log = opts.log;
    this.#queue = new OutboundQueue({
      maxPerChat: opts.maxPerChat,
      maxConcurrency: opts.maxConcurrency,
      send: (chatId, text) =>
        this.#bot.sendMessage(chatId, text).then((res) => {
          if (!res.ok) {
            throw new Error(`Telegram outbound send returned ok=false for chat ${chatId}`);
          }
          return res;
        }),
      log: opts.log,
    });
  }

  /** Manual send (telegram_send tool, /telegram:send): never silently dropped. */
  async sendManual(
    chatId: string | number,
    text: string,
  ): Promise<TelegramBotResponse<TelegramApiMessage>> {
    if (this.#stopped) {
      throw new Error('Telegram outbound queue is stopped');
    }
    return (await this.#queue.enqueue({
      chatId,
      text,
      kind: 'manual',
    })) as TelegramBotResponse<TelegramApiMessage>;
  }

  /**
   * Notification send (session ended, long tool, delegate): fire-and-forget.
   * The returned promise resolves as soon as the queue accepts the entry;
   * downstream send failures are logged and counted but not surfaced.
   */
  enqueueNotification(chatId: string | number, text: string): void {
    if (this.#stopped) {
      this.#log.debug(`Telegram outbound queue ignored notification for chat ${chatId}: stopped`);
      return;
    }
    const entry: OutboundEntry = { chatId, text, kind: 'notification' };
    this.#queue.enqueue(entry).catch((err) => {
      this.#log.debug(
        `Telegram outbound notification enqueue rejected for chat ${chatId}: ${(err as Error).message}`,
      );
    });
  }

  stats() {
    return this.#queue.stats();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#queue.stop();
  }
}
