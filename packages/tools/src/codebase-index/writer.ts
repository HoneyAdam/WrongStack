/**
 * SQLite storage layer for the codebase index.
 *
 * Uses `node:sqlite` (synchronous API — DatabaseSync class).
 * Database file: {projectRoot}/.codebase-index/index.db
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FileMeta, IndexStats, SearchResult, Symbol, SymbolKind, SymbolLang } from './schema.js';
import { SCHEMA_VERSION } from './schema.js';

const INDEX_DIR = '.codebase-index';
const DB_FILE = 'index.db';

export class IndexStore {
  private db: DatabaseSync;

  constructor(private projectRoot: string) {
    const dir = path.join(projectRoot, INDEX_DIR);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, DB_FILE));
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        file TEXT PRIMARY KEY,
        lang TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL,
        symbol_count INTEGER NOT NULL DEFAULT 0,
        last_indexed INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY,
        lang TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        col INTEGER NOT NULL,
        signature TEXT NOT NULL DEFAULT '',
        doc_comment TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        file_fk TEXT NOT NULL
      );
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_s_name ON symbols(name)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_s_kind ON symbols(kind)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_s_lang ON symbols(lang)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_s_file ON symbols(file)');

    const versionRows = this.db.prepare('SELECT value FROM metadata WHERE key = ?').all('version');
    if (!versionRows.length) {
      this.db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?)').run('version', String(SCHEMA_VERSION));
    }
  }

  // ─── Symbol CRUD ─────────────────────────────────────────────────────────────

  insertSymbols(symbols: Symbol[], nextId: number): number {
    const stmt = this.db.prepare(
      `INSERT INTO symbols(id, lang, kind, name, file, line, col, signature, doc_comment, scope, text, file_fk)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let id = nextId;
    for (const s of symbols) {
      stmt.run(
        id++,
        s.lang,
        s.kind,
        s.name,
        s.file,
        s.line,
        s.col,
        s.signature,
        s.docComment,
        s.scope,
        s.text,
        s.file,
      );
    }
    return id;
  }

  deleteSymbolsForFile(file: string): void {
    this.db.prepare('DELETE FROM symbols WHERE file_fk = ?').run(file);
  }

  deleteFile(file: string): void {
    this.db.prepare('DELETE FROM files WHERE file = ?').run(file);
  }

  // ─── File metadata ──────────────────────────────────────────────────────────

  upsertFile(meta: FileMeta): void {
    this.db.prepare(
      `INSERT INTO files(file, lang, mtime_ms, symbol_count, last_indexed)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(file) DO UPDATE SET
         lang = excluded.lang,
         mtime_ms = excluded.mtime_ms,
         symbol_count = excluded.symbol_count,
         last_indexed = excluded.last_indexed`,
    ).run(meta.file, meta.lang, meta.mtimeMs, meta.symbolCount, meta.lastIndexed);
  }

  getFileMeta(file: string): FileMeta | null {
    const rows = this.db.prepare(
      'SELECT file, lang, mtime_ms, symbol_count, last_indexed FROM files WHERE file = ?',
    ).all(file) as { file: string; lang: string; mtime_ms: number; symbol_count: number; last_indexed: number }[];
    if (!rows.length) return null;
    const r = rows[0]!;
    return { file: r.file, lang: r.lang as SymbolLang, mtimeMs: r.mtime_ms, symbolCount: r.symbol_count, lastIndexed: r.last_indexed };
  }

  getAllFileMetas(): FileMeta[] {
    return (this.db.prepare(
      'SELECT file, lang, mtime_ms, symbol_count, last_indexed FROM files',
    ).all() as { file: string; lang: string; mtime_ms: number; symbol_count: number; last_indexed: number }[]).map(
      (r) => ({ file: r.file, lang: r.lang as SymbolLang, mtimeMs: r.mtime_ms, symbolCount: r.symbol_count, lastIndexed: r.last_indexed }),
    );
  }

  // ─── Search ──────────────────────────────────────────────────────────────────

  search(
    query: string,
    filter?: { kind?: SymbolKind; lang?: SymbolLang; file?: string },
  ): SearchResult[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.kind) {
      conditions.push('kind = ?');
      values.push(filter.kind);
    }
    if (filter?.lang) {
      conditions.push('lang = ?');
      values.push(filter.lang);
    }
    if (filter?.file) {
      conditions.push('file LIKE ?');
      values.push(`%${filter.file}%`);
    }
    if (query.trim()) {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const tokenConds = tokens.map(() => 'text LIKE ?');
      conditions.push(`(${tokenConds.join(' OR ')})`);
      for (const t of tokens) values.push(`%${t}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT id, lang, kind, name, file, line, col, signature, doc_comment, text FROM symbols ${where}`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values as (string | number)[]) as {
      id: number; lang: string; kind: string; name: string; file: string;
      line: number; col: number; signature: string; doc_comment: string; text: string;
    }[];

    return rows.map((r) => ({
      id: r.id,
      lang: r.lang as SymbolLang,
      kind: r.kind as SymbolKind,
      name: r.name,
      file: r.file,
      line: r.line,
      col: r.col,
      signature: r.signature,
      docComment: r.doc_comment,
      score: 0,
      snippet: '',
    }));
  }

  getAllIndexable(): Array<{ id: number; text: string }> {
    return (this.db.prepare('SELECT id, text FROM symbols').all() as { id: number; text: string }[]).map(
      ({ id, text }) => ({ id, text }),
    );
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  getStats(): IndexStats {
    const sizeBytes = this.sizeBytes();

    const lastRows = this.db.prepare(
      "SELECT value FROM metadata WHERE key = 'last_indexed'",
    ).all() as { value: string }[];
    const lastIndexed = lastRows.length ? Number(lastRows[0]!.value) : null;

    const totalRows = this.db.prepare('SELECT COUNT(*) FROM symbols').all() as { 'COUNT(*)': number }[];
    const totalSymbols = totalRows[0] ? Number(totalRows[0]['COUNT(*)']) : 0;

    const fileRows = this.db.prepare('SELECT COUNT(*) FROM files').all() as { 'COUNT(*)': number }[];
    const totalFiles = fileRows[0] ? Number(fileRows[0]['COUNT(*)']) : 0;

    const langRows = this.db.prepare(
      'SELECT lang, COUNT(*) FROM symbols GROUP BY lang',
    ).all() as { lang: string; 'COUNT(*)': number }[];
    const byLang = {} as Record<SymbolLang, number>;
    for (const row of langRows) byLang[row.lang as SymbolLang] = Number(row['COUNT(*)']);

    const kindRows = this.db.prepare(
      'SELECT kind, COUNT(*) FROM symbols GROUP BY kind',
    ).all() as { kind: string; 'COUNT(*)': number }[];
    const byKind = {} as Record<SymbolKind, number>;
    for (const row of kindRows) byKind[row.kind as SymbolKind] = Number(row['COUNT(*)']);

    return {
      totalSymbols,
      totalFiles,
      byLang,
      byKind,
      indexPath: path.join(this.projectRoot, INDEX_DIR),
      lastIndexed,
      sizeBytes,
      version: SCHEMA_VERSION,
    };
  }

  setLastIndexed(ts: number): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO metadata(key, value) VALUES('last_indexed', ?)",
    ).run(String(ts));
  }

  clearAll(): void {
    this.db.exec('DELETE FROM symbols');
    this.db.exec('DELETE FROM files');
  }

  private sizeBytes(): number {
    const dbPath = path.join(this.projectRoot, INDEX_DIR, DB_FILE);
    try {
      return fs.statSync(dbPath).size;
    } catch {
      return 0;
    }
  }

  close(): void {
    try { this.db.close(); } catch { /* already closed */ }
  }
}