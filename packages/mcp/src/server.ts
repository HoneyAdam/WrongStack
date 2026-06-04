import { MCP_CONSTANTS } from './constants.js';

/**
 * Server-side MCP. The mirror image of `MCPClient`: instead of consuming a
 * remote MCP server, this lets WrongStack *be* an MCP server — exposing its
 * tools to any MCP client (Claude Desktop, another agent, an IDE) over a
 * JSON-RPC 2.0 stream.
 *
 * The protocol core (`MCPServer`) is transport-agnostic: feed it a raw JSON
 * line via `handleMessage`, get back a response string (or `null` for
 * notifications). `serveStdio` wires it to stdin/stdout for the canonical
 * stdio transport.
 */

/** A tool descriptor advertised over `tools/list`. */
export interface MCPServerTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** The result of a `tools/call`, as the host produces it. */
export interface MCPServerCallResult {
  /** Text or pre-built MCP content blocks. Strings are wrapped as a text block. */
  content: unknown;
  isError: boolean;
}

/**
 * Bridges the MCP server to a tool backend (in the CLI, the `ToolRegistry`).
 * Kept narrow so the protocol core has no dependency on `@wrongstack/core`.
 */
export interface MCPServerToolHost {
  listTools(): MCPServerTool[] | Promise<MCPServerTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<MCPServerCallResult>;
}

export interface MCPServerLogger {
  warn?(msg: string): void;
  info?(msg: string): void;
}

export interface MCPServerOptions {
  host: MCPServerToolHost;
  /** Advertised in the `initialize` handshake. Defaults to the wrongstack identity. */
  serverInfo?: { name: string; version: string };
  logger?: MCPServerLogger;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

// JSON-RPC 2.0 reserved error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export class MCPServer {
  private readonly host: MCPServerToolHost;
  private readonly serverInfo: { name: string; version: string };
  private readonly logger?: MCPServerLogger;

  constructor(opts: MCPServerOptions) {
    this.host = opts.host;
    this.serverInfo = opts.serverInfo ?? {
      name: MCP_CONSTANTS.CLIENT_INFO.name,
      version: MCP_CONSTANTS.CLIENT_INFO.version,
    };
    this.logger = opts.logger;
  }

  /**
   * Handle one raw JSON-RPC line. Returns the response JSON string for
   * requests, or `null` for notifications (no `id`) and for blank input —
   * the caller should write the string to its output stream when non-null.
   */
  async handleMessage(raw: string): Promise<string | null> {
    const line = raw.trim();
    if (!line) return null;

    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return this.encodeError(null, PARSE_ERROR, 'Parse error');
    }

    if (typeof msg !== 'object' || msg === null || typeof msg.method !== 'string') {
      const id = msg && typeof msg === 'object' ? (msg.id ?? null) : null;
      return this.encodeError(id ?? null, INVALID_REQUEST, 'Invalid Request');
    }

    const isNotification = msg.id === undefined || msg.id === null;

    // Notifications never get a response. We still dispatch known ones for
    // side effects, but `notifications/initialized` is purely a handshake ack.
    if (isNotification) {
      return null;
    }

    try {
      const result = await this.dispatch(msg.method, msg.params);
      if (result === METHOD_NOT_FOUND_SENTINEL) {
        return this.encodeError(msg.id!, METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
      }
      return JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`MCP server: method "${msg.method}" threw: ${message}`);
      return this.encodeError(msg.id!, INTERNAL_ERROR, message);
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: MCP_CONSTANTS.PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.serverInfo,
        };
      case 'ping':
        return {};
      case 'tools/list': {
        const tools = await this.host.listTools();
        return { tools };
      }
      case 'tools/call': {
        const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof p.name !== 'string') {
          throw new Error('tools/call requires a string "name"');
        }
        const args =
          p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments)
            ? (p.arguments as Record<string, unknown>)
            : {};
        const res = await this.host.callTool(p.name, args);
        return { content: toContentBlocks(res.content), isError: res.isError };
      }
      default:
        return METHOD_NOT_FOUND_SENTINEL;
    }
  }

  private encodeError(id: number | string | null, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  }
}

const METHOD_NOT_FOUND_SENTINEL = Symbol('method-not-found');

/** Normalize a host result's content into MCP content blocks. */
export function toContentBlocks(content: unknown): Array<{ type: 'text'; text: string }> {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) {
    // Already-shaped content blocks pass through; otherwise stringify each item.
    const allBlocks = content.every(
      (c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'text',
    );
    if (allBlocks) return content as Array<{ type: 'text'; text: string }>;
    return [{ type: 'text', text: content.map((c) => stringifyItem(c)).join('\n') }];
  }
  if (content === undefined || content === null) return [{ type: 'text', text: '' }];
  return [{ type: 'text', text: stringifyItem(content) }];
}

function stringifyItem(c: unknown): string {
  if (typeof c === 'string') return c;
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}

export interface ServeStdioHandle {
  /** Stop reading and detach listeners. Does not exit the process. */
  close(): void;
  /** Resolves when the input stream ends (EOF). */
  done: Promise<void>;
}

export interface ServeStdioOptions {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

/**
 * Run an `MCPServer` over stdio: newline-delimited JSON-RPC in on stdin,
 * responses out on stdout. CRITICAL: nothing else may write to stdout while
 * this runs — it is the JSON-RPC channel. Route all logging to stderr.
 */
export function serveStdio(server: MCPServer, opts: ServeStdioOptions = {}): ServeStdioHandle {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  let buffer = '';
  let closed = false;
  // Serialize writes so concurrent async handlers don't interleave lines.
  let writeChain: Promise<void> = Promise.resolve();

  const writeLine = (s: string) => {
    writeChain = writeChain.then(
      () =>
        new Promise<void>((resolve) => {
          stdout.write(`${s}\n`, () => resolve());
        }),
    );
  };

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
      if (!line.trim()) continue;
      void server.handleMessage(line).then((res) => {
        if (res !== null && !closed) writeLine(res);
      });
    }
  };

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const onEnd = () => {
    if (closed) return;
    closed = true;
    stdin.off('data', onData);
    resolveDone();
  };

  stdin.on('data', onData);
  stdin.once('end', onEnd);
  stdin.once('close', onEnd);
  if (typeof (stdin as { resume?: () => void }).resume === 'function') {
    (stdin as { resume: () => void }).resume();
  }

  return {
    close: () => {
      onEnd();
    },
    done,
  };
}
