import { spawn } from 'node:child_process';
import type { Tool } from '@wrongstack/core';
import { safeResolve } from './_util.js';

interface LogsInput {
  service?: string;
  path?: string;
  lines?: number;
  stream?: boolean;
  filter?: string;
  since?: '1h' | '6h' | '24h' | 'all';
  cwd?: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

interface LogsOutput {
  source: string;
  entries: LogEntry[];
  total: number;
  truncated: boolean;
  stream_mode: boolean;
}

export const logsTool: Tool<LogsInput, LogsOutput> = {
  name: 'logs',
  description:
    'Stream or fetch logs from a service or file. Supports Docker, systemd, or plain log files.',
  usageHint:
    'Set `service` for Docker/systemd, `path` for file. `lines` limits output. `stream` for tail -f behavior. `filter` regex filters lines.',
  permission: 'confirm',
  mutating: false,
  timeoutMs: 30_000,
  inputSchema: {
    type: 'object',
    properties: {
      service: {
        type: 'string',
        description: 'Service name for Docker or systemd journal',
      },
      path: {
        type: 'string',
        description: 'Path to log file (alternative to service)',
      },
      lines: {
        type: 'integer',
        description: 'Number of log lines to fetch (default: 100, 0 for all)',
        minimum: 0,
        maximum: 10000,
      },
      stream: {
        type: 'boolean',
        description: 'Stream logs continuously (like tail -f) (default: false)',
      },
      filter: {
        type: 'string',
        description: 'Regex pattern to filter log lines',
      },
      since: {
        type: 'string',
        enum: ['1h', '6h', '24h', 'all'],
        description: 'Only show logs since duration',
      },
      cwd: { type: 'string', description: 'Working directory (default: cwd)' },
    },
  },
  async execute(input, ctx, opts) {
    const cwd = input.cwd ? safeResolve(input.cwd, ctx) : ctx.cwd;
    const lines = input.lines ?? 100;
    const filterRe = input.filter ? new RegExp(input.filter, 'i') : null;

    if (input.service) {
      return await dockerLogs(input.service, lines, filterRe, cwd, opts.signal);
    }

    if (input.path) {
      return await fileLogs(safeResolve(input.path, ctx), lines, filterRe, input.stream ?? false);
    }

    return {
      source: 'none',
      entries: [],
      total: 0,
      truncated: false,
      stream_mode: false,
    };
  },
};

async function dockerLogs(
  service: string,
  lines: number,
  filterRe: RegExp | null,
  cwd: string,
  signal: AbortSignal,
  since?: string,
): Promise<LogsOutput> {
  const args = ['logs'];
  if (lines > 0) args.push('--tail', String(lines));
  if (since) {
    const sinceMap: Record<string, string> = { '1h': '1h', '6h': '6h', '24h': '24h' };
    args.push('--since', sinceMap[since] ?? '1h');
  }
  args.push('--timestamps', service);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const MAX = 200_000;

    const child = spawn('docker', args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => { if (stdout.length < MAX) stdout += c.toString(); });
    child.stderr?.on('data', (c) => { if (stderr.length < MAX) stderr += c.toString(); });
    child.on('close', (code) => {
      const output = stdout + stderr;
      const entries = parseLogLines(output, filterRe);
      resolve({
        source: `docker:${service}`,
        entries,
        total: entries.length,
        truncated: output.length >= MAX,
        stream_mode: false,
      });
    });
    child.on('error', (e) => resolve({
      source: `docker:${service}`,
      entries: [],
      total: 0,
      truncated: false,
      stream_mode: false,
    }));
  });
}

async function fileLogs(
  path: string,
  lines: number,
  filterRe: RegExp | null,
  stream: boolean,
): Promise<LogsOutput> {
  const { createInterface } = await import('node:readline');
  const { createReadStream } = await import('node:fs');
  const entries: LogEntry[] = [];
  const allLines: string[] = [];

  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (filterRe && !filterRe.test(line)) continue;
    allLines.push(line);
  }

  const sliced = lines > 0 ? allLines.slice(-lines) : allLines;
  for (const line of sliced) {
    const parsed = parseLine(line);
    if (parsed) entries.push(parsed);
  }

  return {
    source: path,
    entries,
    total: entries.length,
    truncated: allLines.length > lines && lines > 0,
    stream_mode: stream,
  };
}

function parseLogLines(output: string, filterRe: RegExp | null): LogEntry[] {
  const lines = output.split('\n').filter(Boolean);
  const entries: LogEntry[] = [];

  for (const line of lines) {
    if (filterRe && !filterRe.test(line)) continue;
    const parsed = parseLine(line);
    if (parsed) entries.push(parsed);
  }

  return entries;
}

function parseLine(line: string): LogEntry | null {
  const tsRe = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(?:\[?(\w+)\]?)\s*(.*)/;
  const match = tsRe.exec(line);

  if (match) {
    return {
      timestamp: match[1] ?? '',
      level: match[2]?.toLowerCase() ?? 'info',
      message: match[3] ?? '',
    };
  }

  const levelRe = /(?:ERROR|WARN|INFO|DEBUG|TRACE)\s+(.*)/i;
  const levelMatch = levelRe.exec(line);

  if (levelMatch) {
    return {
      timestamp: '',
      level: levelMatch[1]?.toLowerCase() ?? 'info',
      message: levelMatch[2] ?? line,
    };
  }

  return {
    timestamp: '',
    level: 'info',
    message: line,
  };
}