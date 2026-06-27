/**
 * WrongStackACPServer — ACP v1 server-side entry point.
 *
 * Exposes WrongStack as an ACP-compatible agent. ACP clients (Zed, JetBrains
 * Junie, VS Code ACP extension) spawn this as a subprocess, send JSON-RPC
 * messages over stdio, and receive v1-protocol responses.
 *
 * Usage:
 *   node dist/agent/wrongstack-acp-agent.js
 *
 * Or via the CLI:
 *   wstack acp-server
 *
 * Wiring a real agent: this class is the surface; the bootstrap
 * binary uses a no-op echo by default so the binary is a useful
 * connectivity smoke test. For a real server, instantiate
 * `WrongStackACPServer` programmatically and pass a `runTurn`
 * produced by `makeACPServerAgentTurn({ agentFor: ... })` from
 * `./server-agent-turn.js`. The factory is responsible for building
 * a real core `Agent` (with the right provider, model, system prompt,
 * etc.) per session.
 *
 * Startup: prints the legacy `[wstack-acp]\n` marker (kept for backward
 * compatibility with the old `StdioTransport` handshake) so the client
 * knows the protocol boundary. v1 initialize is then sent by the client
 * and answered by `ACPProtocolHandler`.
 */
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import { writeErr } from '@wrongstack/core';
import type { ACPMessage } from '../types/acp-messages.js';
import {
  ACPProtocolHandler,
  type RunTurn,
  type RunTurnResult,
} from './protocol-handler.js';
import { StdioTransport } from './stdio-transport.js';

export interface WrongStackACPServerOptions {
  runTurn?: RunTurn | undefined;
  defaultCwd?: string | undefined;
  agentName?: string | undefined;
  /**
   * Transport mode. 'stdio' (default) communicates over stdin/stdout.
   * When a number is provided, the server listens as an HTTP server on
   * that port, accepting Streamable HTTP (JSON-RPC over HTTP POST).
   */
  transport?: 'stdio' | number | undefined;
  /** Host for HTTP transport. Defaults to '127.0.0.1'. */
  host?: string | undefined;
}

export class WrongStackACPServer {
  private readonly transport: StdioTransport;
  private readonly handler: ACPProtocolHandler;
  private readonly options: WrongStackACPServerOptions;
  /** HTTP server when transport mode is HTTP. */
  private httpServer: Server | null = null;
  private running = false;

  constructor(opts: WrongStackACPServerOptions = {}) {
    this.options = opts;
    this.transport = new StdioTransport();
    const runTurn: RunTurn = opts.runTurn ?? defaultEchoRunTurn;
    this.handler = new ACPProtocolHandler({
      transport: this.transport,
      defaultCwd: opts.defaultCwd ?? process.cwd(),
      runTurn,
      agentName: opts.agentName,
    });
  }

  /**
   * Start the server. Mode depends on `options.transport`:
   * - 'stdio' (default): reads JSON-RPC from stdin, writes to stdout.
   * - number: listens as HTTP on the given port.
   */
  async start(): Promise<void> {
    const transportMode = this.options.transport;
    if (typeof transportMode === 'number') {
      await this.startHttp(transportMode);
    } else {
      await this.startStdio();
    }
  }

  private async startStdio(): Promise<void> {
    this.transport.sendStartupMarker();
    this.running = true;
    while (this.running) {
      const msg = await this.transport.read();
      if (!msg) break;
      const terminal = await this.handler.handleMessage(msg);
      if (terminal) break;
    }
    this.transport.close();
  }

  private async startHttp(port: number): Promise<void> {
    const host = this.options.host ?? '127.0.0.1';
    const handler = this.handler;

    this.httpServer = createServer(async (req, res) => {
      // CORS headers for browser-based clients
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
      }

      // Parse JSON body
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }

      let msg: unknown;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: { code: -32700, message: 'Parse error' } }));
        return;
      }

      // Process the message and return the response
      // For HTTP transport, we buffer notifications and return them
      // inline with the response (Streamable HTTP pattern).
      const notifications: unknown[] = [];
      const originalSend = this.transport.send.bind(this.transport);
      this.transport.send = async (m: ACPMessage) => {
        // If it's a notification (session/update), buffer it
        if (m.method === 'session/update' && m.id === undefined) {
          notifications.push(m.params);
        } else {
          // Responses go to the original send
          await originalSend(m);
        }
      };

      try {
        await handler.handleMessage(msg);
      } finally {
        this.transport.send = originalSend;
      }

      // Get the response that was sent
      const sent = this.transport as { lastSent?: unknown };
      const lastResponse = (sent as { lastResponse?: unknown }).lastResponse;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      const responseBody = {
        result: lastResponse,
        notifications,
      };
      res.end(JSON.stringify(responseBody));
    });

    return new Promise<void>((resolve) => {
      this.httpServer!.listen(port, host, () => {
        writeErr(`[wstack-acp] HTTP server listening on http://${host}:${port}\n`);
        this.running = true;
        resolve();
      });
    });
  }

  /** Stop the server. */
  stop(): void {
    this.running = false;
    this.transport.close();
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}

/**
 * Default per-turn implementation: a no-op that echoes nothing useful
 * and returns `end_turn`. Lets the server boot end-to-end without
 * needing the core Agent factory (which would couple this entrypoint
 * to a long-lived model provider). The real implementation is
 * `ACPServerAgentTurn` (follow-up PR) that wires a core `Agent`.
 */
const defaultEchoRunTurn: RunTurn = async (_input, _emit): Promise<RunTurnResult> => {
  return { stopReason: 'end_turn' };
};

/**
 * Bootstrap function for `node dist/agent/wrongstack-acp-agent.js`.
 * Instantiates the server with the default (no-op) runTurn so the
 * binary is useful as a connectivity smoke test.
 *
 * In practice the CLI will instantiate and run `WrongStackACPServer`
 * directly, passing a real `runTurn` wired to a core `Agent`.
 */
/* v8 ignore start -- process entrypoint: bootstrap + auto-start only run when launched as `node wrongstack-acp-agent.js`, never on import (which the CLI does to reuse the class). */
async function main(): Promise<void> {
  const server = new WrongStackACPServer();
  await server.start();
}

const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  main().catch((err) => {
    writeErr(`[wstack-acp fatal] ${err}\n`);
    process.exit(1);
  });
}
/* v8 ignore stop */
