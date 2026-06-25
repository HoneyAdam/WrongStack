// SDD run lifecycle — post-run, disk-level operations.
//
// While a run is live, the in-process `SddRunControl` (registered in
// `SddRunRegistry`) owns stop / cleanup / rollback. Once a run finishes the
// registry is cleared and its `WorktreeManager` is gone, so these helpers
// re-derive everything from disk: a fresh `WorktreeManager` for git surgery and
// the persisted board snapshot for the run's base branch + merged commits.
//
// Used by the CLI/WebUI when there is no active run (e.g. `/sdd rollback` after
// the run already settled, or `/sdd destroy` to wipe the project).

import * as fsp from 'node:fs/promises';
import { WorktreeManager } from '../worktree/worktree-manager.js';
import { SddBoardStore } from './sdd-board-store.js';

/** Force-remove every git worktree + branch a previous run left behind. */
export async function cleanupSddWorktrees(projectRoot: string): Promise<{ removed: number }> {
  const wt = new WorktreeManager({ projectRoot });
  return wt.cleanupAllManaged();
}

export interface RollbackFromDiskOptions {
  projectRoot: string;
  /** Directory holding persisted board snapshots (`wpaths.projectSddBoards`). */
  boardsDir: string;
  /** Specific run to roll back. Omit → the most recently updated board. */
  runId?: string | undefined;
}

/**
 * Roll back a finished run's merged commits by reading its persisted board
 * snapshot (base branch + commit SHAs) and reverting each. History-preserving;
 * refuses on a dirty tree or revert conflict (surfaced in `reason`). Returns
 * `ok:false` with a reason when there is no board, no base branch, or nothing to
 * revert.
 */
export async function rollbackSddRunFromDisk(
  opts: RollbackFromDiskOptions,
): Promise<{ ok: boolean; reverted: number; reason?: string }> {
  const store = new SddBoardStore({ baseDir: opts.boardsDir });
  const runId = opts.runId ?? (await store.list())[0]?.runId;
  if (!runId) return { ok: false, reverted: 0, reason: 'no SDD board found to roll back' };

  const snap = await store.load(runId);
  if (!snap) return { ok: false, reverted: 0, reason: `board "${runId}" not found` };
  if (!snap.baseBranch) {
    return { ok: false, reverted: 0, reason: 'this run did not record a base branch (no worktree run)' };
  }
  const shas = (snap.mergedCommits ?? []).map((c) => c.sha);
  if (shas.length === 0) {
    return { ok: false, reverted: 0, reason: 'no merged commits recorded for this run' };
  }

  const wt = new WorktreeManager({ projectRoot: opts.projectRoot });
  return wt.revertCommits(snap.baseBranch, shas);
}

export interface DestroySddProjectOptions {
  projectRoot: string;
  /** Resolved wstack paths to delete. */
  paths: {
    projectSpecs: string;
    projectTaskGraphs: string;
    projectSddSession: string;
    projectSddBoards: string;
  };
}

export interface DestroySddProjectResult {
  worktreesRemoved: number;
  /** Human labels of the artifacts that were deleted. */
  deleted: string[];
}

/**
 * Destroy an SDD project: clean every worktree + branch, then delete the on-disk
 * artifacts (specs, task-graphs, session, boards). Does NOT roll back git commits
 * — that is the separate, explicit `rollbackSddRunFromDisk`. Best-effort: a
 * missing path is simply skipped. The caller is responsible for stopping any
 * active run first.
 */
export async function destroySddProject(
  opts: DestroySddProjectOptions,
): Promise<DestroySddProjectResult> {
  const { removed } = await cleanupSddWorktrees(opts.projectRoot).catch(() => ({ removed: 0 }));
  const deleted: string[] = [];

  const rmDir = async (dir: string, label: string) => {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
      deleted.push(label);
    } catch {
      // already gone
    }
  };
  const rmFile = async (file: string, label: string) => {
    try {
      await fsp.unlink(file);
      deleted.push(label);
    } catch {
      // already gone
    }
  };

  await rmFile(opts.paths.projectSddSession, 'session');
  await rmDir(opts.paths.projectSpecs, 'specs');
  await rmDir(opts.paths.projectTaskGraphs, 'task-graphs');
  await rmDir(opts.paths.projectSddBoards, 'boards');

  return { worktreesRemoved: removed, deleted };
}
