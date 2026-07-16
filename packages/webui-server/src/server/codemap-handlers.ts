/**
 * CodeMap HTTP handlers — serve the dependency graph at three drill-down
 * levels (package → file → symbol) from the codebase index SQLite store.
 *
 * Each handler opens a short-lived `IndexStore`, queries the graph, and
 * returns JSON. The graph data feeds the React Flow `CodeMap` component
 * in the WebUI.
 *
 * Endpoints:
 *   GET /api/codemap/packages                       — package-level graph
 *   GET /api/codemap/files?package=<name>           — file-level graph for one package
 *   GET /api/codemap/symbols?file=<path>            — symbol-level graph for one file
 */
import type * as http from 'node:http';
import type { CodeMapGraph } from '@wrongstack/tools';
import { packageGraphService, fileGraphService, symbolGraphService } from '@wrongstack/tools';

export interface CodemapHandlerDeps {
  projectRoot: string;
  /** Optional index directory override (tests, custom wiring). */
  indexDir?: string | undefined;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** GET /api/codemap/packages — workspace-level package dependency graph. */
export function handleCodemapPackages(
  res: http.ServerResponse,
  deps: CodemapHandlerDeps,
): void {
  try {
    const graph: CodeMapGraph = packageGraphService({
      projectRoot: deps.projectRoot,
      ...(deps.indexDir ? { indexDir: deps.indexDir } : {}),
    });
    sendJson(res, 200, graph);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 503 when the index is not yet built (node:sqlite missing or empty DB)
    sendJson(res, 503, { error: 'CodeMap index unavailable', detail: msg });
  }
}

/** GET /api/codemap/files?package=<name> — file-level graph within a package. */
export function handleCodemapFiles(
  res: http.ServerResponse,
  deps: CodemapHandlerDeps,
  pkg: string,
): void {
  if (!pkg) {
    sendJson(res, 400, { error: 'Missing "package" query parameter' });
    return;
  }
  try {
    const graph: CodeMapGraph = fileGraphService({
      projectRoot: deps.projectRoot,
      packageFilter: pkg,
      ...(deps.indexDir ? { indexDir: deps.indexDir } : {}),
    });
    sendJson(res, 200, graph);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 503, { error: 'CodeMap index unavailable', detail: msg });
  }
}

/** GET /api/codemap/symbols?file=<path> — symbol-level graph within a file. */
export function handleCodemapSymbols(
  res: http.ServerResponse,
  deps: CodemapHandlerDeps,
  file: string,
): void {
  if (!file) {
    sendJson(res, 400, { error: 'Missing "file" query parameter' });
    return;
  }
  try {
    const graph: CodeMapGraph = symbolGraphService({
      projectRoot: deps.projectRoot,
      fileFilter: file,
      ...(deps.indexDir ? { indexDir: deps.indexDir } : {}),
    });
    sendJson(res, 200, graph);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 503, { error: 'CodeMap index unavailable', detail: msg });
  }
}
