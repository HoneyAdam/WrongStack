/**
 * Main indexing orchestrator.
 *
 * Given a project root and a list of files:
 * 1. Parse each file with the appropriate parser (TS for now)
 * 2. Delete old symbols for changed/deleted files
 * 3. Insert new symbols
 * 4. Update file metadata
 * 5. Return index statistics
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent, Stats } from 'node:fs';
import type { Context } from '@wrongstack/core';
import { compileGlob } from '@wrongstack/core';
import type { FileMeta, IndexResult, Symbol } from './schema.js';
import { IndexStore } from './writer.js';
import { parseSymbols, detectLang } from './ts-parser.js';

const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '.turbo', '__snapshots__', '.nyc_output',
];

interface IndexerOptions {
  projectRoot: string;
  files?: string[];
  force?: boolean;
  langs?: string[];
  ignore?: string[];
}

async function findSourceFiles(
  projectRoot: string,
  ignore: string[],
): Promise<string[]> {
  const results: string[] = [];
  const ignoreSet = new Set([...DEFAULT_IGNORE, ...ignore]);
  // compileGlob does not support brace expansion — use one pattern per extension
  const globs = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'].map(compileGlob);

  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (ignoreSet.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        // Normalize to forward-slash relative path for pattern matching
        const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
        const ext = path.extname(e.name);
        if (
          ext === '.ts' ? globs[0]!.test(rel) || globs[0]!.test(e.name) :
          ext === '.tsx' ? globs[1]!.test(rel) || globs[1]!.test(e.name) :
          ext === '.js' ? globs[2]!.test(rel) || globs[2]!.test(e.name) :
          ext === '.jsx' ? globs[3]!.test(rel) || globs[3]!.test(e.name) : false
        ) {
          results.push(full);
        }
      }
    }
  };

  await walk(projectRoot);
  return results;
}

/** Run a full or incremental index and return statistics. */
export async function runIndexer(
  ctx: Context,
  opts: IndexerOptions,
): Promise<IndexResult> {
  const { projectRoot, force = false, langs, ignore = [] } = opts;

  const store = new IndexStore(projectRoot);
  const startMs = Date.now();
  const errors: string[] = [];
  const langStats: Record<string, number> = {};
  let filesIndexed = 0;
  let symbolsIndexed = 0;

  let files: string[];
  if (opts.files && opts.files.length > 0) {
    files = opts.files.map((f) => path.resolve(projectRoot, f));
  } else {
    files = await findSourceFiles(projectRoot, ignore);
  }

  if (langs && langs.length > 0) {
    const langSet = new Set(langs);
    files = files.filter((f) => {
      const lang = detectLang(f);
      return lang ? langSet.has(lang) : false;
    });
  }

  if (force) store.clearAll();

  // Collect existing file metadata for incremental check
  const existingMeta: Map<string, FileMeta> = new Map();
  if (!force) {
    for (const meta of store.getAllFileMetas()) existingMeta.set(meta.file, meta);
  }

  for (const file of files) {
    let stat: Stats;
    try {
      stat = await fs.stat(file);
    } catch {
      store.deleteFile(file);
      continue;
    }
    if (!stat.isFile()) continue;

    const lang = detectLang(file);
    if (!lang) continue;

    const meta = existingMeta.get(file);
    if (!force && meta && meta.mtimeMs === Math.floor(stat.mtimeMs)) {
      langStats[lang] = (langStats[lang] ?? 0) + meta.symbolCount;
      symbolsIndexed += meta.symbolCount;
      filesIndexed++;
      continue;
    }

    store.deleteSymbolsForFile(file);

    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch (e) {
      errors.push(`read error: ${file}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    let parsed: ReturnType<typeof parseSymbols>;
    try {
      parsed = parseSymbols({ file, content, lang });
    } catch (e) {
      errors.push(`parse error: ${file}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    if (parsed.symbols.length === 0) {
      store.upsertFile({
        file,
        lang,
        mtimeMs: Math.floor(stat.mtimeMs),
        symbolCount: 0,
        lastIndexed: Date.now(),
      });
      filesIndexed++;
      continue;
    }

    const nextId = store.getStats().totalSymbols + 1;
    const symbolsWithIds: Symbol[] = parsed.symbols.map((s, i) => ({ ...s, id: nextId + i }));
    const inserted = store.insertSymbols(symbolsWithIds, nextId);
    const count = inserted - nextId;
    symbolsIndexed += count;
    langStats[lang] = (langStats[lang] ?? 0) + count;

    store.upsertFile({
      file,
      lang,
      mtimeMs: Math.floor(stat.mtimeMs),
      symbolCount: count,
      lastIndexed: Date.now(),
    });

    filesIndexed++;
  }

  // Remove stale entries for files deleted since last run
  for (const [file_] of existingMeta) {
    try {
      await fs.stat(file_);
    } catch {
      store.deleteFile(file_);
    }
  }

  const durationMs = Date.now() - startMs;
  store.setLastIndexed(Date.now());
  store.close();

  return {
    filesIndexed,
    symbolsIndexed,
    langStats,
    durationMs,
    errors,
  };
}
