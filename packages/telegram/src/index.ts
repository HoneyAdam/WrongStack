import type { Config, Logger, Plugin, PluginAPI, SlashCommand } from '@wrongstack/core';
import { expectDefined } from '@wrongstack/core';
import type { TelegramIncomingMessage } from './bot.js';
import { TelegramBot, truncateForTelegram } from './bot.js';
import { PLUGIN_NAME, readTelegramConfig, telegramConfigSchema } from './config.js';
import type { SessionEndedLike, ToolExecutedLike } from './format.js';
import { formatDelegateCompleted, formatSessionEnded, formatToolExecuted } from './format.js';
import { lockPathForToken, PollLock } from './poll-lock.js';
import { OffsetStore } from './offset-store.js';
import { scrubTelegramOutboundText } from './security/outbound.js';
import { tgChatIdCommand, tgHealthCommand, tgSendCommand } from './slash-commands/index.js';
import { makeTelegramApproveTool } from './tools/telegram-approve.js';
import { TelegramBotOutbound } from './bot-queue.js';
import { makeTelegramReadTool } from './tools/telegram-read.js';
import { makeTelegramSendTool } from './tools/telegram-send.js';

// ---------------------------------------------------------------------------
// Teardown state
// ---------------------------------------------------------------------------

/** Mutable runtime config — updated via api.onConfigChange so changes take
 * effect without restarting the plugin. */
interface RuntimeConfig {
  notifyChatId: string | number | undefined;
  allowedOutboundChats: Array<string | number>;
  allowedUserIds: Array<string | number>;
  allowGroupApprovals: boolean;
  notifyOnSessionEnd: boolean;
  notifyOnDelegate: boolean;
  longToolThresholdMs: number;
  maxMessageLength: number;
  outboundQueuePerChat: number;
  outboundQueueConcurrency: number;
}

interface RuntimeState {
  bot: TelegramBot;
  outbound: TelegramBotOutbound;
  cleanups: Array<() => void>;
}

let teardownState: RuntimeState | null = null;

const DENY_ALL_INBOUND = '__wrongstack_telegram_inbound_disabled__';

function inboundAllowlist(cfg: ReturnType<typeof readTelegramConfig>): {
  allowedUsers: Set<string>;
  allowedChats: Set<string>;
} {
  if (cfg.inboundMode === 'public') {
    return { allowedUsers: new Set(), allowedChats: new Set() };
  }
  if (cfg.inboundMode === 'paired') {
    const pairedUsers = new Set((cfg.allowedUsers ?? []).map(String));
    return {
      allowedUsers:
        pairedUsers.size > 0 ? pairedUsers : new Set([String(expectDefined(cfg.notifyChatId))]),
      allowedChats: new Set([String(expectDefined(cfg.notifyChatId))]),
    };
  }
  if (cfg.inboundMode === 'allowlist') {
    return {
      allowedUsers: new Set((cfg.allowedUsers ?? []).map(String)),
      allowedChats: new Set((cfg.allowedChats ?? []).map(String)),
    };
  }
  return {
    allowedUsers: new Set([DENY_ALL_INBOUND]),
    allowedChats: new Set([DENY_ALL_INBOUND]),
  };
}

function runCleanups(cleanups: Array<() => void>, log: Logger): void {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    try {
      cleanup?.();
    } catch (err) {
      log.debug(`Telegram cleanup failed: ${(err as Error).message}`);
    }
  }
}

function disposeRuntime(log: Logger): void {
  const state = teardownState;
  teardownState = null;
  if (state) runCleanups(state.cleanups, log);
}

function registerCommand(api: PluginAPI, command: SlashCommand, cleanups: Array<() => void>): void {
  api.slashCommands.register(command);
  cleanups.push(() => {
    api.slashCommands.unregister(`${PLUGIN_NAME}:${command.name}`);
  });
}

/** Read the Telegram section from a full Config object. */
function telegramFromConfig(cfg: Config): {
  notifyChatId: string | number | undefined;
  allowedOutboundChats: Array<string | number>;
  allowedUserIds: Array<string | number>;
  allowGroupApprovals: boolean;
  notifyOnSessionEnd: boolean;
  notifyOnDelegate: boolean;
  longToolThresholdMs: number;
  maxMessageLength: number;
} {
  const ext =
    (cfg.extensions as Record<string, Record<string, unknown>> | undefined)?.[PLUGIN_NAME] ?? {};
  return {
    notifyChatId: ext.notifyChatId !== undefined ? String(ext.notifyChatId) : undefined,
    allowedOutboundChats: Array.isArray(ext.allowedOutboundChats)
      ? ext.allowedOutboundChats.filter(
          (chatId): chatId is string | number =>
            typeof chatId === 'string' || typeof chatId === 'number',
        )
      : [],
    allowedUserIds: Array.isArray(ext.allowedUsers)
      ? ext.allowedUsers.filter(
          (userId): userId is string | number =>
            typeof userId === 'string' || typeof userId === 'number',
        )
      : [],
    allowGroupApprovals: ext.allowGroupApprovals === true,
    notifyOnSessionEnd: ext.notifyOnSessionEnd === true,
    notifyOnDelegate: ext.notifyOnDelegate !== false, // default true
    longToolThresholdMs:
      typeof ext.longToolThresholdMs === 'number' ? ext.longToolThresholdMs : 30_000,
    maxMessageLength: typeof ext.maxMessageLength === 'number' ? ext.maxMessageLength : 4000,
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: Plugin = {
  name: PLUGIN_NAME,
  version: '0.3.4',
  description: 'Telegram bridge — send/receive messages, get agent notifications.',
  apiVersion: '^0.1.10',
  capabilities: {
    tools: true,
    slashCommands: true,
    pipelines: [],
  },
  configSchema: telegramConfigSchema,
  defaultConfig: {
    allowedOutboundChats: [],
    pollIntervalSec: 2,
    notifyOnSessionEnd: false,
    longToolThresholdMs: 30_000,
    maxMessageLength: 4000,
  },

  async setup(api) {
    const log = api.log;
    disposeRuntime(log);
    const cfg = readTelegramConfig(api);

    log.info('Starting Telegram plugin...');

    // ---- Mutable runtime config (updated via onConfigChange) ----
    const rawCfg = cfg as ReturnType<typeof readTelegramConfig> & {
      allowGroupApprovals?: boolean | undefined;
    };
    const runtimeCfg: RuntimeConfig = {
      notifyChatId: cfg.notifyChatId,
      allowedOutboundChats: [...(cfg.allowedOutboundChats ?? [])],
      allowedUserIds: [...(cfg.allowedUsers ?? [])],
      allowGroupApprovals: rawCfg.allowGroupApprovals === true,
      notifyOnSessionEnd: cfg.notifyOnSessionEnd ?? false,
      notifyOnDelegate: cfg.notifyOnDelegate ?? true,
      longToolThresholdMs: cfg.longToolThresholdMs ?? 30_000,
      maxMessageLength: cfg.maxMessageLength ?? 4000,
      outboundQueuePerChat: cfg.outboundQueuePerChat ?? 32,
      outboundQueueConcurrency: cfg.outboundQueueConcurrency ?? 4,
    };

    // ---- Bot ----
    // Telegram allows one getUpdates consumer per token: elect a single
    // poller across wstack instances so concurrent TUI/WebUI/projects don't
    // fight over the token (HTTP 409 on every poll).
    const lock =
      cfg.singleInstanceLock === false
        ? undefined
        : new PollLock(lockPathForToken(cfg.botToken), { log });
    // Persist the polling cursor so a crash/restart doesn't replay messages.
    // Default to a token-scoped store under ~/.wrongstack/telegram; an explicit
    // offsetStoragePath overrides the location. Persistence is disabled only
    // when offsetStoragePath is set to an empty string.
    const offsetStore =
      cfg.offsetStoragePath === ''
        ? undefined
        : new OffsetStore({ token: cfg.botToken, path: cfg.offsetStoragePath });
    const bot = new TelegramBot({
      token: cfg.botToken,
      pollIntervalSec: cfg.pollIntervalSec ?? 2,
      ...inboundAllowlist(cfg),
      bufferSize: 50,
      log,
      offsetStore,
      lock,
      onMessage(msg: TelegramIncomingMessage) {
        // Emit custom event so other plugins or the host can react.
        // The TUI can subscribe and surface it (future hook).
        api.emitCustom('telegram:message_received', msg);

        // Keep untrusted inbound content in the bot buffer only. Logs expose
        // bounded metadata so message text, sender, and chat IDs cannot leak.
        log.info(`📨 Telegram message received (${Math.min(bot.bufferCount, 50)} unread)`);
      },
    });

    // Validate the token before mutating host registries or acquiring the poll
    // lock. A failed preflight must leave setup observationally atomic.
    const probe = await bot.health();
    if (!probe.ok) {
      bot.stop();
      throw new Error(
        `Telegram plugin startup failed: ${probe.error ?? 'unknown error'}. ` +
          `Verify botToken in extensions.telegram (token from @BotFather, format "<id>:<35+ chars>").`,
      );
    }
    log.info(`Telegram self-test ok: @${probe.username ?? 'unknown'} (api.telegram.org reachable)`);

    const cleanups: Array<() => void> = [];
    try {
      // Bot cleanup is registered first so it runs last, after every host-side
      // listener and registry entry has been detached.
      cleanups.push(() => bot.stop());

      // Bounded outbound queue with per-chat backpressure. Notification events
      // and the /telegram:send slash command both enqueue through it; manual
      // telegram_send tool sends go through bot.sendMessage directly so user
      // errors surface immediately. The queue is drained on teardown.
      const outbound = new TelegramBotOutbound({
        bot,
        log,
        maxPerChat: runtimeCfg.outboundQueuePerChat,
        maxConcurrency: runtimeCfg.outboundQueueConcurrency,
      });
      cleanups.push(() => {
        void outbound.stop();
      });

      // ---- Register tools ----
      const sendTool = makeTelegramSendTool({
        bot,
        getDefaultChatId: () => runtimeCfg.notifyChatId,
        getAllowedOutboundChatIds: () => runtimeCfg.allowedOutboundChats,
        maxMessageLength: runtimeCfg.maxMessageLength,
        log,
      });
      const readTool = makeTelegramReadTool({ bot });
      const approveTool = makeTelegramApproveTool({
        bot,
        getDefaultChatId: () => runtimeCfg.notifyChatId,
        getAllowedOutboundChatIds: () => runtimeCfg.allowedOutboundChats,
        getAllowedUserIds: () => runtimeCfg.allowedUserIds,
        allowGroupApprovals: runtimeCfg.allowGroupApprovals,
        maxMessageLength: runtimeCfg.maxMessageLength,
        log,
      });
      for (const tool of [sendTool, readTool, approveTool]) {
        api.tools.register(tool);
        cleanups.push(() => {
          api.tools.unregister(tool.name);
        });
      }

      // ---- Event subscriptions ----

      // System prompts receive metadata only. Message text and identity stay
      // behind the explicit telegram_read tool boundary.
      const unregisterPrompt = api.registerSystemPromptContributor(async () => {
        const unreadCount = Math.min(bot.bufferCount, 50);
        if (unreadCount === 0) return [];
        return [
          {
            type: 'text' as const,
            text: [
              '## Telegram Inbox',
              `You have ${unreadCount} unread Telegram message(s).`,
              'Use `telegram_read` to retrieve them when needed.',
            ].join('\n'),
          },
        ];
      });
      cleanups.push(unregisterPrompt);

      // Register commands one at a time so a later collision can roll back the
      // commands already installed by this setup attempt.
      for (const command of [
        tgHealthCommand(bot, cfg),
        tgSendCommand(
          bot,
          {
            getDefaultChatId: () => runtimeCfg.notifyChatId,
            getAllowedOutboundChatIds: () => runtimeCfg.allowedOutboundChats,
            getMaxMessageLength: () => runtimeCfg.maxMessageLength,
          },
          outbound,
        ),
        tgChatIdCommand(cfg.notifyChatId),
      ]) {
        registerCommand(api, command, cleanups);
      }

      // ---- Notification event handlers ----
      // Always subscribed; guard at event time against runtime flags so changes
      // take effect immediately without needing to restart the plugin.

      cleanups.push(
        api.events.on('session.ended', (event) => {
          if (!runtimeCfg.notifyOnSessionEnd || !runtimeCfg.notifyChatId) return;
          const payload: SessionEndedLike = {
            id: scrubTelegramOutboundText(event.id),
            inputTokens: event.usage.input,
            outputTokens: event.usage.output,
            cacheRead: event.usage.cacheRead,
            cacheWrite: event.usage.cacheWrite,
          };
          const msg = truncateForTelegram(
            scrubTelegramOutboundText(formatSessionEnded(payload)),
            runtimeCfg.maxMessageLength,
          );
          outbound.enqueueNotification(expectDefined(runtimeCfg.notifyChatId), msg);
        }),
      );

      cleanups.push(
        api.events.on('tool.executed', (event) => {
          if (
            !runtimeCfg.notifyChatId ||
            runtimeCfg.longToolThresholdMs <= 0 ||
            event.durationMs < runtimeCfg.longToolThresholdMs
          )
            return;
          const payload: ToolExecutedLike = {
            name: event.name,
            ok: event.ok,
            durationMs: event.durationMs,
            output:
              event.output === undefined ? undefined : scrubTelegramOutboundText(event.output),
          };
          const msg = truncateForTelegram(
            scrubTelegramOutboundText(formatToolExecuted(payload)),
            runtimeCfg.maxMessageLength,
          );
          outbound.enqueueNotification(expectDefined(runtimeCfg.notifyChatId), msg);
        }),
      );

      cleanups.push(
        api.events.on('delegate.completed', (event) => {
          if (!runtimeCfg.notifyOnDelegate || !runtimeCfg.notifyChatId) return;
          const safeEvent = {
            ...event,
            target: scrubTelegramOutboundText(event.target),
            task: scrubTelegramOutboundText(event.task),
            status:
              event.status === undefined ? undefined : scrubTelegramOutboundText(event.status),
            summary: scrubTelegramOutboundText(event.summary),
          };
          const msg = truncateForTelegram(
            scrubTelegramOutboundText(formatDelegateCompleted(safeEvent)),
            runtimeCfg.maxMessageLength,
          );
          outbound.enqueueNotification(expectDefined(runtimeCfg.notifyChatId), msg);
        }),
      );

      // ---- Live config updates ----
      // api.config is frozen at setup, but onConfigChange fires whenever the
      // ConfigStore is updated (from CLI /settings, WebUI prefSync, /telegram-settings).
      // Update the mutable runtime refs so all handlers pick up the new values
      // on the next event — no restart needed.
      const unlistenConfig = api.onConfigChange((next, _prev) => {
        const fresh = telegramFromConfig(next);
        runtimeCfg.notifyChatId = fresh.notifyChatId;
        runtimeCfg.allowedOutboundChats = fresh.allowedOutboundChats;
        runtimeCfg.allowedUserIds = fresh.allowedUserIds;
        runtimeCfg.allowGroupApprovals = fresh.allowGroupApprovals;
        runtimeCfg.notifyOnSessionEnd = fresh.notifyOnSessionEnd;
        runtimeCfg.notifyOnDelegate = fresh.notifyOnDelegate;
        runtimeCfg.longToolThresholdMs = fresh.longToolThresholdMs;
        runtimeCfg.maxMessageLength = fresh.maxMessageLength;
        log.debug('Telegram notification settings updated from config', {
          notifyOnSessionEnd: runtimeCfg.notifyOnSessionEnd,
          notifyOnDelegate: runtimeCfg.notifyOnDelegate,
          longToolThresholdMs: runtimeCfg.longToolThresholdMs,
          notifyChatId: runtimeCfg.notifyChatId ?? 'not set',
        });
      });
      cleanups.push(unlistenConfig);

      // Polling is the final side effect: it may acquire the cross-process
      // lock and create timers, and bot.stop() releases all of them.
      bot.start();
      teardownState = { bot, outbound, cleanups };
      log.info('Telegram plugin ready');
    } catch (err) {
      teardownState = null;
      runCleanups(cleanups, log);
      throw err;
    }
  },

  async teardown(api) {
    const hadRuntime = teardownState !== null;
    disposeRuntime(api.log);
    if (hadRuntime) api.log.info('Telegram plugin torn down');
  },

  async health() {
    const state = teardownState;
    if (!state?.bot) return { ok: false, message: 'Plugin not initialized' };
    const h = await state.bot.health();
    return h;
  },
};

export default plugin;

// Re-export the types consumers may want
export type { TelegramIncomingMessage } from './bot.js';
export type { TelegramPluginConfig } from './config.js';
