/**
 * WebhookNotificationChannel — NotificationChannel implementation for
 * generic HTTP(S) webhook delivery.
 *
 * POSTs JSON payloads to a configurable webhook URL (Slack/Discord
 * compatible via generic JSON, n8n, ntfy, or any HTTP endpoint). Includes
 * a built-in circuit breaker that stops delivery after N consecutive
 * failures to avoid hammering a dead endpoint.
 *
 * The channel is stateless beyond the circuit breaker state — each
 * `deliver()` call is an independent HTTP POST. The caller (Notifier or
 * direct user) is responsible for retry logic if needed.
 *
 * @module notify-hub
 * @public
 */

import type { NotificationChannel, NotificationMessage, NotificationResult } from '@wrongstack/core';

// ---------------------------------------------------------------------------
// Circuit breaker state
// ---------------------------------------------------------------------------

interface CircuitState {
  open: boolean;
  consecutiveFailures: number;
}

function freshCircuit(): CircuitState {
  return { open: false, consecutiveFailures: 0 };
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export interface WebhookChannelOptions {
  /** HTTP(S) endpoint that receives JSON POSTs. */
  readonly webhookUrl: string;
  /** Extra HTTP headers sent with every delivery (e.g. Authorization). */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Per-delivery timeout in ms (default 5000). */
  readonly timeoutMs?: number | undefined;
  /**
   * Circuit breaker threshold — stop trying after this many consecutive
   * failures. Default 5. Set to 0 to disable the circuit breaker.
   */
  readonly maxConsecutiveFailures?: number | undefined;
}

export class WebhookNotificationChannel implements NotificationChannel {
  readonly name = 'webhook' as const;
  readonly type = 'webhook' as const;

  readonly #url: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #timeoutMs: number;
  readonly #maxFailures: number;
  readonly #circuit: CircuitState;

  /** Total deliveries attempted (across all resets). */
  #totalAttempted = 0;
  /** Total successful deliveries. */
  #totalDelivered = 0;
  /** Total failed deliveries. */
  #totalFailed = 0;
  /** Total suppressed by circuit breaker. */
  #totalSuppressed = 0;

  constructor(opts: WebhookChannelOptions) {
    this.#url = opts.webhookUrl;
    this.#headers = opts.headers ?? {};
    this.#timeoutMs = opts.timeoutMs ?? 5_000;
    this.#maxFailures = opts.maxConsecutiveFailures ?? 5;
    this.#circuit = freshCircuit();
  }

  // -----------------------------------------------------------------------
  // NotificationChannel
  // -----------------------------------------------------------------------

  async deliver(msg: NotificationMessage): Promise<NotificationResult> {
    const deliveredAt = new Date().toISOString();

    // Circuit breaker gate — check before attempting delivery.
    if (this.#circuit.open && this.#maxFailures > 0) {
      this.#totalSuppressed += 1;
      return {
        ok: false,
        channel: this.name,
        error: `circuit open after ${this.#circuit.consecutiveFailures} consecutive failures`,
        deliveredAt,
      };
    }

    this.#totalAttempted += 1;

    const body = JSON.stringify({
      source: 'wrongstack/notify-hub',
      event: msg.source,
      ts: deliveredAt,
      title: msg.title,
      message: msg.body,
      level: msg.level,
      ...(msg.metadata ?? {}),
    });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const res = await fetch(this.#url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...this.#headers },
          body,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`webhook responded ${res.status}`);
      } finally {
        clearTimeout(timer);
      }

      // Success — reset circuit breaker.
      this.#totalDelivered += 1;
      this.#circuit.consecutiveFailures = 0;
      this.#circuit.open = false;

      return { ok: true, channel: this.name, deliveredAt };
    } catch (err) {
      this.#totalFailed += 1;
      this.#circuit.consecutiveFailures += 1;
      if (this.#maxFailures > 0 && this.#circuit.consecutiveFailures >= this.#maxFailures) {
        this.#circuit.open = true;
      }

      return {
        ok: false,
        channel: this.name,
        error: err instanceof Error ? err.message : String(err),
        deliveredAt,
      };
    }
  }

  async ping(): Promise<{ ok: boolean; error?: string | undefined }> {
    if (!this.#url) {
      return { ok: false, error: 'no webhookUrl configured' };
    }
    if (this.#circuit.open) {
      return {
        ok: false,
        error: `circuit open after ${this.#circuit.consecutiveFailures} consecutive failures`,
      };
    }
    // No permanent connection to probe — assume healthy.
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Diagnostics (not part of NotificationChannel)
  // -----------------------------------------------------------------------

  /** Reset the circuit breaker (e.g. after config update). */
  resetCircuit(): void {
    this.#circuit.open = false;
    this.#circuit.consecutiveFailures = 0;
  }

  /** Current circuit breaker state. */
  circuitStatus(): { open: boolean; consecutiveFailures: number } {
    return { open: this.#circuit.open, consecutiveFailures: this.#circuit.consecutiveFailures };
  }

  /** Lifetime delivery counters (never reset). */
  counters(): {
    attempted: number;
    delivered: number;
    failed: number;
    suppressed: number;
  } {
    return {
      attempted: this.#totalAttempted,
      delivered: this.#totalDelivered,
      failed: this.#totalFailed,
      suppressed: this.#totalSuppressed,
    };
  }
}
