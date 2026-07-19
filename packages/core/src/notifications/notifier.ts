/**
 * Notifier — central dispatch for one-way notification delivery.
 *
 * The `Notifier` is the entry point for all notification traffic. It maps
 * channel names to `NotificationChannel` instances and handles dispatch,
 * result aggregation, and channel health reporting.
 *
 * A host (CLI, TUI, WebUI) creates one `Notifier` instance at startup,
 * registers channels from plugins and config, and makes it available via
 * the container or context. Plugins and the agent loop call
 * `notifier.notify()` to deliver messages.
 *
 * @module notifications
 * @public
 */

import type { NotificationChannel, NotificationMessage, NotificationResult } from './types.js';

// ---------------------------------------------------------------------------
// Notifier interface
// ---------------------------------------------------------------------------

/**
 * Central dispatch for one-way notifications.
 *
 * Implementations aggregate results across all targeted channels and report
 * delivery status per channel. The caller does NOT need to know which
 * channel implementations are registered — it addresses channels by their
 * configured name.
 */
export interface Notifier {
  /**
   * Deliver a message to one or more named channels.
   *
   * @param channels - Channel name or an array of channel names (e.g.
   *   `"slack"`, `["telegram", "slack"]`). Unknown names are silently
   *   skipped — the result array only includes entries for registered
   *   channels. An empty array or all-unknown names produces an empty
   *   result array.
   * @param message - The notification payload. The `source` field is
   *   automatically set to the caller's identifier if not already present.
   *
   * @returns One `NotificationResult` per matched channel, in registration
   *   order. The caller should NOT treat `ok = false` on one channel as
   *   a reason to retry the whole batch — channels have independent
   *   circuit breakers and backoff policies.
   */
  notify(channels: string | string[], message: NotificationMessage): Promise<NotificationResult[]>;

  /**
   * Register a channel implementation.
   *
   * Channels are identified by `NotificationChannel.name`. Registering a
   * channel with a name that already exists **replaces** the previous
   * registration (last-write-wins). This lets config changes swap out a
   * channel implementation without restarting.
   */
  registerChannel(channel: NotificationChannel): void;

  /**
   * Remove a registered channel by name. Idempotent — removing a
   * non-existent name is a no-op.
   */
  unregisterChannel(name: string): void;

  /**
   * Return the current state of all registered channels.
   *
   * Calls `ping()` on each channel in parallel. A channel that throws
   * during `ping()` is reported as `{ ok: false, error: "ping failed" }`
   * rather than propagating the error to the caller.
   */
  channels(): Promise<NotificationChannelStatus[]>;

  /**
   * Return a snapshot of the delivery counters aggregated across all
   * channels since the notifier was created (or since the last reset).
   * Useful for diagnostics and the health endpoint.
   */
  counters(): NotifierCounters;
}

// ---------------------------------------------------------------------------
// Re-exported for convenience
// ---------------------------------------------------------------------------

export type {
  NotificationChannel,
  NotificationLevel,
  NotificationMessage,
  NotificationResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/** Per-channel health status produced by `Notifier.channels()`. */
export interface NotificationChannelStatus {
  /** Channel name (matches `NotificationChannel.name`). */
  name: string;
  /** Channel type discriminator. */
  type: string;
  /** Whether `ping()` returned success. */
  ok: boolean;
  /** Error message when `ok` is false. */
  error?: string | undefined;
}

/** Aggregate counters exposed by `Notifier.counters()`. */
export interface NotifierCounters {
  /** Total delivery attempts across all channels. */
  attempted: number;
  /** Successful deliveries. */
  delivered: number;
  /** Failed deliveries. */
  failed: number;
  /** Deliveries suppressed by circuit breakers. */
  suppressed: number;
}
