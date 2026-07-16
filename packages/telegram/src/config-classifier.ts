// ---------------------------------------------------------------------------
// P2.2 — Classify each Telegram runtime config key as either
// "hot-reload-safe" or "requires restart".
//
// The plugin can apply changes live for keys marked HOT. Anything else
// (identity, transport, capacity) touches the long-lived bot, the
// outbound-queue worker, or the poll lock — so it must surface a restart
// hint to the operator rather than silently misbehave.
//
// This module is a pure classifier: no fs, no network, no side effects.
// The single-source-of-truth is a `Set<keyof TelegramPluginConfig>` so
// misclassifying a future config field fails at the type level.
// ---------------------------------------------------------------------------

import type { TelegramPluginConfig } from './config.js';

/**
 * Keys the Telegram plugin can apply live without restarting the bot.
 *
 * Rationale per key:
 * - `inboundMode` / `allowedUsers` / `allowedChats` — `processMessage`
 *   and `dispatchCallback` re-read the allowlist on every inbound call,
 *   so toggling the mode or editing the lists takes effect immediately.
 * - `notifyOnSessionEnd` / `notifyOnDelegate` — re-evaluated on each
 *   event subscription; no in-flight state to restart.
 * - `longToolThresholdMs` — pure threshold read inside the tool-notify
 *   handler; the next long-tool event uses the new value.
 * - `maxMessageLength` / `allowedOutboundChats` — re-read on every
 *   `sendMessage` / outbound-target resolution, so the next send reflects
 *   the change.
 * - `pollIntervalSec` — the poller reads this on each iteration of its
 *   wait loop; the next tick uses the new interval.
 * - `outboundQueuePerChat` / `outboundQueueConcurrency` — the outbound
 *   queue reads these only at construction. They are documented as
 *   hot-reload in spirit (the queue can be re-evaluated) but the live
 *   queue owns a stable copy. Marking them HOT would silently mislead,
 *   so they are intentionally EXCLUDED until the queue supports
 *   mid-flight reconfiguration. See `restart-required` below.
 */
export const HOT_RELOAD_KEYS = new Set<keyof TelegramPluginConfig>([
  'inboundMode',
  'allowedUsers',
  'allowedChats',
  'allowedOutboundChats',
  'pollIntervalSec',
  'notifyOnSessionEnd',
  'notifyOnDelegate',
  'longToolThresholdMs',
  'maxMessageLength',
]);

/**
 * Keys that require restarting the Telegram plugin (or wstack itself)
 * for the new value to take effect.
 *
 * - `botToken` — every Telegram transport object is constructed once with
 *   the token baked into the base URL; changing it requires a new
 *   `TelegramBot` instance.
 * - `notifyChatId` — bound into the optional-allowedUsers fallback at
 *   setup (`inboundAllowlist`) and read by every notification callback;
 *   the inbound allowlist does not rebuild without a setup re-run.
 * - `offsetStoragePath` — the `OffsetStore` is opened once at setup;
 *   changing the path would orphan any persisted cursor.
 * - `singleInstanceLock` — the cross-process `PollLock` is acquired at
 *   startup; flipping this flag requires a fresh setup to acquire /
 *   release the right lock file.
 * - `outboundQueuePerChat` / `outboundQueueConcurrency` — the
 *   `OutboundQueue` reads these at construction only.
 */
export const RESTART_REQUIRED_KEYS = new Set<keyof TelegramPluginConfig>([
  'botToken',
  'notifyChatId',
  'offsetStoragePath',
  'singleInstanceLock',
  'outboundQueuePerChat',
  'outboundQueueConcurrency',
]);

export type ConfigReloadClass = 'hot' | 'restart-required';

/**
 * Classify a single key. Returns `'hot'` for keys in `HOT_RELOAD_KEYS`,
 * `'restart-required'` for keys in `RESTART_REQUIRED_KEYS`, and
 * `'restart-required'` as a conservative default for keys that are not
 * registered in either set — preventing a new field from silently
 * pretending to be hot-reloadable before the classifier is updated.
 */
export function classifyReload(key: keyof TelegramPluginConfig): ConfigReloadClass {
  if (HOT_RELOAD_KEYS.has(key)) return 'hot';
  return 'restart-required';
}

/**
 * Diff two configs and return the keys whose values differ, each tagged
 * with its reload classification. Keys present in `previous` but absent in
 * `next` (or vice versa) are reported as `'restart-required'` so a stale
 * removal is never silently applied as a live change.
 */
export function diffConfigKeys(
  previous: TelegramPluginConfig,
  next: TelegramPluginConfig,
): Array<{ key: keyof TelegramPluginConfig; classification: ConfigReloadClass }> {
  const allKeys = new Set<keyof TelegramPluginConfig>([
    ...(Object.keys(previous) as Array<keyof TelegramPluginConfig>),
    ...(Object.keys(next) as Array<keyof TelegramPluginConfig>),
  ]);
  const changes: Array<{ key: keyof TelegramPluginConfig; classification: ConfigReloadClass }> = [];
  for (const key of allKeys) {
    const a = previous[key];
    const b = next[key];
    if (!valueEquals(a, b)) {
      changes.push({ key, classification: classifyReload(key) });
    }
  }
  return changes;
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!valueEquals(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}
