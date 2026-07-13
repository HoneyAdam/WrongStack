/**
 * Centralized constants for the mailbox system.
 *
 * Previously these magic numbers were scattered across global-mailbox.ts,
 * mailbox-attach.ts, mailbox-hooks.ts, and mailbox-health.ts. Keeping them
 * in one place ensures every surface agrees on timeouts, intervals, and
 * thresholds — and makes tuning a single-file change.
 *
 * @module mailbox-constants
 */

/**
 * Agents without a heartbeat for this long are no longer live and are removed
 * from the registry. Presence registries are not history stores: retaining an
 * offline row makes dead agents and shadow workers look actionable in HQ.
 */
export const AGENT_STALE_MS = 60_000;

/** Clients without a heartbeat for this long are considered offline. */
export const CLIENT_STALE_MS = 60_000;

/** Heartbeat updates are throttled to at most this interval (per agent/client). */
export const HEARTBEAT_THROTTLE_MS = 5_000;

/**
 * How long a read may be served from the in-process registry cache before
 * re-reading the shared file. Kept well below HEARTBEAT_THROTTLE_MS so
 * cross-process registrations become visible promptly.
 */
export const REGISTRY_CACHE_TTL_MS = 2_000;

/** JSONL line separator. */
export const LINE_SEPARATOR = '\n';

/**
 * Soft cap on the in-memory message cache. The cache mirrors the JSONL
 * message file; under normal load it stays well under this. If a pathological
 * mailbox exceeds the cap we fall back to reading from disk rather than
 * holding an unbounded buffer in memory.
 */
export const MESSAGE_CACHE_MAX_ENTRIES = 10_000;

// ── Polling / heartbeat intervals (used by mailbox-attach.ts) ──────────────

/** Background mailbox awareness polling interval (cross-process fallback). */
export const MAILBOX_AWARENESS_INTERVAL_MS = 30_000;

/** Agent heartbeat interval in the attach layer. */
export const MAILBOX_HEARTBEAT_INTERVAL_MS = 30_000;

/** Min interval between registry reads for the fleet pulse digest. */
export const PULSE_MIN_READ_INTERVAL_MS = 30_000;

// ── Auto-cleanup / compaction ──────────────────────────────────────────────

/**
 * Interval at which the background auto-compaction sweep runs.
 * Default: every 5 minutes.
 */
export const AUTO_COMPACT_INTERVAL_MS = 300_000;

/**
 * Messages that have been read by ALL currently-online agents are eligible
 * for auto-removal after this many milliseconds since the last read.
 * Default: 10 minutes.
 */
export const AUTO_COMPACT_READ_MAX_AGE_MS = 600_000;

/**
 * Messages whose TTL (time-to-live) has expired are eligible for auto-removal.
 * When a message has `expiresAt` set and that timestamp is in the past, the
 * next compaction sweep drops it. Default TTL for messages without an explicit
 * `expiresAt`: 24 hours.
 */
export const AUTO_COMPACT_DEFAULT_TTL_MS = 86_400_000; // 24h

// ── HTTP bridge rate limiting ──────────────────────────────────────────────

/** Maximum requests per minute from a single external agent (bearer token). */
export const HTTP_RATE_LIMIT_PER_MINUTE = 120;

/** Window size for the sliding-window rate limiter. */
export const HTTP_RATE_LIMIT_WINDOW_MS = 60_000;
