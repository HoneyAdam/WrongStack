// Indexing question — walks the project to count indexable files and asks
// whether to run startup codebase indexing. Only asked when the config has
// an `indexing` block and the codebase is large enough to be slow.

import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { color } from '@wrongstack/core/utils';
import type { ReadlineInputReader } from '../input-reader.js';
import type { TerminalRenderer } from '../renderer.js';

/**
 * File extensions the codebase indexer can parse. Matches `extToLang` in
 * `packages/tools/src/codebase-index/ts-parser.ts`.
 */
const INDEXABLE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.go',
  '.py',
  '.rs',
  '.json',
  '.yaml',
  '.yml',
]);

/**
 * Directories that should never be descended into when counting files.
 * Mirrors `DEFAULT_IGNORE` in the indexer.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '__snapshots__',
  '.nyc_output',
]);

/** Minimum number of indexable files before we consider asking about indexing. */
const DEFAULT_INDEX_QUESTION_THRESHOLD = 500;

/**
 * Resolve the indexing question threshold from the env var
 * `WRONGSTACK_INDEX_QUESTION_THRESHOLD`. Falls back to 500 when unset or invalid.
 *
 * Exported for testing only — callers should use {@link maybeAskAboutIndexing}.
 */
export function resolveIndexThreshold(): number {
  const raw = process.env['WRONGSTACK_INDEX_QUESTION_THRESHOLD'];
  if (raw === undefined || raw === '') return DEFAULT_INDEX_QUESTION_THRESHOLD;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_INDEX_QUESTION_THRESHOLD;
}

/**
 * Count indexable source files in the project. Stops early once the
 * threshold is reached — large codebases don't need a precise count.
 */
async function countProjectFiles(projectRoot: string, threshold: number): Promise<number> {
  let count = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission errors, missing dirs — skip
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (count >= threshold) return; // early exit
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        if (INDEXABLE_EXTS.has(path.extname(e.name))) {
          count++;
        }
      }
    }
  };
  await walk(projectRoot);
  return count;
}

/**
 * When the project has many indexable files, ask the user whether to run
 * startup codebase indexing now. Large codebases can take a while to index
 * on first launch — this lets the user skip it for the current session.
 *
 * The answer is **not persisted** — it affects only this session.
 *
 * @returns `true` (yes, index), `false` (skip), or `undefined` when
 *   no question was asked (codebase is small enough or indexing isn't
 *   configured).
 */
export async function maybeAskAboutIndexing(opts: {
  projectRoot: string;
  renderer: TerminalRenderer;
  reader: ReadlineInputReader;
  /** Only ask when the config has an `indexing` block (non-bare mode). */
  indexingConfigured: boolean;
}): Promise<boolean | undefined> {
  const { projectRoot, renderer, reader, indexingConfigured } = opts;

  // In bare mode there's no indexing block — the question is meaningless.
  if (!indexingConfigured) return undefined;

  const threshold = resolveIndexThreshold();
  const fileCount = await countProjectFiles(projectRoot, threshold);

  // Small / medium codebases — indexing is fast enough, don't bother the user.
  if (fileCount < threshold) return undefined;

  renderer.write(
    `\n  ${color.dim('○')} Large codebase detected ${color.dim(`(~${fileCount}+ indexable files)`)}\n`,
  );
  renderer.write(
    `  ${color.amber('⚠')} ${color.dim('Codebase search requires indexing — skipped by default.')}\n`,
  );

  const answer = (
    await reader.readLine(
      `  ${color.amber('?')} Run codebase indexing now? ${color.dim('[n/Y/q]')} ${color.dim('(auto n in 5s)')} `,
      { timeoutMs: 5000, defaultAnswer: 'n' },
    )
  )
    .trim()
    .toLowerCase();

  // 'q' means skip indexing (not abort launch — we're past the project check).
  if (answer === 'q') {
    renderer.write(color.dim('  Skipping indexing for this session.\n'));
    return false;
  }

  // Default on timeout or explicit 'n': skip.
  if (answer === 'n' || answer === 'no' || answer === '') {
    renderer.write(color.dim('  Skipping indexing for this session.\n'));
    return false;
  }

  // 'y' or 'yes' means yes.
  return true;
}