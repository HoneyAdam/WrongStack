import type { PluginAPI } from '@wrongstack/core';

export const PLUGIN_NAME = 'telegram';

export type TelegramInboundMode = 'disabled' | 'paired' | 'allowlist' | 'public';

const INBOUND_MODES = ['disabled', 'paired', 'allowlist', 'public'] as const;

export interface TelegramPluginConfig {
  /** Telegram Bot API token (from @BotFather). */
  botToken: string;
  /**
   * Default chat ID for outgoing notifications.
   * The agent's `telegram_send` tool can override per-call.
   */
  notifyChatId?: string | number | undefined;
  /**
   * Controls who may send inbound messages to the bot. Defaults to `disabled`
   * for new/unpaired configurations. Legacy configurations are migrated to
   * `allowlist` when IDs exist, or `paired` when `notifyChatId` exists.
   */
  inboundMode?: TelegramInboundMode | undefined;
  /** List of user IDs accepted when `inboundMode` is `allowlist`. */
  allowedUsers?: Array<string | number> | undefined;
  /** List of chat IDs accepted when `inboundMode` is `allowlist`. */
  allowedChats?: Array<string | number> | undefined;
  /** Additional trusted targets for outbound sends beyond `notifyChatId`. */
  allowedOutboundChats?: Array<string | number> | undefined;
  /** Polling interval in seconds (default: 2). */
  pollIntervalSec?: number | undefined;
  /** Notify on Telegram when a session ends. */
  notifyOnSessionEnd?: boolean | undefined;
  /** Notify when a tool runs longer than this threshold (ms). Set 0 to disable. */
  longToolThresholdMs?: number | undefined;
  /** Notify (humanized) when a `delegate` subagent finishes. Default: true. */
  notifyOnDelegate?: boolean | undefined;
  /** Maximum message length for Telegram (Telegram caps at 4096). */
  maxMessageLength?: number | undefined;
  /**
   * Path to a file that stores the Telegram polling offset. When set,
   * the offset is persisted on every successful poll and restored on startup,
   * preventing message replay after crashes or restarts.
   * The directory must already exist and be writable.
   */
  offsetStoragePath?: string | undefined;
  /**
   * Elect a single poller per bot token across wstack instances (default:
   * true). Telegram allows one `getUpdates` consumer per token; without this,
   * two instances sharing a token fight and get HTTP 409 on every poll.
   * Extra instances stand by and take over when the active poller stops.
   * Set false only if this is guaranteed to be the sole consumer.
   */
  singleInstanceLock?: boolean | undefined;
  /**
   * Per-chat pending-message cap for the outbound queue. Older pending
   * notification entries are dropped when this is exceeded; manual
   * telegram_send entries surface the overflow as an error. Default: 32.
   */
  outboundQueuePerChat?: number | undefined;
  /** Maximum concurrent outbound sends across all chats. Default: 4. */
  outboundQueueConcurrency?: number | undefined;
}

export const DEFAULT_CONFIG: Required<
  Omit<TelegramPluginConfig, 'botToken' | 'notifyChatId' | 'offsetStoragePath'>
> = {
  inboundMode: 'disabled',
  allowedUsers: [],
  allowedChats: [],
  allowedOutboundChats: [],
  pollIntervalSec: 2,
  notifyOnSessionEnd: false,
  longToolThresholdMs: 30_000,
  notifyOnDelegate: true,
  maxMessageLength: 4000,
  singleInstanceLock: true,
  outboundQueuePerChat: 32,
  outboundQueueConcurrency: 4,
};

export const telegramConfigSchema = {
  type: 'object',
  properties: {
    botToken: { type: 'string', description: 'Telegram Bot API token from @BotFather' },
    notifyChatId: {
      oneOf: [{ type: 'string' }, { type: 'integer' }],
      description: 'Default chat ID for outgoing notifications',
    },
    inboundMode: {
      type: 'string',
      enum: [...INBOUND_MODES],
      default: 'disabled',
      description:
        'Inbound access: disabled, paired to notifyChatId, restricted by allowlists, or explicitly public',
    },
    allowedUsers: {
      type: 'array',
      items: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      description: 'User IDs accepted when inboundMode is allowlist',
    },
    allowedChats: {
      type: 'array',
      items: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      description: 'Chat IDs accepted when inboundMode is allowlist',
    },
    allowedOutboundChats: {
      type: 'array',
      items: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      description: 'Additional trusted targets for outbound Telegram sends',
    },
    pollIntervalSec: {
      type: 'integer',
      minimum: 1,
      maximum: 60,
      description: 'Polling interval in seconds',
    },
    notifyOnSessionEnd: { type: 'boolean' },
    longToolThresholdMs: { type: 'integer', minimum: 0 },
    notifyOnDelegate: { type: 'boolean' },
    maxMessageLength: { type: 'integer', minimum: 100, maximum: 4096 },
    singleInstanceLock: {
      type: 'boolean',
      description:
        'Elect a single getUpdates poller per bot token across wstack instances (default true)',
    },
    outboundQueuePerChat: {
      type: 'integer',
      minimum: 1,
      maximum: 1000,
      description: 'Per-chat pending outbound-message cap (default 32)',
    },
    outboundQueueConcurrency: {
      type: 'integer',
      minimum: 1,
      maximum: 64,
      description: 'Maximum concurrent outbound sends across all chats (default 4)',
    },
  },
  required: ['botToken'],
};

export function readTelegramConfig(
  api: Pick<PluginAPI, 'config'> & Partial<Pick<PluginAPI, 'log'>>,
): Required<Omit<TelegramPluginConfig, 'notifyChatId' | 'offsetStoragePath'>> &
  Pick<TelegramPluginConfig, 'notifyChatId' | 'offsetStoragePath'> {
  const config = api.config as never as Record<string, unknown>;
  const extensions = config.extensions as Record<string, unknown> | undefined;
  const pluginEntries = config.plugins;
  const legacyPlugins = pluginEntries as Record<string, unknown> | undefined;
  const legacyOpts =
    legacyPlugins && !Array.isArray(legacyPlugins) ? legacyPlugins[PLUGIN_NAME] : undefined;
  const entryOpts = pluginOptionsFromEntries(pluginEntries);
  const extensionOpts = extensions?.[PLUGIN_NAME];
  const opts = {
    ...((legacyOpts ?? entryOpts) as TelegramPluginConfig),
    ...((extensionOpts ?? {}) as TelegramPluginConfig),
  };
  const inboundMode = resolveInboundMode(opts, {
    configured: legacyOpts !== undefined || entryOpts !== undefined || extensionOpts !== undefined,
    warn: api.log?.warn.bind(api.log),
  });

  return {
    ...DEFAULT_CONFIG,
    ...opts,
    inboundMode,
  };
}

function resolveInboundMode(
  opts: TelegramPluginConfig,
  migration: { configured: boolean; warn?: ((message: string) => void) | undefined },
): TelegramInboundMode {
  if (opts.inboundMode !== undefined) {
    if (!INBOUND_MODES.includes(opts.inboundMode)) {
      throw new Error(
        `Invalid telegram inboundMode "${String(opts.inboundMode)}". Expected one of: ${INBOUND_MODES.join(', ')}.`,
      );
    }
    if (
      opts.inboundMode === 'allowlist' &&
      !hasEntries(opts.allowedUsers) &&
      !hasEntries(opts.allowedChats)
    ) {
      throw new Error(
        'Telegram inboundMode "allowlist" requires at least one allowedUsers or allowedChats entry.',
      );
    }
    if (opts.inboundMode === 'paired' && opts.notifyChatId === undefined) {
      throw new Error('Telegram inboundMode "paired" requires notifyChatId.');
    }
    return opts.inboundMode;
  }

  if (hasEntries(opts.allowedUsers) || hasEntries(opts.allowedChats)) return 'allowlist';

  const inferredMode: TelegramInboundMode = opts.notifyChatId === undefined ? 'disabled' : 'paired';
  if (migration.configured) {
    migration.warn?.(
      `Telegram inbound access no longer defaults to public when allowedUsers and allowedChats are empty; inferred inboundMode "${inferredMode}". Set inboundMode "public" explicitly to preserve legacy allow-all behavior.`,
    );
  }
  return inferredMode;
}

function hasEntries(values: Array<string | number> | undefined): boolean {
  return Array.isArray(values) && values.length > 0;
}

function pluginOptionsFromEntries(entries: unknown): TelegramPluginConfig | undefined {
  if (!Array.isArray(entries)) return undefined;
  const found = entries.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'name' in entry &&
      ((entry as { name?: unknown | undefined }).name === '@wrongstack/telegram' ||
        (entry as { name?: unknown | undefined }).name === PLUGIN_NAME),
  ) as { name?: unknown | undefined; options?: unknown | undefined } | undefined;
  return found?.options && typeof found.options === 'object'
    ? (found.options as TelegramPluginConfig)
    : undefined;
}
