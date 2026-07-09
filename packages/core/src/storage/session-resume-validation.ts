import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ResumeFileValidationEntry,
  ResumeValidation,
  SessionEvent,
} from '../types/session.js';
import { toErrorMessage } from '../utils/index.js';
import { mapWithConcurrency } from './storage-concurrency.js';

const MAX_REVALIDATE_BYTES = 5 * 1024 * 1024;
const VALIDATION_CONCURRENCY = 8;
const NOTICE_PATH_LIMIT = 20;

interface FileObservation {
  path: string;
  hash: string;
  ts: string;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function errno(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? String((err as NodeJS.ErrnoException).code)
    : undefined;
}

function latestObservations(events: readonly SessionEvent[], projectRoot: string): FileObservation[] {
  const latest = new Map<string, FileObservation>();
  for (const event of events) {
    if (
      event.type !== 'file_observation' ||
      typeof event.path !== 'string' ||
      event.path.length === 0 ||
      typeof event.hash !== 'string' ||
      !/^[a-f\d]{64}$/i.test(event.hash)
    ) {
      continue;
    }
    const normalized = path.resolve(projectRoot, event.path);
    latest.set(normalized, {
      path: normalized,
      hash: event.hash.toLowerCase(),
      ts: event.ts,
    });
  }
  return [...latest.values()];
}

async function validateOne(
  observation: FileObservation,
  lexicalRoot: string,
  realRoot: string,
): Promise<ResumeFileValidationEntry | null> {
  const base = {
    path: observation.path,
    observedAt: observation.ts,
    expectedHash: observation.hash,
  };

  if (!isInside(lexicalRoot, observation.path)) {
    return {
      ...base,
      status: 'outside_project',
      detail: 'Recorded path is outside the active project root.',
    };
  }

  let realFile: string;
  try {
    realFile = await fsp.realpath(observation.path);
  } catch (err) {
    if (errno(err) === 'ENOENT') return { ...base, status: 'deleted' };
    return { ...base, status: 'unreadable', detail: toErrorMessage(err) };
  }

  if (!isInside(realRoot, realFile)) {
    return {
      ...base,
      status: 'outside_project',
      detail: 'Recorded path resolves through a symlink outside the active project root.',
    };
  }

  try {
    const stat = await fsp.stat(realFile);
    if (!stat.isFile()) {
      return { ...base, status: 'unreadable', detail: 'Path is no longer a regular file.' };
    }
    if (stat.size > MAX_REVALIDATE_BYTES) {
      return {
        ...base,
        status: 'unreadable',
        detail: `File now exceeds the ${MAX_REVALIDATE_BYTES}-byte validation limit.`,
      };
    }
    // File tools persist sha256(UTF-8 text), so validation deliberately uses
    // the same decoding/hash semantics rather than hashing raw bytes.
    const content = await fsp.readFile(realFile, 'utf8');
    const actualHash = createHash('sha256').update(content, 'utf8').digest('hex');
    if (actualHash === observation.hash) return null;
    return { ...base, status: 'modified', actualHash };
  } catch (err) {
    if (errno(err) === 'ENOENT') return { ...base, status: 'deleted' };
    return { ...base, status: 'unreadable', detail: toErrorMessage(err) };
  }
}

/** Revalidate the latest persisted hash for every distinct observed path. */
export async function validateResumeFileObservations(
  events: readonly SessionEvent[],
  projectRoot: string,
): Promise<ResumeValidation> {
  const lexicalRoot = path.resolve(projectRoot);
  const realRoot = await fsp.realpath(lexicalRoot).catch(() => lexicalRoot);
  const observations = latestObservations(events, lexicalRoot);
  const results = await mapWithConcurrency(
    observations,
    VALIDATION_CONCURRENCY,
    (observation) => validateOne(observation, lexicalRoot, realRoot),
  );
  return {
    checkedAt: new Date().toISOString(),
    checkedFileCount: observations.length,
    staleFiles: results.filter((entry): entry is ResumeFileValidationEntry => entry !== null),
  };
}

/** Build the ephemeral system message injected into the first resumed turn. */
export function formatResumeValidationNotice(
  validation: ResumeValidation,
  projectRoot: string,
): string | null {
  if (validation.staleFiles.length === 0) return null;
  const root = path.resolve(projectRoot);
  const shown = validation.staleFiles.slice(0, NOTICE_PATH_LIMIT).map((entry) => {
    const relative = path.relative(root, entry.path);
    const display = isInside(root, entry.path) ? relative || '.' : entry.path;
    return `- ${JSON.stringify(display)} [${entry.status}]`;
  });
  const omitted = validation.staleFiles.length - shown.length;
  if (omitted > 0) shown.push(`- ... and ${omitted} more stale path(s)`);

  return [
    '[SESSION RESUME FILE VALIDATION]',
    `Journal hash validation found ${validation.staleFiles.length} previously observed file(s) whose current state cannot be trusted.`,
    'Prior tool results and reasoning based on these paths are stale. Re-read each relevant file before relying on it or editing it.',
    ...shown,
  ].join('\n');
}
