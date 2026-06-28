import { randomUUID } from 'node:crypto';
import type { Tool } from '@wrongstack/core';
import type { Logger } from '@wrongstack/core';
import type { TelegramBot } from '../bot.js';
import { truncateForTelegram } from '../bot.js';

interface TelegramApproveInput {
  /** Short label for what's being approved (≤ 60 chars). Shown as the prompt heading. */
  prompt: string;
  /** Optional details (≤ 1000 chars). Shown under the heading. */
  details?: string | undefined;
  /** Chat to post the prompt to. Falls back to notifyChatId. */
  chat_id?: string | number | undefined;
  /** How long to wait for a button press before auto-denying. Default 60s, max 600s. */
  timeout_ms?: number | undefined;
}

interface TelegramApproveOutput {
  approved: boolean;
  from: string;
  prompt_message_id?: number | undefined;
}

/**
 * Post a yes/no inline-keyboard prompt to a chat and block until the user
 * taps a button (or until `timeout_ms` elapses, in which case the call
 * auto-denies). Useful when the agent wants explicit approval before
 * continuing and the user is on their phone rather than the TUI.
 *
 * The agent calls this tool directly. It does not replace the host-level
 * `permission: 'confirm'` flow — for that, see the future B4 work.
 *
 * Permission: `auto` (NOT `confirm`). This is intentional — the tool's
 * purpose IS to obtain user approval; gating it behind another host-level
 * confirm dialog would be circular and would block the agent in
 * headless mode. The user-side approval (Telegram button press) is
 * the only confirm gate. The 600 s tool `timeoutMs` ceiling is the
 * safety net for the case where the user never responds.
 */
export function makeTelegramApproveTool(opts: {
  bot: TelegramBot;
  getDefaultChatId(): string | number | undefined;
  maxMessageLength: number;
  log: Logger;
}): Tool<TelegramApproveInput, TelegramApproveOutput> {
  return {
    name: 'telegram_approve',
    description:
      'Post a yes/no approval prompt to a Telegram chat with inline keyboard buttons, and wait for the user to tap one. Returns { approved, from } where approved=false on timeout or explicit deny. Use this when you need explicit human confirmation before proceeding (destructive ops, irreversible deploys, ambiguous choices).',
    usageHint: 'telegram_approve(prompt: "Delete build artifacts?", details: "Frees 2.3 GB. Cannot be undone.", timeout_ms: 60000)',
    category: 'Telegram',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          maxLength: 200,
          description: 'Short label for what is being approved. Shown as the prompt heading.',
        },
        details: {
          type: 'string',
          maxLength: 1000,
          description: 'Optional context under the heading.',
        },
        chat_id: {
          oneOf: [{ type: 'string' }, { type: 'integer' }],
          description: 'Chat to post the prompt to. Uses the plugin default when omitted.',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 600_000,
          description: 'How long to wait before auto-denying. Default 60 000 ms, max 600 000 ms (10 min).',
        },
      },
      required: ['prompt'],
    },
    permission: 'auto',
    mutating: false,
    timeoutMs: 610_000,
    async execute(input, _ctx, _toolOpts) {
      const chatId = input.chat_id ?? opts.getDefaultChatId();
      if (!chatId) {
        throw new Error(
          'No chat_id provided and no default notifyChatId configured. Set notifyChatId in plugin config or pass chat_id.',
        );
      }
      const timeoutMs = Math.min(Math.max(input.timeout_ms ?? 60_000, 1000), 600_000);

      // Stable key so the callback update can be matched back to this call.
      const token = randomUUID().slice(0, 16);
      const yesKey = `approve:${token}:yes`;
      const noKey = `approve:${token}:no`;

      const heading = `⚠️ ${input.prompt}`;
      const detailsLine = input.details ? `\n\n${truncateForTelegram(input.details, 800)}` : '';
      const text = `${heading}${detailsLine}\n\n_Reply by tapping a button. Auto-denies in ${Math.round(timeoutMs / 1000)}s._`;

      opts.log.info(`telegram_approve → chat_id=${chatId} prompt="${input.prompt.slice(0, 80)}" token=${token}`);

      let promptMessageId: number | undefined;
      try {
        const sent = await opts.bot.sendMessageWithKeyboard(chatId, text, [
          { text: '✅ Approve', callback_data: yesKey },
          { text: '❌ Deny', callback_data: noKey },
        ]);
        promptMessageId = sent.result?.message_id;
      } catch (err) {
        opts.log.debug(`telegram_approve send failed: ${(err as Error).message}`);
        // Fall through — race the callback. If the message never lands the
        // race still resolves at timeout.
      }

      // Race the two buttons. First one wins; the other is ignored when
      // it arrives because the waiter is already deleted.
      const result = await Promise.race([
        opts.bot.awaitCallback(yesKey, timeoutMs),
        opts.bot.awaitCallback(noKey, timeoutMs),
      ]);

      return {
        approved: result.approved,
        from: result.fromUser,
        prompt_message_id: promptMessageId,
      };
    },
  };
}