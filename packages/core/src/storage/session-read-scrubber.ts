import type { SecretScrubber } from '../types/secret-scrubber.js';
import type { SessionData, SessionEvent, SessionSummary } from '../types/session.js';

/**
 * Read-side migration boundary for transcripts written before write-time
 * secret scrubbing existed. Scrub the complete object graph before it enters
 * a cache, message projection, search result, export, or surface response.
 */
export function scrubPersistedSessionEvent(
  event: SessionEvent,
  scrubber: SecretScrubber,
): SessionEvent {
  return scrubber.scrubObject(event);
}

export function scrubPersistedSessionData(
  data: SessionData,
  scrubber: SecretScrubber,
): SessionData {
  return scrubber.scrubObject(data);
}

export function scrubPersistedSessionSummary(
  summary: SessionSummary,
  scrubber: SecretScrubber,
): SessionSummary {
  return scrubber.scrubObject(summary);
}
