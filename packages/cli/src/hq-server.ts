/**
 * HQ server — the read-only command-center backend for `wstack --hq`.
 *
 * Single HTTP server, single port. Two WebSocket upgrade paths:
 *   /ws/client  — TUI/REPL/WebUI clients publish telemetry
 *   /ws/browser — HQ browser connects and receives snapshot + events
 *
 * Phase 1 is read-only: the HQ browser observes what clients publish. No
 * control commands are sent to clients from the browser yet.
 *
 * Mailbox aggregation: every `mailbox.snapshot` envelope from a client is
 * stored per-(client, mailbox) and merged into the global HqSnapshot on
 * each browser poll / broadcast. Mailbox events still flow through as
 * transient events; snapshots give us the authoritative rollups.
 *
 * @module hq-server
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { Server as HttpServer } from 'node:http';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_HQ_REDACTION_POLICY,
  HQ_PROTOCOL_VERSION,
  type EnsureHqFirstRunAuthResult,
  type HqBrowserMessage,
  type HqClientCapability,
  type HqClientRecord,
  type HqEventEnvelope,
  type HqMachineRecord,
  type HqMailboxEventPayload,
  type HqMailboxSnapshotPayload,
  type HqMailboxSummary,
  type HqProjectIdentity,
  type HqProjectRecord,
  type HqRedactionPolicy,
  type HqSessionEndedPayload,
  type HqSessionSnapshotPayload,
  type HqSnapshot,
  type HqTranscriptAppendPayload,
  type HqTranscriptEntry,
  type HqWelcomePayload,
  buildTranscriptFromEvents,
  ensureHqFirstRunAuthFile,
  parseHqEventPayload,
  parseHqFrame,
  resolveHqDataDir,
  scrubAndTruncateHqPreview,
  watchHqAuthFile,
} from '@wrongstack/core';
// Inlined from @wrongstack/webui/server — avoids a hard dependency on the webui package.
import { WebSocket, WebSocketServer } from 'ws';
import { HQ_HTML } from './hq-dashboard-html.js';

export interface HqServerOptions {
  host?: string;
  port?: number;
  strictPort?: boolean;
  /**
   * When true, the server binds exactly to `port` and fails with an error
   * if that port is already in use — no port scanning. Use this when the
   * user explicitly selected a port and we should not silently pick another.
   */
  exactPort?: boolean;
  /**
   * HQ data directory. When omitted, the server resolves one via
   * `resolveHqDataDir()` (honoring `WRONGSTACK_HQ_DATA_DIR` then falling
   * back to `~/.wrongstack/hq`). The directory holds `auth.json` and, in
   * later phases, the persistent event log and snapshot cache.
   */
  dataDir?: string;
}

export interface HqStartupConnectionInfo {
  dataDir: string;
  browserUrl: string;
  clientUrl: string;
  clientEnv: {
    WRONGSTACK_HQ_URL: string;
    WRONGSTACK_HQ_TOKEN?: string;
  };
  createdAuth: boolean;
}

export type HqFirstRunSetup = HqStartupConnectionInfo;

export interface HqServerHandle {
  host: string;
  port: number;
  firstRunSetup?: HqFirstRunSetup;
  close(): Promise<void>;
}

interface ConnectedClient {
  ws: WebSocket;
  clientId: string;
  projectId: string;
  project: HqProjectIdentity;
  kind: string;
  connectedAt: string;
  lastSeenAt: string;
  hostname?: string;
  pid?: number;
  version?: string;
  capabilities: readonly string[];
  /**
   * Latest mailbox snapshot keyed by mailboxId — replaces (not merges) on
   * each new `mailbox.snapshot` envelope from this client.
   */
  mailboxes: Map<string, HqMailboxSnapshotPayload>;
  machineId?: string;
  /**
   * Latest live session/terminal snapshot keyed by sessionId — replaced on
   * each `session.snapshot` envelope and removed on `session.ended`.
   */
  sessions: Map<string, HqSessionSnapshotPayload>;
}

/**
 * Per-session transcript ring buffer (most-recent-capped). Fed by
 * `session.transcript` envelopes from remote clients so the HQ browser can
 * render a remote terminal's full chat history even though HQ can't read that
 * machine's on-disk JSONL. Local sessions are served from disk instead.
 */
const TRANSCRIPT_RING_MAX = 4000;
/** Bound how many distinct sessions/subagents we keep transcripts for, so a
 * long-lived HQ doesn't accumulate rings for every session that ever connected.
 * Eviction is least-recently-active (the maps are kept in LRU order). */
const MAX_TRANSCRIPT_SESSIONS = 400;
const MAX_AGENT_RINGS = 800;

/** Evict least-recently-active entries until the map is within `max`. The maps
 * are maintained in LRU order (callers re-insert on each write). */
function evictOldest(map: Map<string, unknown>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

interface TranscriptRing {
  entries: HqTranscriptEntry[];
  /** machineId of the publishing client, so the server can tell local from remote. */
  machineId?: string;
}

/** Map a raw `agent.message` payload to a transcript entry for the subagent ring. */
function agentMessageToEntry(p: Record<string, unknown>): HqTranscriptEntry {
  const kind = typeof p['kind'] === 'string' ? p['kind'] : 'text';
  const role: HqTranscriptEntry['role'] =
    kind === 'tool_use' || kind === 'tool_result'
      ? 'tool'
      : kind === 'error'
        ? 'error'
        : kind === 'status'
          ? 'system'
          : 'assistant';
  return {
    ts: typeof p['ts'] === 'string' ? p['ts'] : new Date().toISOString(),
    role,
    text: typeof p['content'] === 'string' ? p['content'] : '',
    ...(typeof p['toolName'] === 'string' ? { tool: p['toolName'] } : {}),
  };
}

const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3499;
const MAX_EVENT_LOG = 5000;
const MAX_NON_STRICT_PORT_SCAN = 50;

/**
 * Stale client cleanup: clients that have not sent a message within this
 * window are considered dead and their sockets are terminated.  This handles
 * crash / network-drop disconnects where the WebSocket close event never
 * fires from the remote side.
 */
const CLIENT_TTL_MS = 60_000; // 60 s
const CLIENT_CLEANUP_INTERVAL_MS = 30_000; // every 30 s

function displayHost(host: string): string {
  return host === '0.0.0.0' ? '127.0.0.1' : host;
}

function buildHttpUrl(host: string, port: number, token?: string): string {
  const url = new URL(`http://${displayHost(host)}:${port}/`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

function buildClientWsUrl(host: string, port: number, token?: string): string {
  const url = new URL(`ws://${displayHost(host)}:${port}/ws/client`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

interface HqRuntimeMarker {
  url?: string;
  pid?: number;
  updatedAt?: string;
}

function hqRuntimeMarkerPath(dataDir: string): string {
  return path.join(dataDir, 'runtime.json');
}

async function writeHqRuntimeMarker(dataDir: string, url: string): Promise<void> {
  const file = hqRuntimeMarkerPath(dataDir);
  const payload = JSON.stringify({ url, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${payload}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function clearHqRuntimeMarker(dataDir: string, url: string): Promise<void> {
  const file = hqRuntimeMarkerPath(dataDir);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as HqRuntimeMarker;
    if (parsed.url === url && parsed.pid === process.pid) await fs.rm(file, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

/** Non-internal IPv4 addresses, so we can print URLs reachable from other machines. */
function lanIPv4Addresses(): string[] {
  const out: string[] = [];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] ?? []) {
        if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
      }
    }
  } catch {
    // best-effort
  }
  return out;
}

function browserTokenFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).searchParams.get('token') ?? undefined;
  } catch {
    return undefined;
  }
}

function writeHqStartupInfo(write: (line: string) => void, handle: HqServerHandle): void {
  const startup = handle.firstRunSetup;
  write(`WrongStack HQ listening on http://${handle.host}:${handle.port}\n`);
  if (!startup) {
    write(`Browser endpoint: ${buildHttpUrl(handle.host, handle.port)}\n`);
    write(`Client endpoint:  ${buildClientWsUrl(handle.host, handle.port)}\n`);
    writeHqLanEndpoints(write, handle, undefined);
    return;
  }

  write(`Browser endpoint: ${startup.browserUrl}\n`);
  write(`Client endpoint:  ${startup.clientUrl}\n`);
  if (startup.createdAuth) {
    write(`\nFirst-run HQ auth created in ${startup.dataDir}\n`);
  } else {
    write(`\nHQ auth loaded from ${startup.dataDir}\n`);
  }
  write(`Start clients with:\n`);
  write(`  WRONGSTACK_HQ_URL=${startup.clientEnv.WRONGSTACK_HQ_URL}\n`);
  if (startup.clientEnv.WRONGSTACK_HQ_TOKEN) {
    write(`  WRONGSTACK_HQ_TOKEN=${startup.clientEnv.WRONGSTACK_HQ_TOKEN}\n`);
  }
  writeHqLanEndpoints(write, handle, browserTokenFromUrl(startup.browserUrl));
}

/** When bound to all interfaces, print LAN URLs so other machines can reach HQ. */
function writeHqLanEndpoints(
  write: (line: string) => void,
  handle: HqServerHandle,
  browserToken: string | undefined,
): void {
  if (handle.host !== '0.0.0.0' && handle.host !== '::') return;
  const ips = lanIPv4Addresses();
  if (ips.length === 0) return;
  write(`\nReachable from other machines on your network:\n`);
  for (const ip of ips) {
    write(`  ${buildHttpUrl(ip, handle.port, browserToken)}\n`);
  }
  write(`  On another machine, set WRONGSTACK_HQ_URL=http://${ips[0]}:${handle.port}\n`);
}

// The HQ dashboard HTML lives in its own module (a large self-contained
// React + React Flow document). Import it for local use by the `/` route and
// re-export it so existing importers keep working unchanged.
export { HQ_HTML };

/** GET /api/sessions — list live sessions from the cross-process registry. */
async function handleApiSessions(res: http.ServerResponse): Promise<void> {
  const { SessionRegistry } = await import('@wrongstack/core');
  const globalRoot = path.dirname(resolveHqDataDir());
  try {
    const registry = new SessionRegistry(globalRoot);
    const sessions = await registry.list();
    const result = sessions.filter(s => s.status !== 'stale').map((s) => ({
      sessionId: s.sessionId,
      projectSlug: s.projectSlug,
      projectName: s.projectName,
      projectRoot: s.projectRoot,
      workingDir: s.workingDir,
      status: s.status,
      pid: s.pid,
      startedAt: s.startedAt,
      lastHeartbeatAt: s.lastHeartbeatAt,
      agentCount: s.agentCount,
      agents: s.agents.map((a) => ({
        id: a.id, name: a.name, status: a.status,
        currentTool: a.currentTool, iterations: a.iterations,
        toolCalls: a.toolCalls, lastActivityAt: a.lastActivityAt,
      })),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

/** GET /api/sessions/:id/events — replay JSONL events for a session watch. */
/**
 * GET /api/sessions/:id/events — full chat history for a terminal.
 *
 * Local sessions (present in this host's registry) are replayed from disk so
 * the operator sees the complete, correlated transcript. Remote sessions are
 * served from the in-memory transcript ring fed by `session.transcript`
 * envelopes. `full` drops the tail cap and returns everything available.
 */
async function handleApiSessionEvents(
  res: http.ServerResponse,
  sessionId: string,
  limit: number,
  full: boolean,
  transcripts: Map<string, TranscriptRing>,
): Promise<void> {
  const { SessionRegistry, resolveWstackPaths, DefaultSessionStore } = await import('@wrongstack/core');
  const globalRoot = path.dirname(resolveHqDataDir());
  try {
    const registry = new SessionRegistry(globalRoot);
    const entry = await registry.get(sessionId).catch(() => null);

    let entries: HqTranscriptEntry[] = [];
    let source: 'disk' | 'stream' = 'stream';
    let status: string | undefined;
    let clientType: string | undefined;
    let projectName: string | undefined;

    if (entry) {
      // Local session — replay the full JSONL from disk.
      const paths = resolveWstackPaths({ projectRoot: entry.projectRoot, globalRoot });
      const store = new DefaultSessionStore({ dir: paths.projectSessions });
      const data = await store.load(sessionId).catch(() => null);
      if (data) {
        entries = buildTranscriptFromEvents(
          (data.events as unknown[]).map((e) => e as Record<string, unknown>),
        );
        source = 'disk';
        status = entry.status;
        clientType = entry.clientType;
        projectName = entry.projectName;
      }
    }

    if (entries.length === 0) {
      // Remote (or not-yet-on-disk) session — serve the streamed ring.
      const ring = transcripts.get(sessionId);
      if (!ring && !entry) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      entries = ring ? ring.entries : [];
      source = 'stream';
      if (entry) {
        status = entry.status;
        clientType = entry.clientType;
        projectName = entry.projectName;
      }
    }

    const total = entries.length;
    const tail = full ? entries : entries.slice(-limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        sessionId,
        source,
        ...(status !== undefined ? { status } : {}),
        ...(clientType !== undefined ? { clientType } : {}),
        ...(projectName !== undefined ? { projectName } : {}),
        total,
        entries: tail,
      }),
    );
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

export async function startHqServer(options: HqServerOptions = {}): Promise<HqServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const dataDir = resolveHqDataDir(options.dataDir);

  // First run should be usable without manual token/config setup: if
  // auth.json is missing, create browser + client tokens. Existing auth.json
  // remains operator-owned, including explicit empty-token open mode.
  const firstRunAuth = await ensureHqFirstRunAuthFile(dataDir, {
    warn: (msg: string) => console.warn(JSON.stringify({ level: 'warn', event: 'hq.auth_load_failed', message: msg, timestamp: new Date().toISOString() })),
  });
  return startHqServerWithAuth(options, host, port, dataDir, firstRunAuth);
}

/**
 * Extract a browser token from an HTTP request. Accepts:
 *   1. `?token=…` query parameter (for browser navigation / dashboard)
 *   2. `Authorization: Bearer …` header (for programmatic / curl access)
 * Returns the token string if found, otherwise `undefined`.
 */
function extractBrowserToken(req: http.IncomingMessage, url: URL): string | undefined {
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return undefined;
}

function startHqServerWithAuth(
  options: HqServerOptions,
  host: string,
  port: number,
  dataDir: string,
  firstRunAuth: EnsureHqFirstRunAuthResult,
): Promise<HqServerHandle> {
  const authFile = firstRunAuth.authFile;
  // Operator override merges over the default; publisher claims are
  // clamped against this at broadcast time (see scrubAndTruncateHqPreview
  // call sites + the welcome handshake redactionPolicy field).
  // Mutable: the file-watcher below refreshes these on auth.json change
  // (Phase 4 live reload).
  const mutableAuth: {
    operatorPolicy: HqRedactionPolicy;
    browserTokens: Set<string>;
    clientTokens: Set<string>;
  } = {
    operatorPolicy: {
      ...DEFAULT_HQ_REDACTION_POLICY,
      ...(authFile.redactionPolicy ?? {}),
    },
    browserTokens: new Set((authFile.browserTokens ?? []).map((t) => t.token)),
    clientTokens: new Set((authFile.clientTokens ?? []).map((t) => t.token)),
  };

  // Surface the resolved data directory + whether an operator override
  // is in effect. Helps the operator confirm `--data-dir` took hold.
  console.warn(JSON.stringify({
    level: 'info',
    event: 'hq.startup',
    message: 'WrongStack HQ starting',
    dataDir,
    host,
    port,
    operatorPolicyActive: authFile.redactionPolicy !== undefined,
    browserTokenMode: mutableAuth.browserTokens.size > 0,
    clientTokenMode: mutableAuth.clientTokens.size > 0,
    timestamp: new Date().toISOString(),
  }));
  void options;

  return new Promise((resolve, reject) => {
    const clients = new Map<WebSocket, ConnectedClient>();
    const browsers = new Set<WebSocket>();
    const eventLog: HqEventEnvelope[] = [];
    const transcripts = new Map<string, TranscriptRing>();
    // Per-subagent message history (keyed by subagentId), fed by agent.message
    // events so a late-connecting browser — including one on another machine —
    // can replay a subagent's full conversation, not just messages seen live.
    const agentMessages = new Map<string, HqTranscriptEntry[]>();
    const snapshotBroadcaster = createSnapshotBroadcaster(clients, browsers);

    // Stale-client cleanup: periodically evict clients that have gone silent.
    // This catches crash / network-drop disconnects where the remote never
    // sent a WebSocket close frame, so the 'close' event never fires.
    const cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - CLIENT_TTL_MS;
      for (const [ws, client] of clients.entries()) {
        if (new Date(client.lastSeenAt).getTime() < cutoff) {
          // terminate() forces the socket closed immediately without going
          // through the WS close handshake — appropriate for dead peers.
          ws.terminate();
          clients.delete(ws);
        }
      }
      if (clients.size > 0) snapshotBroadcaster.broadcast();
    }, CLIENT_CLEANUP_INTERVAL_MS);

    const httpServer: HttpServer = http.createServer(async (req, res) => {
      try {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`);

      // When browser TOKEN MODE is active, all HTTP routes require a valid
      // browser token EXCEPT static assets (/assets/, /wrongstack.svg) which
      // are public and don't need authentication. Token is accepted via
      // ?token= query param (for browser/dashboard use) or Authorization:
      // Bearer header (for programmatic / curl access).
      const isStaticAsset =
        url.pathname.startsWith('/assets/') || url.pathname === '/wrongstack.svg';
      if (mutableAuth.browserTokens.size > 0 && !isStaticAsset) {
        const supplied = extractBrowserToken(req, url);
        if (!supplied || !mutableAuth.browserTokens.has(supplied)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 'INVALID_TOKEN',
                message: 'A valid ?token= or Authorization: Bearer is required for HTTP access in browser token mode.',
              },
            }),
          );
          return;
        }
      }

      // ── HQ dashboard — always serve the dedicated HQ HTML interface ──
      // HQ is the central monitoring interface, not the WebUI. Serve the
      // inline HTML dashboard directly — it fetches /api/snapshot for
      // initial state and connects via WS for live updates.
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HQ_HTML);
        return;
      }

      // ── HQ API routes ──────────────────────────────────────────────
      if (url.pathname === '/api/snapshot') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildSnapshot(clients)));
        return;
      }

      if (url.pathname.startsWith('/api/projects/')) {
        const projectId = decodeURIComponent(url.pathname.slice('/api/projects/'.length));
        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'projectId is required' } }),
          );
          return;
        }
        const detail = buildProjectDetail(clients, projectId);
        if (!detail) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { code: 'NOT_FOUND', message: `Unknown project: ${projectId}` },
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(detail));
        return;
      }

      // ── Fleet tree (machines → projects → terminals → agents) ──────
      if (url.pathname === '/api/fleet' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildSnapshot(clients)));
        return;
      }

      // ── WrongStack session API — full chat history per terminal ────
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        await handleApiSessions(res);
        return;
      }

      const eventsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
      if (eventsMatch && req.method === 'GET') {
        const full = url.searchParams.get('full') === '1';
        const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '200', 10);
        const limit = Math.min(5000, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 200));
        await handleApiSessionEvents(res, decodeURIComponent(eventsMatch[1]!), limit, full, transcripts);
        return;
      }

      // ── Subagent message history (full conversation of one shadow agent) ──
      const agentMsgMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/messages$/);
      if (agentMsgMatch && req.method === 'GET') {
        const id = decodeURIComponent(agentMsgMatch[1]!);
        const full = url.searchParams.get('full') === '1';
        const ring = agentMessages.get(id) ?? [];
        const entries = full ? ring : ring.slice(-200);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ subagentId: id, total: ring.length, entries }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', event: 'hq.http_handler_error', message: String(err), timestamp: new Date().toISOString() }));
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    });

    const wss = new WebSocketServer({ noServer: true, maxPayload: 1 * 1024 * 1024 });

    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`);
      const pathname = url.pathname;

      if (pathname !== '/ws/client' && pathname !== '/ws/browser') {
        socket.destroy();
        return;
      }

      // Token mode: each channel checks its own allowlist. Browser and
      // client tokens are separate — a browser-only token cannot be
      // replayed on /ws/client and vice versa. OPEN MODE for a channel
      // when its token set is empty (backwards compatible).
      const tokenSet = pathname === '/ws/browser' ? mutableAuth.browserTokens : mutableAuth.clientTokens;
      if (tokenSet.size > 0) {
        const supplied = url.searchParams.get('token') ?? '';
        if (!supplied || !tokenSet.has(supplied)) {
          socket.write(
            'HTTP/1.1 401 Unauthorized\r\n' +
              'Content-Type: application/json\r\n' +
              'Connection: close\r\n' +
              '\r\n' +
              JSON.stringify({
                error: {
                  code: 'INVALID_TOKEN',
                  message: `A valid ?token= is required for ${pathname} connections in token mode.`,
                },
              }),
          );
          socket.destroy();
          return;
        }
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, pathname);
      });
    });

    wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, pathname: string) => {
      if (pathname === '/ws/browser') {
        handleBrowser(ws, snapshotBroadcaster, browsers);
      } else {
        handleClient(ws, clients, browsers, eventLog, mutableAuth.operatorPolicy, snapshotBroadcaster, transcripts, agentMessages);
      }
    });

    // Phase 4 — live reload of auth.json. The watcher re-reads the file on
    // change and atomically swaps the in-memory token sets + operator policy.
    // No active connections are dropped; subsequent upgrades and broadcasts
    // see the new state immediately.
    const authWatcher = watchHqAuthFile(
      dataDir,
      (next) => {
        mutableAuth.operatorPolicy = {
          ...DEFAULT_HQ_REDACTION_POLICY,
          ...(next.redactionPolicy ?? {}),
        };
        mutableAuth.browserTokens = new Set((next.browserTokens ?? []).map((t) => t.token));
        mutableAuth.clientTokens = new Set((next.clientTokens ?? []).map((t) => t.token));
        console.warn(JSON.stringify({
          level: 'info',
          event: 'hq.auth.reloaded',
          message: 'HQ auth.json reloaded',
          browserTokenCount: mutableAuth.browserTokens.size,
          clientTokenCount: mutableAuth.clientTokens.size,
          timestamp: new Date().toISOString(),
        }));
      },
      {
        warn: (msg) => console.warn(JSON.stringify({
          level: 'warn',
          event: 'hq.auth.reload_failed',
          message: msg,
          timestamp: new Date().toISOString(),
        })),
      },
    );

    let bindAttempts = 0;
    const listen = (nextPort: number): void => {
      httpServer.listen(nextPort, host);
    };
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && !options.strictPort && !options.exactPort && bindAttempts < MAX_NON_STRICT_PORT_SCAN) {
        bindAttempts += 1;
        listen(port + bindAttempts);
      } else {
        authWatcher.close();
        snapshotBroadcaster.close();
        wss.close();
        reject(err);
      }
    };

    httpServer.on('error', onError);
    listen(port);
    httpServer.once('listening', () => {
      void (async () => {
        httpServer.removeListener('error', onError);
        const addr = httpServer.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;

        const browserToken = firstRunAuth.browserToken?.token ?? authFile.browserTokens?.find((t) => t.token.trim().length > 0)?.token;
        const clientToken = firstRunAuth.clientToken?.token ?? authFile.clientTokens?.find((t) => t.token.trim().length > 0)?.token;
        const hqUrl = `http://${displayHost(host)}:${actualPort}`;
        await writeHqRuntimeMarker(dataDir, hqUrl).catch(() => {
          // Best-effort discovery marker; startup output remains authoritative.
        });
        const startupInfo: HqStartupConnectionInfo = {
          dataDir,
          browserUrl: buildHttpUrl(host, actualPort, browserToken),
          clientUrl: buildClientWsUrl(host, actualPort, clientToken),
          clientEnv: {
            WRONGSTACK_HQ_URL: hqUrl,
            ...(clientToken ? { WRONGSTACK_HQ_TOKEN: clientToken } : {}),
          },
          createdAuth: firstRunAuth.created,
        };
        let closed = false;
        const handle: HqServerHandle = {
          host,
          port: actualPort,
          firstRunSetup: startupInfo,
          close: () =>
            new Promise<void>((res) => {
              if (closed) {
                res();
                return;
              }
              closed = true;
              clearInterval(cleanupTimer);
              authWatcher.close();
              snapshotBroadcaster.close();
              for (const ws of browsers) ws.close(1001, 'HQ shutting down');
              for (const ws of clients.keys()) ws.close(1001, 'HQ shutting down');
              wss.close();
              httpServer.close(() => {
                void clearHqRuntimeMarker(dataDir, hqUrl).finally(() => res());
              });
            }),
        };
        writeHqStartupInfo((line) => console.log(line.trimEnd()), handle);
        resolve(handle);
      })();
    });
  });
}

function handleBrowser(
  ws: WebSocket,
  snapshotBroadcaster: HqSnapshotBroadcaster,
  browsers: Set<WebSocket>,
): void {
  browsers.add(ws);

  ws.send(snapshotBroadcaster.currentSerialized());

  ws.on('close', () => {
    browsers.delete(ws);
  });
}

function handleClient(
  ws: WebSocket,
  clients: Map<WebSocket, ConnectedClient>,
  browsers: Set<WebSocket>,
  eventLog: HqEventEnvelope[],
  operatorPolicy: HqRedactionPolicy,
  snapshotBroadcaster: HqSnapshotBroadcaster,
  transcripts: Map<string, TranscriptRing>,
  agentMessages: Map<string, HqTranscriptEntry[]>,
): void {
  let registered = false;

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const raw =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data
          : new TextDecoder().decode(data as ArrayBuffer);
    const parsed = parseHqFrame(raw);
    if (!parsed.ok) {
      // RFC 6455 §7.4.1: 1003 = invalid payload (not processable),
      // 1008 = policy violation (unknown type or malformed shape).
      const code = parsed.reason === 'invalid-json' ? 1003 : 1008;
      ws.close(code, `invalid frame: ${parsed.reason}`);
      return;
    }
    const frame = parsed.frame;

    if (frame.type === 'client.hello') {
      const payload = frame.payload;
      if (payload.protocolVersion !== HQ_PROTOCOL_VERSION) {
        ws.close(1008, 'protocol version mismatch');
        return;
      }

      const client: ConnectedClient = {
        ws,
        clientId: payload.client.clientId,
        projectId: payload.project.projectId,
        project: payload.project,
        kind: payload.client.kind,
        connectedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        ...(payload.client.hostname ? { hostname: payload.client.hostname } : {}),
        ...(payload.client.pid ? { pid: payload.client.pid } : {}),
        ...(payload.client.version ? { version: payload.client.version } : {}),
        capabilities: payload.capabilities,
        mailboxes: new Map(),
        machineId: payload.client.machineId || payload.project.machineId,
        sessions: new Map(),
      };
      clients.set(ws, client);
      registered = true;

      // Phase 1 server-to-client acknowledgement: the client learns which
      // capabilities the server accepted and the active redaction policy.
      // Phase 2 will also use this socket to push `HqServerCommandBatchMessage`
      // frames via `client.command_poll`, but for now the welcome is a
      // one-shot handshake reply with no command queue attached.
      const welcome: HqWelcomePayload = {
        type: 'hq.welcome',
        protocolVersion: HQ_PROTOCOL_VERSION,
        serverTime: new Date().toISOString(),
        acceptedCapabilities: payload.capabilities,
        // The operator-configured override (from <dataDir>/auth.json) wins
        // over the default. The client learns the *effective* policy.
        redactionPolicy: operatorPolicy,
      };
      ws.send(JSON.stringify(welcome));

      const event: HqEventEnvelope = {
        id: randomUUID(),
        type: 'client.hello',
        schemaVersion: HQ_PROTOCOL_VERSION,
        timestamp: new Date().toISOString(),
        clientId: payload.client.clientId,
        projectId: payload.project.projectId,
        seq: 0,
        payload: { client: payload.client, project: payload.project },
      };
      eventLog.push(event);
      if (eventLog.length > MAX_EVENT_LOG) eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
      snapshotBroadcaster.broadcast();
      broadcastEvent(event, browsers);
      return;
    }

    if (!registered) return;

    if (frame.type === 'client.event') {
      const event = frame.event;
      const client = clients.get(ws);
      if (client) client.lastSeenAt = new Date().toISOString();

      // Mailbox snapshots are authoritative rollups — adopt them into the
      // per-client mailbox map and re-broadcast the global snapshot so the
      // browser counters reflect the latest rollup. We validate the
      // payload via `parseHqEventPayload` so a malformed snapshot cannot
      // poison the per-client mailbox map; other event types are not
      // validated yet and pass through unchanged.
      if (event.type === 'mailbox.snapshot' && client !== undefined) {
        const payloadResult = parseHqEventPayload(event.type, event.payload);
        if (payloadResult.ok) {
          const payload = payloadResult.payload as HqMailboxSnapshotPayload;
          client.mailboxes.set(client.projectId + ':' + payload.mailboxId, payload);
          eventLog.push(event);
          if (eventLog.length > MAX_EVENT_LOG) eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
          snapshotBroadcaster.broadcast();
          broadcastEvent(event, browsers);
          return;
        }
        // Malformed mailbox.snapshot: drop without logging or broadcasting so
        // it cannot poison the per-client mailbox map.
        return;
      }

      // Mailbox events are transient — validate the payload so a malformed
      // envelope cannot leak garbage to the browser live feed, and scrub +
      // truncate the optional `summary` preview so unbounded or secret-laden
      // text is sanitized before being stored in the event log and
      // broadcast to browsers.
      if (event.type === 'mailbox.event') {
        const payloadResult = parseHqEventPayload(event.type, event.payload);
        if (!payloadResult.ok) {
          return;
        }
        const payload = payloadResult.payload as HqMailboxEventPayload;
        const sanitizedSummary = scrubAndTruncateHqPreview(payload.summary, 280);
        const sanitizedEvent =
          sanitizedSummary === undefined
            ? event
            : { ...event, payload: { ...payload, summary: sanitizedSummary } };
        eventLog.push(sanitizedEvent);
        if (eventLog.length > MAX_EVENT_LOG) eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
        broadcastEvent(sanitizedEvent, browsers);
        return;
      }

      // ── Session telemetry — the spine of the fleet tree ────────────────
      if (event.type === 'session.snapshot' && client !== undefined) {
        const result = parseHqEventPayload(event.type, event.payload);
        if (result.ok) {
          const payload = result.payload as HqSessionSnapshotPayload;
          client.sessions.set(payload.sessionId, payload);
          snapshotBroadcaster.broadcast();
        }
        return;
      }

      if (event.type === 'session.ended' && client !== undefined) {
        const result = parseHqEventPayload(event.type, event.payload);
        if (result.ok) {
          const payload = result.payload as HqSessionEndedPayload;
          client.sessions.delete(payload.sessionId);
          snapshotBroadcaster.broadcast();
        }
        return;
      }

      if (event.type === 'session.transcript' && client !== undefined) {
        const result = parseHqEventPayload(event.type, event.payload);
        if (result.ok) {
          const payload = result.payload as HqTranscriptAppendPayload;
          let ring = transcripts.get(payload.sessionId);
          if (!ring) {
            ring = { entries: [], ...(client.machineId ? { machineId: client.machineId } : {}) };
          }
          for (const entry of payload.entries) ring.entries.push(entry);
          if (ring.entries.length > TRANSCRIPT_RING_MAX) {
            ring.entries.splice(0, ring.entries.length - TRANSCRIPT_RING_MAX);
          }
          // Re-insert to keep LRU order, then bound the number of sessions kept.
          transcripts.delete(payload.sessionId);
          transcripts.set(payload.sessionId, ring);
          evictOldest(transcripts, MAX_TRANSCRIPT_SESSIONS);
          // Forward to browsers so an open history pane streams live.
          broadcastEvent(event, browsers);
        }
        return;
      }

      // Subagent conversation — buffer per subagentId so late-connecting
      // browsers (incl. on other machines) can replay the full history.
      if (event.type === 'agent.message') {
        const p = event.payload as Record<string, unknown> | undefined;
        const subId = p && typeof p['subagentId'] === 'string' ? (p['subagentId'] as string) : undefined;
        if (subId) {
          let ring = agentMessages.get(subId);
          if (!ring) ring = [];
          ring.push(agentMessageToEntry(p as Record<string, unknown>));
          if (ring.length > TRANSCRIPT_RING_MAX) ring.splice(0, ring.length - TRANSCRIPT_RING_MAX);
          agentMessages.delete(subId);
          agentMessages.set(subId, ring);
          evictOldest(agentMessages, MAX_AGENT_RINGS);
        }
        eventLog.push(event);
        if (eventLog.length > MAX_EVENT_LOG) eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
        broadcastEvent(event, browsers);
        return;
      }

      // Other event types pass through unchanged.
      eventLog.push(event);
      if (eventLog.length > MAX_EVENT_LOG) eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
      broadcastEvent(event, browsers);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    snapshotBroadcaster.broadcast();
  });
}

/**
 * Stable per-machine key. Prefers hostname so the same physical computer maps
 * to one machine even when clients report different per-process machineIds
 * (older builds hashed `hostname:pid`). Falls back to machineId.
 */
function hqMachineKey(hostname: string | undefined, machineId: string | undefined): string {
  const hn = hostname?.trim();
  return hn ? `host:${hn.toLowerCase()}` : `mid:${machineId || 'local'}`;
}

function buildSnapshot(clients: Map<WebSocket, ConnectedClient>): HqSnapshot {
  const now = new Date().toISOString();
  // Dedupe client records by clientId — one process may hold two sockets (a
  // mailbox publisher + a telemetry publisher) sharing the same clientId.
  const clientRecordById = new Map<string, HqClientRecord>();
  const projectMap = new Map<string, HqProjectRecord>();
  const mailboxSummaries: HqMailboxSummary[] = [];
  // Live sessions, deduped by sessionId across sockets (latest wins).
  const sessionById = new Map<string, HqSessionSnapshotPayload>();

  for (const client of clients.values()) {
    const machineId = client.machineId || client.project.machineId || '';
    if (!clientRecordById.has(client.clientId)) {
      clientRecordById.set(client.clientId, {
        clientId: client.clientId,
        kind: client.kind as HqClientRecord['kind'],
        machineId,
        ...(client.hostname ? { hostname: client.hostname } : {}),
        ...(client.pid ? { pid: client.pid } : {}),
        ...(client.version ? { version: client.version } : {}),
        connected: true,
        connectedAt: client.connectedAt,
        lastSeenAt: client.lastSeenAt,
        projectId: client.projectId,
        capabilities: client.capabilities as readonly HqClientCapability[],
      });
    }

    let project = projectMap.get(client.projectId);
    if (!project) {
      project = {
        projectId: client.projectId,
        projectName: client.project.projectName || client.projectId,
        projectRootDisplay: client.project.projectRoot,
        machineIds: [machineId],
        ...(client.project.gitBranch ? { gitBranch: client.project.gitBranch } : {}),
        activeClients: 0,
        activeSessions: 0,
        activeSubagents: 0,
        totalCostUsd: 0,
        lastActivityAt: now,
        status: 'active',
      };
      projectMap.set(client.projectId, project);
    } else if (machineId && !project.machineIds.includes(machineId)) {
      project.machineIds = [...project.machineIds, machineId];
    }

    for (const session of client.sessions.values()) {
      sessionById.set(session.sessionId, session);
    }

    for (const snapshot of client.mailboxes.values()) {
      mailboxSummaries.push({
        mailboxId: snapshot.mailboxId,
        projectId: client.projectId,
        scope: snapshot.scope,
        messageCount: snapshot.totals.messages,
        unreadCount: snapshot.totals.unread,
        incompleteCount: snapshot.totals.incomplete,
        highPriorityCount: snapshot.totals.highPriority,
        onlineAgentCount: snapshot.totals.onlineAgents,
        lastActivityAt: now,
      });
    }
  }

  // Per-project active-client counts from deduped client records.
  for (const rec of clientRecordById.values()) {
    const project = projectMap.get(rec.projectId);
    if (project) project.activeClients++;
  }

  // Fold live sessions into projects + machines.
  const liveSessions = Array.from(sessionById.values());
  const machineMap = new Map<string, { record: HqMachineRecord; projects: Set<string> }>();
  let totalAgents = 0;
  let totalSubagents = 0;
  let totalCostUsd = 0;

  for (const session of liveSessions) {
    // Ensure the project exists even if only a session (no mailbox/client
    // record under this projectId yet) reported it.
    let project = projectMap.get(session.projectId);
    if (!project) {
      project = {
        projectId: session.projectId,
        projectName: session.projectName || session.projectId,
        projectRootDisplay: session.projectRoot,
        machineIds: [session.machineId],
        ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
        activeClients: 0,
        activeSessions: 0,
        activeSubagents: 0,
        totalCostUsd: 0,
        lastActivityAt: session.lastActivityAt,
        status: 'active',
      };
      projectMap.set(session.projectId, project);
    } else if (session.machineId && !project.machineIds.includes(session.machineId)) {
      project.machineIds = [...project.machineIds, session.machineId];
    }
    project.activeSessions++;

    let sessionCost = 0;
    for (const agent of session.agents) {
      totalAgents++;
      if (agent.id !== 'leader') totalSubagents++;
      if (typeof agent.costUsd === 'number') {
        sessionCost += agent.costUsd;
      }
    }
    project.activeSubagents += session.agents.filter((a) => a.id !== 'leader').length;
    project.totalCostUsd += sessionCost;
    totalCostUsd += sessionCost;

    // Machine aggregation — keyed by hostname so the SAME computer is one
    // machine even when clients report different per-process machineIds.
    const mKey = hqMachineKey(session.hostname, session.machineId);
    let machine = machineMap.get(mKey);
    if (!machine) {
      machine = {
        record: {
          machineId: session.machineId,
          ...(session.hostname ? { hostname: session.hostname } : {}),
          clientCount: 0,
          sessionCount: 0,
          agentCount: 0,
          projectIds: [],
          lastActivityAt: session.lastActivityAt,
        },
        projects: new Set<string>(),
      };
      machineMap.set(mKey, machine);
    }
    machine.record.sessionCount++;
    machine.record.agentCount += session.agents.length;
    machine.projects.add(session.projectId);
    if (session.lastActivityAt > machine.record.lastActivityAt) {
      machine.record.lastActivityAt = session.lastActivityAt;
    }
  }

  // Attribute connected clients to machines too (so a machine with a client
  // but no session yet still appears).
  for (const rec of clientRecordById.values()) {
    if (!rec.machineId && !rec.hostname) continue;
    const rKey = hqMachineKey(rec.hostname, rec.machineId);
    let machine = machineMap.get(rKey);
    if (!machine) {
      machine = {
        record: {
          machineId: rec.machineId,
          ...(rec.hostname ? { hostname: rec.hostname } : {}),
          clientCount: 0,
          sessionCount: 0,
          agentCount: 0,
          projectIds: [],
          lastActivityAt: rec.lastSeenAt,
        },
        projects: new Set<string>(),
      };
      machineMap.set(rKey, machine);
    }
    machine.record.clientCount++;
    machine.projects.add(rec.projectId);
    if (rec.hostname && !machine.record.hostname) machine.record.hostname = rec.hostname;
  }

  const machines: HqMachineRecord[] = Array.from(machineMap.values()).map((m) => ({
    ...m.record,
    projectIds: Array.from(m.projects),
  }));

  const clientRecords = Array.from(clientRecordById.values());
  const projects = Array.from(projectMap.values());

  let unread = 0;
  let incomplete = 0;
  for (const m of mailboxSummaries) {
    unread += m.unreadCount;
    incomplete += m.incompleteCount;
  }

  return {
    generatedAt: now,
    clients: clientRecords,
    projects,
    sessions: [],
    fleets: [],
    mailboxes: mailboxSummaries,
    machines,
    liveSessions,
    totals: {
      activeProjects: projects.length,
      activeClients: clientRecords.length,
      activeSessions: liveSessions.length,
      activeSubagents: totalSubagents,
      unreadMailboxMessages: unread,
      incompleteMailboxMessages: incomplete,
      totalCostUsd,
      activeMachines: machines.length,
      activeAgents: totalAgents,
    },
  };
}

interface HqSnapshotBroadcaster {
  currentSerialized(): string;
  broadcast(): void;
  close(): void;
}

const HQ_SNAPSHOT_BROADCAST_DEBOUNCE_MS = 250;

function createSnapshotBroadcaster(
  clients: Map<WebSocket, ConnectedClient>,
  browsers: Set<WebSocket>,
): HqSnapshotBroadcaster {
  let cached = '';
  let dirty = true;
  let timer: NodeJS.Timeout | null = null;

  const serialize = (): string => {
    if (!dirty && cached.length > 0) return cached;
    const msg: HqBrowserMessage = { type: 'hq.snapshot', snapshot: buildSnapshot(clients) };
    cached = JSON.stringify(msg);
    dirty = false;
    return cached;
  };

  const flush = (): void => {
    timer = null;
    if (browsers.size === 0) return;
    const data = serialize();
    for (const ws of browsers) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  };

  return {
    currentSerialized: serialize,
    broadcast: () => {
      dirty = true;
      if (timer !== null) return;
      timer = setTimeout(flush, HQ_SNAPSHOT_BROADCAST_DEBOUNCE_MS);
      timer.unref?.();
    },
    close: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

interface ProjectDetail {
  generatedAt: string;
  project: HqProjectRecord;
  clients: readonly HqClientRecord[];
  mailboxes: readonly HqMailboxSnapshotPayload[];
}

function buildProjectDetail(
  clients: Map<WebSocket, ConnectedClient>,
  projectId: string,
): ProjectDetail | null {
  const projectClients: ConnectedClient[] = [];
  for (const c of clients.values()) {
    if (c.projectId === projectId) projectClients.push(c);
  }
  if (projectClients.length === 0) return null;

  const now = new Date().toISOString();
  const clientRecords: HqClientRecord[] = projectClients.map((c) => ({
    clientId: c.clientId,
    kind: c.kind as HqClientRecord['kind'],
    machineId: '',
    ...(c.hostname ? { hostname: c.hostname } : {}),
    ...(c.pid ? { pid: c.pid } : {}),
    ...(c.version ? { version: c.version } : {}),
    connected: true,
    connectedAt: c.connectedAt,
    lastSeenAt: c.lastSeenAt,
    projectId: c.projectId,
    capabilities: c.capabilities as readonly HqClientCapability[],
  }));

  const mailboxPayloads: HqMailboxSnapshotPayload[] = [];
  let latestActivity = now;
  for (const c of projectClients) {
    for (const snap of c.mailboxes.values()) {
      mailboxPayloads.push(snap);
      if (snap.totals.messages > 0) latestActivity = now;
    }
  }

  const primaryProject = projectClients[0]!.project;
  const machineIds = Array.from(new Set(projectClients.map((client) => client.project.machineId)));
  const project: HqProjectRecord = {
    projectId,
    projectName: primaryProject.projectName || projectId,
    projectRootDisplay: primaryProject.projectRoot,
    machineIds,
    ...(primaryProject.gitBranch ? { gitBranch: primaryProject.gitBranch } : {}),
    activeClients: projectClients.length,
    activeSessions: 0,
    activeSubagents: 0,
    totalCostUsd: 0,
    lastActivityAt: latestActivity,
    status: 'active',
  };

  return {
    generatedAt: now,
    project,
    clients: clientRecords,
    mailboxes: mailboxPayloads,
  };
}

function broadcastEvent(event: HqEventEnvelope, browsers: Set<WebSocket>): void {
  const msg: HqBrowserMessage = { type: 'hq.event', event };
  const data = JSON.stringify(msg);
  for (const ws of browsers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}
