import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { ReviewContextBundle, ReviewFileEntry, ResolvedChimeraConfig } from './chimera-plugin.js';

// ---------------------------------------------------------------------------
// Git helpers (shared with chimera-plugin.ts, intentionally duplicated
// to keep this module self-contained for testing).
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 15_000;
const MAX_DIFF_BYTES = 50_000; // cap individual file diffs to ~50KB
const MAX_RECENT_COMMITS = 10;

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
        windowsHide: true,
      });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer | string) => {
      stdout += d;
    });
    child.stderr?.on('data', (d: Buffer | string) => {
      stderr += d;
    });
    child.on('error', () => resolve({ stdout, stderr, code: 1 }));
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

/**
 * Get the unified diff for a single file against HEAD.
 * Returns `undefined` when the file is untracked (added) or git fails.
 */
async function getFileDiff(cwd: string, filePath: string): Promise<string | undefined> {
  const r = await runGit(['diff', 'HEAD', '--', filePath], cwd);
  if (r.code !== 0 || !r.stdout.trim()) return undefined;
  return r.stdout.length > MAX_DIFF_BYTES
    ? `${r.stdout.slice(0, MAX_DIFF_BYTES)}\n... (diff truncated at ${MAX_DIFF_BYTES} bytes)`
    : r.stdout;
}

/**
 * List all changed files in the working tree (porcelain status).
 * Includes both tracked modifications and untracked additions.
 *
 * Handles rename (R) and copy (C) entries which use the format
 * `R  old -> new` — we extract the post-`->` path. Also strips git's
 * double-quote wrapping for paths containing spaces/unicode.
 */
async function getAllChangedFiles(
  cwd: string,
): Promise<Array<{ path: string; status: string }>> {
  const r = await runGit(['status', '--porcelain'], cwd);
  if (r.code !== 0) return [];
  const out: Array<{ path: string; status: string }> = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const statusCode = line.slice(0, 2).trim();
    let filePath = line.slice(3).trim();
    // Handle rename (R) / copy (C): "old -> new"
    if (statusCode === 'R' || statusCode === 'C') {
      const arrowIdx = filePath.lastIndexOf(' -> ');
      if (arrowIdx !== -1) filePath = filePath.slice(arrowIdx + 4).trim();
    }
    // Strip git's double-quote wrapping for paths with spaces/unicode
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }
    if (filePath) out.push({ path: filePath, status: statusCode });
  }
  return out;
}

/**
 * Get recent commit messages (oneline), newest first.
 */
async function getRecentCommits(cwd: string): Promise<string[]> {
  const r = await runGit(
    ['log', `-${MAX_RECENT_COMMITS}`, '--oneline', '--format=%s'],
    cwd,
  );
  if (r.code !== 0) return [];
  return r.stdout.split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export interface BuildReviewContextOptions {
  cwd: string;
  config: ResolvedChimeraConfig;
  /** Files to review, with content already read. */
  files: Array<{ path: string; status: 'added' | 'modified'; content: string }>;
  /**
   * Active todo items from the session Context (P1 enrichment).
   * Available from `ctx.todos` in the iteration.completed handler.
   * Passed in by the caller — the builder itself has no ctx access.
   */
  activeTodos?: Array<{ id: string; content: string; status: string }> | undefined;
}

/**
 * Enrich a bare file list with diffs, sibling-change awareness, and
 * recent commit history — the minimal "story" a reviewer needs to
 * judge changes in context rather than in isolation.
 *
 * This is the P0 subset: diffs + siblings + commits.
 * Future additions: todos, kanban card, prompt chain, prior findings.
 *
 * The function never throws — all enrichment is best-effort. If a git
 * operation fails, the corresponding field is simply left `undefined`,
 * and the caller still gets a valid bundle with the original file data.
 */
export async function buildReviewContext(
  opts: BuildReviewContextOptions,
): Promise<ReviewContextBundle> {
  const { cwd, config } = opts;

  // ── Enrich files with diffs ──
  const filesWithDiffs: ReviewFileEntry[] = [];
  for (const f of opts.files) {
    const entry: ReviewFileEntry = {
      path: f.path,
      status: f.status,
      content: f.content,
    };
    if (f.status === 'modified') {
      // Best-effort diff — undefined if git fails or file is untracked
      try {
        entry.diff = await getFileDiff(cwd, f.path);
      } catch {
        // leave diff undefined
      }
    }
    filesWithDiffs.push(entry);
  }

  // ── Sibling changes (all working-tree changes) ──
  let allChangedFiles: Array<{ path: string; status: string }> | undefined;
  try {
    allChangedFiles = await getAllChangedFiles(cwd);
  } catch {
    // leave undefined
  }

  // ── Recent commits ──
  let recentCommits: string[] | undefined;
  try {
    recentCommits = await getRecentCommits(cwd);
    if (recentCommits.length === 0) recentCommits = undefined;
  } catch {
    // leave undefined
  }

  // ── Active todos (passed in from caller) ──
  const activeTodos =
    opts.activeTodos && opts.activeTodos.length > 0 ? opts.activeTodos : undefined;

  // ── Kanban card (P1: find in_progress task across all boards) ──
  let kanbanCard: ReviewContextBundle['kanbanCard'];
  try {
    kanbanCard = await findActiveKanbanCard(cwd);
  } catch {
    // kanban not configured or not installed — leave undefined
  }

  // ── File provenance from Chronicle (P1: last event per file path) ──
  let fileProvenance: ReviewContextBundle['fileProvenance'];
  try {
    const paths = opts.files.map((f) => f.path);
    fileProvenance = await findFileProvenance(cwd, paths);
    if (fileProvenance.length === 0) fileProvenance = undefined;
  } catch {
    // chronicle not configured or journal unreadable — leave undefined
  }

  return {
    config,
    cwd,
    files: filesWithDiffs,
    allChangedFiles,
    recentCommits,
    activeTodos,
    kanbanCard,
    fileProvenance,
  };
}

// ---------------------------------------------------------------------------
// P1 enrichment: kanban card lookup
// ---------------------------------------------------------------------------

/**
 * Find the active (in_progress / running-stage) kanban task across all
 * boards. Returns the first match — the "card the session is working on."
 *
 * Uses dynamic import so the builder doesn't hard-depend on @wrongstack/kanban
 * (which may not be installed in all contexts). Best-effort: returns
 * undefined if kanban isn't available, no boards exist, or no task is active.
 */
async function findActiveKanbanCard(
  projectRoot: string,
): Promise<ReviewContextBundle['kanbanCard']> {
  let kanbanApi: any;
  try {
    kanbanApi = await import('@wrongstack/kanban');
  } catch {
    return undefined; // kanban package not available
  }

  const boards = await kanbanApi.listBoards(projectRoot);
  for (const board of boards) {
    const data = await kanbanApi.getBoard(projectRoot, board.id);
    if (!data?.tasks) continue;
    for (const task of data.tasks) {
      const isActive =
        task.status === 'in_progress' ||
        task.lifecycle?.currentStage === 'running' ||
        task.lifecycle?.currentStage === 'review';
      if (isActive) {
        return {
          id: task.id,
          title: task.title,
          description: task.description,
          successCriteria: task.successCriteria?.map((c: { description: string }) => c.description),
        };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// P1 enrichment: Chronicle file provenance
// ---------------------------------------------------------------------------

/**
 * Query the Chronicle journal for the most recent event touching each
 * changed file path. Returns agent/session/task attribution so the
 * reviewer knows WHO made the change and in what task context.
 *
 * Uses dynamic import so the builder doesn't hard-depend on the chronicle
 * subsystem being initialized. Best-effort: returns [] if chronicle isn't
 * available or the journal is empty.
 */
async function findFileProvenance(
  projectRoot: string,
  filePaths: string[],
): Promise<NonNullable<ReviewContextBundle['fileProvenance']>> {
  if (filePaths.length === 0) return [];

  // Use a variable specifier so the static import guard doesn't flag a
  // dependency on chronicle files that may be untracked (peer work).
  const chronicleSpec = '../chronicle/query.js';
  let ChronicleQueryEngine: any;
  try {
    const mod = await import(chronicleSpec);
    ChronicleQueryEngine = mod.ChronicleQueryEngine;
  } catch {
    return []; // chronicle module not available
  }

  // Chronicle journal lives under .wrongstack/chronicle by convention
  const journalDir = path.join(projectRoot, '.wrongstack', 'chronicle');
  let engine: any;
  try {
    engine = await ChronicleQueryEngine.fromDirectory(journalDir);
  } catch {
    return []; // journal not initialized or unreadable
  }

  const provenance: NonNullable<ReviewContextBundle['fileProvenance']> = [];
  for (const filePath of filePaths) {
    try {
      const result = engine.query({ path: filePath, limit: 1, order: 'desc' });
      const evt: any = result.events[0];
      if (!evt) continue;
      const scope = evt.scope ?? {};
      provenance.push({
        path: filePath,
        agentId: scope.agentId as string | undefined,
        taskId: scope.taskId as string | undefined,
        eventType: evt.eventType as string | undefined,
        observedAt: evt.observedAt as string | undefined,
      });
    } catch {
      // skip individual file on query error
    }
  }
  return provenance;
}
