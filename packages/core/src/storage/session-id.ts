/**
 * Session ID generation — extracted from session-store.ts.
 *
 * Pure functions: no I/O, no class state, no side effects.
 * Safe to unit-test in isolation.
 */
import { randomBytes } from 'node:crypto';

/** Sanitize a model name for use in filenames: alphanumeric + dash + underscore. */
export function sanitizeModel(model: string): string {
  return model
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * Generate a session ID in the format:
 *   `YYYY-MM-DD/HH-MM-SSZ[_model]_xxxx.jsonl`
 *
 * Examples:
 *   `2026-06-06/12-30-45Z_claude-sonnet_a1b2.jsonl`
 *   `2026-06-06/14-22-10Z_a1b2.jsonl`          (no model)
 *
 * The date prefix becomes a subdirectory so sessions group naturally by day.
 * The model name (when available) lets you see at a glance which provider was
 * used, without opening the file. The 4-byte random suffix prevents collisions
 * within the same second.
 */
export function generateSessionId(startedAt: string, model?: string): string {
  const date = startedAt.slice(0, 10); // "2026-06-06"
  const time = startedAt.slice(11, 19).replace(/:/g, '-'); // "12-30-45"
  const suffix = randomBytes(2).toString('hex'); // "a1b2"
  const modelPart = model ? `_${sanitizeModel(model)}` : '';
  return `${date}/${time}Z${modelPart}_${suffix}`;
}
