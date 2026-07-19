/**
 * Core notification types for the Notifications/Channels system.
 *
 * This module defines the contracts for **one-way** communication from the
 * agent to the user through any registered notification channel. Every channel
 * (Telegram, Slack webhook, generic webhook, email, ntfy, etc.) implements
 * the same `NotificationChannel` interface.
 *
 * Design principles:
 *
 *  1. **One-way only.** Notifications are fire-and-forget — the agent sends,
 *     the channel delivers. Reply-style 2-way communication (read, approve,
 *     callback queries) belongs in the specific channel's own subsystem
 *     (e.g. Telegram's telegram_read / telegram_approve tools).
 *
 *  2. **Channel-agnostic.** A `NotificationMessage` has no Telegram-specific
 *     fields. The channel implementation decides how to render it (emoji,
 *     markdown, JSON, etc.).
 *
 *  3. **Level-gated.** Each message carries a severity level so channels can
 *     filter by importance (e.g. "only critical to email").
 *
 *  4. **Config-driven routing.** Messages flow to channels through a central
 *     `Notifier` that maps event → channel names. Channels are registered
 *     by the host or by plugins at startup.
 *
 * @module notifications
 * @public
 */

// ---------------------------------------------------------------------------
// Severity levels
// ---------------------------------------------------------------------------

/** Notification severity — hints at urgency without prescribing delivery. */
export type NotificationLevel = 'info' | 'warning' | 'critical';

// ---------------------------------------------------------------------------
// Message shape
// ---------------------------------------------------------------------------

/**
 * A message to be delivered through one or more notification channels.
 * Channels render the fields as appropriate for their medium (plain text,
 * Slack blocks, HTML email, etc.).
 */
export interface NotificationMessage {
  /** Short headline — ideally under 80 chars for push notifications. */
  title: string;
  /** Body text with details. Supports plain text only; channels that accept
   * markdown (Slack, Discord) may apply light formatting on delivery. */
  body: string;
  /** Severity hint for the channel's routing logic (e.g. "critical" bypasses
   * summarisation, triggers push alerts). */
  level: NotificationLevel;
  /**
   * Machine-readable source identifier — the event or subsystem that
   * triggered the notification, such as `"session.end"`, `"tool.exec"`,
   * `"delegate.completed"`, `"notify.send"`.
   */
  source: string;
  /**
   * Optional structured context the channel may use for rendering decisions.
   * Values must be JSON-serialisable. Example keys: `durationMs`, `ok`,
   * `tokens`, `url`.
   */
  metadata?: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Delivery result
// ---------------------------------------------------------------------------

/** Outcome of a single delivery attempt on one channel. */
export interface NotificationResult {
  /** Whether the channel accepted and delivered the message. */
  ok: boolean;
  /** Channel name (matches `NotificationChannel.name`). */
  channel: string;
  /** Human-readable error when `ok` is false. */
  error?: string | undefined;
  /** ISO-8601 timestamp of when delivery was attempted. */
  deliveredAt: string;
}

// ---------------------------------------------------------------------------
// Channel contract
// ---------------------------------------------------------------------------

/**
 * A deliverable notification channel.
 *
 * Implement this interface to add a new notification provider. Each provider
 * is responsible for its own connection lifecycle, authentication, and
 * delivery semantics. The host calls `deliver(msg)` and expects a truthful
 * result — the channel should catch and report errors rather than throwing.
 *
 * Channels are **not** expected to be long-running servers; a channel may
 * open a connection per call (webhook POST) or maintain a persistent
 * connection (WebSocket, Telegram long-polling sender).
 */
export interface NotificationChannel {
  /** Canonical name used in config routes, e.g. `"slack"`, `"telegram"`. */
  readonly name: string;
  /** Type discriminator for diagnostics, e.g. `"webhook"`, `"telegram"`,
   * `"email"`. Multiple channels may share a type (e.g. Slack and Discord
   * are both `"webhook"`). */
  readonly type: string;

  /**
   * Deliver a notification message through this channel.
   *
   * **Must not throw.** Catch transport errors and return
   * `{ ok: false, error: "…" }` instead. The `Notifier` uses this contract
   * to count failures and manage circuit breakers.
   */
  deliver(msg: NotificationMessage): Promise<NotificationResult>;

  /**
   * Liveness check — called by the host's `health()` aggregator and by the
   * `Notifier.channels()` status view.
   *
   * Should make a best-effort probe of the channel's reachability without
   * sending a real notification. When the channel cannot probe (e.g. no
   * permanent connection), return `{ ok: true }` — the host treats an
   * absent probe as "assume healthy".
   */
  ping(): Promise<{ ok: boolean; error?: string | undefined }>;
}
