import { createHash } from 'node:crypto';
import type { EventBus } from '../kernel/events.js';
import type { PluginAPI } from '../types/plugin.js';
import type { ReviewContextBundle, ReviewFileEntry } from './review-types.js';

interface ReviewClaim {
  key: string;
  fingerprint: string;
}

interface ClaimedReview {
  bundle: ReviewContextBundle;
  claims: ReviewClaim[];
}

interface StartedReview {
  events: EventBus;
  claims: ReviewClaim[];
}

/**
 * Review claims are scoped to the host EventBus, which is shared by the
 * Chimera and auto-review plugins for one session and garbage-collected with
 * that session. A claim means that a review has been scheduled for this exact
 * file content, not that the review has already completed.
 */
const claimsByEventBus = new WeakMap<EventBus, Map<string, Set<string>>>();
const startedReviews = new WeakMap<ReviewContextBundle, StartedReview>();

function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function claimKey(cwd: string, filePath: string): string {
  return `${cwd}\0${filePath}`;
}

function ledgerFor(events: EventBus): Map<string, Set<string>> {
  let ledger = claimsByEventBus.get(events);
  if (!ledger) {
    ledger = new Map<string, Set<string>>();
    claimsByEventBus.set(events, ledger);
  }
  return ledger;
}

function claimFiles(
  events: EventBus,
  cwd: string,
  files: ReviewFileEntry[],
): ClaimedReview['claims'] {
  const ledger = ledgerFor(events);
  const claims: ReviewClaim[] = [];

  for (const file of files) {
    const key = claimKey(cwd, file.path);
    const fileFingerprint = fingerprint(file.content);
    let activeFingerprints = ledger.get(key);
    if (!activeFingerprints) {
      activeFingerprints = new Set<string>();
      ledger.set(key, activeFingerprints);
    }
    if (activeFingerprints.has(fileFingerprint)) continue;
    activeFingerprints.add(fileFingerprint);
    claims.push({ key, fingerprint: fileFingerprint });
  }

  return claims;
}

function releaseClaims(events: EventBus, claims: ReviewClaim[]): void {
  const ledger = ledgerFor(events);
  for (const claim of claims) {
    const activeFingerprints = ledger.get(claim.key);
    if (!activeFingerprints) continue;
    activeFingerprints.delete(claim.fingerprint);
    if (activeFingerprints.size === 0) ledger.delete(claim.key);
  }
}

/**
 * Record review events emitted outside the automatic plugin paths, such as
 * `/review`, so the post-session pass also avoids repeating those files.
 */
export function recordStartedReview(events: EventBus, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const candidate = payload as Partial<ReviewContextBundle>;
  if (typeof candidate.cwd !== 'string' || !Array.isArray(candidate.files)) return;

  const files = candidate.files.filter(
    (file): file is ReviewFileEntry =>
      Boolean(file) &&
      typeof file === 'object' &&
      typeof (file as ReviewFileEntry).path === 'string' &&
      typeof (file as ReviewFileEntry).content === 'string',
  );
  const claims = claimFiles(events, candidate.cwd, files);
  if (claims.length > 0) {
    startedReviews.set(payload as ReviewContextBundle, { events, claims });
  }
}

/**
 * Release the exact claims associated with a completed review bundle. Bundle
 * identity prevents an older completion from removing newer in-flight claims.
 */
export function recordCompletedReview(events: EventBus, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const bundle = (payload as { bundle?: unknown }).bundle;
  if (!bundle || typeof bundle !== 'object') return;

  const startedReview = startedReviews.get(bundle as ReviewContextBundle);
  if (!startedReview || startedReview.events !== events) return;
  releaseClaims(events, startedReview.claims);
  startedReviews.delete(bundle as ReviewContextBundle);
}

/**
 * Atomically claim review inputs and emit only files whose exact content does
 * not already have a review in progress. The returned bundle contains only
 * claimed files and may be a strict subset of the input.
 *
 * Claims are installed immediately before the synchronous event emission, so
 * concurrent mid/post-session handlers cannot enqueue the same content twice.
 * A synchronous emit failure rolls the claims back.
 */
export function emitReviewIfChanged(
  api: Pick<PluginAPI, 'events' | 'emitCustom'>,
  bundle: ReviewContextBundle,
): ReviewContextBundle | null {
  const claims = claimFiles(api.events, bundle.cwd, bundle.files);
  if (claims.length === 0) return null;

  const claimedKeys = new Set(claims.map((claim) => claim.key));
  const claimedBundle: ReviewContextBundle = {
    ...bundle,
    files: bundle.files.filter((file) => claimedKeys.has(claimKey(bundle.cwd, file.path))),
  };

  startedReviews.set(claimedBundle, { events: api.events, claims });
  try {
    api.emitCustom('chimera.review_needed', claimedBundle);
    return claimedBundle;
  } catch (err) {
    startedReviews.delete(claimedBundle);
    releaseClaims(api.events, claims);
    throw err;
  }
}
