// ---------------------------------------------------------------------------
// P2.2 — Classify each Telegram runtime config key as either
// "hot-reload-safe" or "requires restart".
//
// The plugin can apply changes live for keys marked HOT. Anything else
// (identity, transport, capacity) touches the long-lived bot, the
// outbound-queue worker, or the poll lock — so it must surface a restart
// hint to the operator rather than silently misbehave.
//
// This module is a compatibility facade over the Core lifecycle metadata:
// no fs, no network, no side effects. TELEGRAM_CONFIG_FIELDS is the single
// source of truth and is exhaustive at the type level. Unknown keys are
// defaulted to 'immutable' inside diffPluginConfig (Core); anything not
// 'hot' (i.e. both 'restart' and 'immutable') is folded to 'restart-required'
// here, so a newly added or restart-required field stays restart-required
// until explicitly marked HOT.
// ---------------------------------------------------------------------------

import { diffPluginConfig } from '@wrongstack/core';
import { TELEGRAM_CONFIG_FIELDS, type TelegramPluginConfig } from './config.js';

export type ConfigReloadClass = 'hot' | 'restart-required';

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
  // Double cast: TelegramPluginConfig has optional fields, so its structural
  // type is not assignable to Record<string, unknown> directly. The key cast
  // below is safe because diffPluginConfig only iterates Object.keys(prev) ∪ Object.keys(next).
  return diffPluginConfig(
    previous as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
    TELEGRAM_CONFIG_FIELDS,
  ).map((change) => ({
    key: change.key as keyof TelegramPluginConfig,
    classification: change.lifecycle === 'hot' ? 'hot' : 'restart-required',
  }));
}
