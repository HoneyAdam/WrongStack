/**
 * `wstack mailbox serve` — run a loopback HTTP façade over the project's
 * shared `GlobalMailbox`, so external coding agents (Claude Code, Aider,
 * custom scripts) can read and send messages on the same channel that
 * WrongStack-internal agents use.
 *
 * ## Design
 *
 * The server is intentionally tiny: one `node:http` server, a single
 * `GlobalMailbox` instance, and a bearer-token gate. Every route is a
 * thin JSON-in / JSON-out wrapper over a `GlobalMailbox` method, so all
 * file locking, mtime-cached reads, agent heartbeats, and HQ telemetry
 * happen exactly as they do for WrongStack-internal callers. External
 * agents are NOT given raw file access — they go through `GlobalMailbox`
 * so they cannot race the file lock during acks.
 *
 * ## Single-instance lock
 *
 * Per-project isolation. The lock file lives at
 * `<projectDir>/.mailbox-bridge.lock` and records the owner process,
 * the OS-bound URL, and the bearer token. A second `wstack mailbox serve`
 * for the same project detects the live lock, prints the existing URL
 * and token to stdout, and exits 0 — so shell pipelines can capture
 * them with `$(wstack mailbox serve)`. Two different projects get
 * different lock files (different project slugs), so they never collide.
 *
 * When `--port N` is requested but another project on a different
 * project dir already owns that port, the second invocation fails
 * loud and prints the existing owner's URL on stderr — see
 * `--strict-port` for the deterministic variant.
 *
 * ## Authentication
 *
 * On first start we mint a 32-byte random bearer token and persist it
 * in BOTH the lock file AND `<projectDir>/.mailbox.token` (mode 0600).
 * Subsequent restarts of the SAME instance reuse the persisted token,
 * so external agents that read the token before a bridge restart
 * survive the restart without having to re-discover credentials. If
 * the lock file is missing or the recorded PID is dead, we treat this
 * as a fresh instance and mint a new token. Tokens are compared in
 * constant time. The token file is unlinked on clean shutdown when
 * we are still the recorded owner.
 *
 * ## Bind safety
 *
 * Default bind is `127.0.0.1` — loopback only. Pass `--host` to expose
 * to LAN (NOT recommended without a reverse proxy that re-authenticates
 * and rate-limits; the bearer token is the only auth).
 *
 * ## Routes
 *
 *   POST /mailbox/send              → send({from,to,type,subject,body,...})
 *   POST /mailbox/query             → query({to?,from?,unreadBy?,...})
 *   POST /mailbox/check             → check({agentId,baseId?,markRead?,completed?})
 *   POST /mailbox/ack               → ack({messageId,readerId,...})
 *   POST /mailbox/ack-many          → ackMany({acks:[...]})
 *   POST /mailbox/unread-count      → unreadCount({forAgentId})
 *   POST /mailbox/agents/register   → registerAgent({...})  source='http'
 *   POST /mailbox/agents/heartbeat  → heartbeat({...})
 *   POST /mailbox/register-client   → registerClient({...}) source='http'
 *   POST /mailbox/heartbeat         → clientHeartbeat({clientId,sessionId?})
 *   POST /mailbox/purge-clients     → purgeClients()
 *   GET  /mailbox/agents            → getAgentStatuses()
 *   GET  /mailbox/agents/online     → getOnlineAgents()
 *
 * @module subcommands/handlers/mailbox-serve
 */
import { createServer } from 'node:http';
import {
  authorizeMailboxBearerToken,
  createMailboxHttpRouter,
  GlobalMailbox,
  MailboxEventEmitter,
  MailboxHttpRateLimiter,
  resolveProjectDir,
  wstackGlobalRoot,
} from '@wrongstack/core';
import type { SubcommandDeps, SubcommandHandler } from '../index.js';
import {
  acquireOrJoin,
  finalize,
  release,
} from '@wrongstack/core/coordination';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 7788;

export const mailboxServeCmd: SubcommandHandler = async (args, deps) => {
  const sub = args[0];

  if (!sub || sub === 'serve') {
    return startServer(deps);
  }
  if (sub === 'help' || sub === '--help' || sub === '-h') {
    printHelp(deps);
    return 0;
  }

  deps.renderer.writeError(`Unknown mailbox subcommand: ${sub}\n`);
  printHelp(deps);
  return 1;
};

async function startServer(deps: SubcommandDeps): Promise<number> {
  const flags = deps.flags ?? {};
  const host = typeof flags['host'] === 'string' ? flags['host'] : DEFAULT_HOST;
  const portRaw = typeof flags['port'] === 'string' ? Number.parseInt(flags['port'], 10) : DEFAULT_PORT;
  const strictPort = flags['strict-port'] === true;
  // `--port 0` is valid and means "let the OS assign a free port" — the
  // same thing the non-strict default does. Reject only NaN, negative,
  // or out-of-range ports.
  if (!Number.isInteger(portRaw) || portRaw < 0 || portRaw > 65535) {
    deps.renderer.writeError(`Invalid --port: ${String(flags['port'])}\n`);
    return 1;
  }

  const projectDir = resolveProjectDir(deps.projectRoot, wstackGlobalRoot());

  // Phase 1 — lock acquire. If another instance already owns this
  // project's mailbox-bridge slot, we either join them (URL/token
  // reuse) or fail loud on port-conflict. Both paths skip the listen
  // step entirely — no HTTP server is started in this process.
  const acquireResult = await acquireOrJoin({
    projectDir,
    host,
    requestedPort: strictPort ? portRaw : null,
    strictPort,
  });

  if (acquireResult.kind === 'joined') {
    const lock = acquireResult.lock;
    // Another live instance owns this project. Print its URL + token
    // so a shell pipeline can capture them with
    // `$(wstack mailbox serve)`. Exit 0 because the system as a whole
    // is in a valid state — the user's request ("mailbox serve") is
    // effectively satisfied.
    deps.renderer.write(
      `Mailbox bridge already running (PID ${lock.pid}).\n` +
      `  URL:        ${lock.url}\n` +
      `  Token file: ${acquireResult.tokenPath}\n` +
      `  Lock:       ${projectDir}${process.platform === 'win32' ? '\\' : '/'}.mailbox-bridge.lock\n\n`,
    );
    return 0;
  }

  if (acquireResult.kind === 'port-conflict') {
    // Caller asked for an explicit port; another process on a
    // DIFFERENT project dir owns that port. We can't join them
    // (cross-project is forbidden — tokens and locks are per-project).
    // Loud-fail with the existing owner's URL so the caller can
    // either pick a different port or reuse that other bridge.
    const existing = acquireResult.existing;
    deps.renderer.writeError(
      `Port ${portRaw} already in use by another mailbox bridge on a different project.\n` +
      `  Owner project: ${projectDir} (us)\n` +
      `  Owner URL:     ${existing.url}\n` +
      `  Owner PID:     ${existing.pid}\n\n` +
      `Either pick a different --port, run without --strict-port (OS will assign a free one),\n` +
      `or stop the conflicting process and retry.\n`,
    );
    // No tentative lock was written in this branch — acquireOrJoin
    // returns port-conflict before the write step. Nothing to
    // release.
    return 1;
  }

  // acquireResult.kind === 'acquired' — we own the slot. Now bind
  // the HTTP server.
  const tentative = acquireResult.lock;
  const eventEmitter = new MailboxEventEmitter();
  const mailbox = new GlobalMailbox(projectDir, undefined, undefined, eventEmitter);

  // Authentication and protocol handling are shared with HQ; this host keeps
  // ownership of the standalone bridge token, rate-limiter lifecycle, and
  // single-instance lock.
  const rateLimiter = new MailboxHttpRateLimiter();
  const rateLimitCleanup = setInterval(() => rateLimiter.cleanup(), 120_000);
  rateLimitCleanup.unref?.();
  const router = createMailboxHttpRouter({
    mailbox,
    eventEmitter,
    rateLimiter,
    authorize: (request) => authorizeMailboxBearerToken(request, tentative.token),
  });

  const server = createServer((request, response) => {
    void router.handle(request, response);
  });

  // Listen semantics:
  //  - strictPort: bind to the exact port requested; reject on
  //    EADDRINUSE so the operator knows their port is taken. The lock
  //    acquire already verified no WrongStack bridge owns this
  //    project, so a strict-port failure here means an UNRELATED
  //    process is sitting on the port.
  //  - !strictPort: ask the OS for a free port (pass 0). Operator
  //    gets a working URL no matter what else is bound to the
  //    default port.
  let boundPort = -1;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      const requestedPort = strictPort ? portRaw : 0;
      server.listen(requestedPort, host);
    });
    const addr = server.address();
    boundPort = typeof addr === 'object' && addr !== null ? addr.port : portRaw;
  } catch (err) {
    // Listen failed — release our tentative lock so the next
    // acquire doesn't see a stale "owned" record pointing at a
    // process that never bound.
    clearInterval(rateLimitCleanup);
    await release(projectDir, tentative.generation);
    const msg = (err as Error).message;
    if (strictPort) {
      deps.renderer.writeError(
        `Failed to bind ${host}:${portRaw}: ${msg}\n` +
        `Either pick a different --port or stop the process holding this port.\n`,
      );
    } else {
      deps.renderer.writeError(
        `Failed to bind ${host} on an OS-assigned port: ${msg}\n` +
        `This usually means no port is available (extremely rare). Retry or pick an explicit --port.\n`,
      );
    }
    return 1;
  }

  // Phase 2 — finalize: write the lock + token with the actual
  // bound port and the same token, atomically.
  const finalized = await finalize(projectDir, tentative, boundPort);
  writeStartupInfo(deps, { host, port: boundPort, projectDir, tokenPath: acquireResult.tokenPath });

  // Keep the process alive until SIGINT/SIGTERM. We resolve once the
  // server has fully closed and the lock + token files are gone.
  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = async (sig: NodeJS.Signals) => {
      if (shuttingDown) return;
      shuttingDown = true;
      clearInterval(rateLimitCleanup);
      console.log(JSON.stringify({ event: 'mailbox_serve_stopping', signal: sig, host, port: boundPort }));
      // Close long-lived SSE responses before waiting for server.close().
      router.close();
      // Stop accepting new connections; in-flight requests get to finish.
      await new Promise<void>((closeResolve) => server.close(() => closeResolve()));
      await mailbox.close().catch((err) => {
        deps.renderer.writeWarning(`mailbox close error: ${(err as Error).message}\n`);
      });
      // Best-effort release. If we lost the lock race to another
      // acquire, release() will detect the generation mismatch and
      // leave their lock alone.
      await release(projectDir, finalized.generation);
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
  return 0;
}

// ── Startup info / help ───────────────────────────────────────────────────

interface StartupInfo {
  host: string;
  port: number;
  projectDir: string;
  tokenPath: string;
}

function writeStartupInfo(deps: SubcommandDeps, info: StartupInfo): void {
  // One structured JSON line to stdout for log-shippers; human-readable
  // mirror to stderr (renderer.writeWarning/etc. go to stderr).
  console.log(
    JSON.stringify({
      event: 'mailbox_serve_started',
      host: info.host,
      port: info.port,
      projectDir: info.projectDir,
      tokenFile: info.tokenPath,
    }),
  );
  deps.renderer.write(`WrongStack mailbox bridge listening on http://${info.host}:${info.port}\n`);
  deps.renderer.write(`Project dir:  ${info.projectDir}\n`);
  deps.renderer.write(`Token file:   ${info.tokenPath} (mode 0600)\n`);
  deps.renderer.write('\n');
  deps.renderer.write('Routes:\n');
  deps.renderer.write('  POST /mailbox/send              send a message\n');
  deps.renderer.write('  POST /mailbox/query             query messages\n');
  deps.renderer.write('  POST /mailbox/check             check inbox and optionally mark read/completed\n');
  deps.renderer.write('  POST /mailbox/ack               acknowledge one message\n');
  deps.renderer.write('  POST /mailbox/ack-many          acknowledge many in one batch\n');
  deps.renderer.write('  POST /mailbox/unread-count      count unread messages for an agent\n');
  deps.renderer.write('  POST /mailbox/agents/register   register an external agent\n');
  deps.renderer.write('  POST /mailbox/agents/heartbeat  update agent heartbeat\n');
  deps.renderer.write('  POST /mailbox/register-client   register an external client\n');
  deps.renderer.write('  POST /mailbox/heartbeat         update client heartbeat\n');
  deps.renderer.write('  GET  /mailbox/agents            list all registered agents\n');
  deps.renderer.write('  GET  /mailbox/agents/online     list agents with a live heartbeat\n');
  deps.renderer.write('  GET  /mailbox/events            SSE stream — real-time mailbox push\n');
  deps.renderer.write('  GET  /healthz                   health probe (no auth)\n');
  deps.renderer.write('\n');
  deps.renderer.write('Send the bearer token in: Authorization: Bearer <token>\n');
  deps.renderer.write('Cat the token from another shell:\n');
  deps.renderer.write(`  cat ${info.tokenPath}\n`);
  deps.renderer.write('\nPress Ctrl+C to stop.\n');
}

function printHelp(deps: SubcommandDeps): void {
  deps.renderer.write(`Usage: wstack mailbox <serve>\n`);
  deps.renderer.write('\n');
  deps.renderer.write(`  wstack mailbox serve           Start the loopback HTTP bridge.\n`);
  deps.renderer.write('\n');
  deps.renderer.write('Flags:\n');
  deps.renderer.write(`  --host <ip>         Bind host (default ${DEFAULT_HOST}). Exposing beyond\n`);
  deps.renderer.write('                     loopback requires network-layer protection.\n');
  deps.renderer.write(`  --port <n>          Bind port (default ${DEFAULT_PORT}).\n`);
  deps.renderer.write('  --strict-port       Fail if the requested port is already in use.\n');
}
