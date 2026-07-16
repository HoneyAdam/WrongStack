/**
 * TechStack HTTP handlers.
 *
 * Endpoints:
 *   GET  /api/techstack/snapshot
 *   POST /api/techstack/inventory
 *   POST /api/techstack/analyze
 *   POST /api/techstack/jobs/:id/cancel
 *
 * @see docs/specs/techstack-sdd.md §4.2
 */

import { randomUUID } from 'node:crypto';
import type * as http from 'node:http';
import type {
  Snapshot,
  TechStackEngine,
  TechStackJobKind,
  TechStackStore,
} from '@wrongstack/techstack';

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export interface TechStackHandlerDeps {
  /** Project ID used to look up the snapshot. */
  projectId: string;
  /** Server-owned project root. Never sourced from the request body. */
  projectRoot?: string | undefined;
  /** TechStack store instance. */
  store: TechStackStore;
  /** Service engine for inventory/analyze actions. */
  engine?: TechStackEngine | undefined;
  /** Publish WS-compatible events without coupling the HTTP layer to sockets. */
  emit?: ((event: TechStackEvent) => void) | undefined;
  /** Abort controllers keyed by running job id. */
  runningJobs?: Map<string, AbortController> | undefined;
}

export type TechStackEvent =
  | { type: 'techstack.job.started'; payload: { jobId: string; kind: 'inventory' | 'analyze' } }
  | {
      type: 'techstack.job.progress';
      payload: { jobId: string; phase: string; completed: number; total: number };
    }
  | { type: 'techstack.snapshot.updated'; payload: { snapshot: Snapshot; stale: false } }
  | { type: 'techstack.job.failed'; payload: { jobId: string; error: string } }
  | { type: 'techstack.job.cancelled'; payload: { jobId: string } };

/** GET /api/techstack/snapshot */
export function handleTechStackSnapshot(
  res: http.ServerResponse,
  deps: TechStackHandlerDeps,
): void {
  try {
    const snapshot = deps.store.getSnapshot(deps.projectId);
    if (!snapshot) {
      sendJson(res, 404, { snapshot: null, stale: false });
      return;
    }
    const ageMs = Date.now() - new Date(snapshot.createdAt).getTime();
    sendJson(res, 200, { snapshot, stale: ageMs > 24 * 60 * 60 * 1000 });
  } catch (error) {
    sendJson(res, 500, {
      error: 'TechStack store unavailable',
      detail: errorMessage(error),
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireJobDeps(
  res: http.ServerResponse,
  deps: TechStackHandlerDeps,
): deps is TechStackHandlerDeps & { projectRoot: string; engine: TechStackEngine } {
  if (!deps.projectRoot || !deps.engine) {
    sendJson(res, 503, { error: 'TechStack engine unavailable' });
    return false;
  }
  return true;
}

function startJob(
  res: http.ServerResponse,
  deps: TechStackHandlerDeps,
  kind: TechStackJobKind,
): void {
  if (!requireJobDeps(res, deps)) return;

  const jobId = randomUUID();
  const controller = new AbortController();
  deps.runningJobs?.set(jobId, controller);
  deps.emit?.({ type: 'techstack.job.started', payload: { jobId, kind } });
  sendJson(res, 202, { jobId, kind, status: 'queued' });

  void deps.engine
    .analyze(deps.projectId, {
      targetRoot: deps.projectRoot,
      requestedBy: 'webui',
      online: kind === 'analyze',
      jobId,
      signal: controller.signal,
      onProgress: (phase, completed, total) => {
        deps.emit?.({
          type: 'techstack.job.progress',
          payload: { jobId, phase, completed, total },
        });
      },
    })
    .then(({ snapshot }) => {
      if (controller.signal.aborted) return;
      deps.emit?.({
        type: 'techstack.snapshot.updated',
        payload: { snapshot, stale: false },
      });
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        deps.emit?.({ type: 'techstack.job.cancelled', payload: { jobId } });
        return;
      }
      deps.emit?.({
        type: 'techstack.job.failed',
        payload: { jobId, error: errorMessage(error) },
      });
    })
    .finally(() => {
      deps.runningJobs?.delete(jobId);
    });
}

/** POST /api/techstack/inventory */
export function handleTechStackInventory(
  res: http.ServerResponse,
  deps: TechStackHandlerDeps,
): void {
  startJob(res, deps, 'inventory');
}

/** POST /api/techstack/analyze */
export function handleTechStackAnalyze(
  res: http.ServerResponse,
  deps: TechStackHandlerDeps,
): void {
  startJob(res, deps, 'analyze');
}

/** POST /api/techstack/jobs/:id/cancel — idempotent. */
export function handleTechStackCancel(
  res: http.ServerResponse,
  deps: TechStackHandlerDeps,
  jobId: string,
): void {
  const controller = deps.runningJobs?.get(jobId);
  if (controller && !controller.signal.aborted) controller.abort();
  deps.store.updateJobStatus(jobId, 'cancelled');
  deps.emit?.({ type: 'techstack.job.cancelled', payload: { jobId } });
  sendJson(res, 200, { jobId, status: 'cancelled' });
}

/** GET /api/techstack/jobs/:id */
export function handleTechStackJobStatus(
  res: http.ServerResponse,
  deps: TechStackHandlerDeps,
  jobId: string,
): void {
  const job = deps.store.getJob(jobId);
  if (!job) {
    sendJson(res, 404, { error: 'Job not found' });
    return;
  }
  sendJson(res, 200, { job });
}

/** GET /api/techstack/reports/:id?format=md|json */
export function handleTechStackReport(
  res: http.ServerResponse,
  deps: TechStackHandlerDeps,
  reportId: string,
  format: 'md' | 'json',
): void {
  const snapshot = deps.store.getSnapshotById(reportId);
  if (!snapshot) {
    sendJson(res, 404, { error: 'Report not found' });
    return;
  }
  if (deps.engine) {
    const report = deps.engine.generateReport(snapshot, format);
    res.writeHead(200, {
      'Content-Type': format === 'json' ? 'application/json' : 'text/markdown',
      'Content-Disposition': `attachment; filename="techstack-report.${format}"`,
    });
    res.end(report);
  } else {
    // No engine — fall back to raw JSON snapshot
    sendJson(res, 200, snapshot);
  }
}
