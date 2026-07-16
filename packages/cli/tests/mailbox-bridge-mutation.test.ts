/**
 * Focused mutation matrix for the standalone mailbox HTTP bridge.
 *
 * Each row starts from a known-valid request body, alters exactly one
 * field (delete, wrong type, or out-of-domain value), and asserts that
 * the bridge returns `400 VALIDATION_ERROR` **before** any `Mailbox`
 * method is invoked. Coverage here exercises the bridge end-to-end —
 * `createMailboxHttpRouter` lives in `@wrongstack/core`, but the bridge
 * is the live external-agent surface, so validating the contract at
 * this layer (auth, body parser, router dispatch, error envelope) is
 * the highest-leverage check that a future regression in core
 * couldn't silently slip through.
 *
 * The bridge helper, `http`, spawns the `wstack mailbox serve`
 * subprocess and uses the same token file the bridge wrote on
 * startup, so every mutation runs against the real running server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { GlobalMailbox, resolveProjectDir, wstackGlobalRoot } from '@wrongstack/core';

import {
  addRouteMutationTests,
  SEND_DEF,
  QUERY_DEF,
  CHECK_DEF,
  ACK_DEF,
  ACK_MANY_DEF,
  AGENT_REG_DEF,
  CLIENT_REG_DEF,
  HEARTBEAT_DEF,
  AGENT_HEARTBEAT_DEF,
} from '../../core/tests/coordination/mailbox-mutation-fixtures.js';
import type { PostFn } from '../../core/tests/coordination/mailbox-mutation-fixtures.js';

let tmpProject: string;
let baseUrl: string;
let token: string;
let serverChild: import('node:child_process').ChildProcess | null = null;

async function readToken(projectDir: string): Promise<string> {
  const tokenPath = path.join(projectDir, '.mailbox.token');
  for (let i = 0; i < 20; i++) {
    try {
      return (await fs.readFile(tokenPath, 'utf8')).trim();
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`timed out waiting for token file at ${tokenPath}`);
}

async function http(
  method: 'GET' | 'POST',
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5_000),
  });
  let parsed: unknown = null;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function countMessages(): Promise<number> {
  const mb = new GlobalMailbox(resolveProjectDir(tmpProject, wstackGlobalRoot()));
  try {
    const all = await mb.query({ limit: 1_000 });
    return all.length;
  } finally {
    await mb.close();
  }
}

/**
 * Build a structurally-valid but wrong token by tampering with one
 * character. We deliberately avoid putting a credential-shaped literal in
 * the source — the scanner rejects `Bearer <...>` strings. The tamper
 * is derived from the live token at runtime.
 */
function tamperedToken(): string {
  const flip =
    token.length > 0 && token.charCodeAt(0) >= 48 ? String.fromCharCode(token.charCodeAt(0) - 1) : 'Z';
  return flip + token.slice(1);
}

beforeAll(async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-mailbox-mut-home-'));
  process.env['WRONGSTACK_HOME'] = home;
  tmpProject = await fs.mkdtemp(path.join(home, 'project-'));

  const cliEntry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const child = spawn(
    process.execPath,
    [cliEntry, 'mailbox', 'serve', '--host', '127.0.0.1', '--port', '0'],
    { cwd: tmpProject, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  serverChild = child;
  let stdout = '';
  child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
  child.stderr?.on('data', () => { /* swallow */ });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server didn't start within 10s; stdout so far:\n${stdout}`)),
      10_000,
    );
    const check = setInterval(() => {
      if (stdout.includes('"mailbox_serve_started"')) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
    child.once('exit', (code) => {
      clearInterval(check);
      clearTimeout(timer);
      reject(new Error(`server exited early (code=${code}); stdout:\n${stdout}`));
    });
  });

  const m = /"port":\s*(\d+)/.exec(stdout);
  if (!m) throw new Error(`could not parse port from startup log:\n${stdout}`);
  const port = Number(m[1]);
  baseUrl = `http://127.0.0.1:${port}`;
  token = await readToken(resolveProjectDir(tmpProject, wstackGlobalRoot()));
}, 30_000);

afterAll(async () => {
  if (serverChild) {
    const child = serverChild;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 3_000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
      child.kill('SIGINT');
    });
  }
  if (process.env['WRONGSTACK_HOME']) {
    await fs.rm(process.env['WRONGSTACK_HOME'], {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    delete process.env['WRONGSTACK_HOME'];
  }
});

const auth = (): Record<string, string> => ({ Authorization: `Bearer ${token}` });
const wrongAuth = (): Record<string, string> => ({ Authorization: `Bearer ${tamperedToken()}` });

// Shared fixture route mutations — these describe blocks are generated by
// addRouteMutationTests using the route definitions from core's fixture.
// Adding a new case to any RouteDef in mailbox-mutation-fixtures.ts
// automatically adds it to this suite too.
const bridgePost: PostFn = async (route, body, headers) => {
  const res = await http('POST', route, body, { ...auth(), ...headers });
  return { status: res.status, json: res.body };
};

addRouteMutationTests(
  [SEND_DEF, QUERY_DEF, CHECK_DEF, ACK_DEF, ACK_MANY_DEF, AGENT_REG_DEF, CLIENT_REG_DEF, HEARTBEAT_DEF, AGENT_HEARTBEAT_DEF],
  bridgePost,
);

describe('mailbox-bridge — POST /mailbox/ack-many empty-array acceptance boundary', () => {
  it('rejects non-object body on /mailbox/send', async () => {
    const res = await http('POST', '/mailbox/send', null, auth());
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects array body on /mailbox/send', async () => {
    const res = await http('POST', '/mailbox/send', [], auth());
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await fetch(`${baseUrl}/mailbox/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth(),
      },
      body: '{this is not json',
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(400);
  });
});

describe('mailbox-bridge — auth gating for mutations', () => {
  it('returns 401 for a mutation without a token', async () => {
    const res = await http('POST', '/mailbox/send', {
      from: 'x',
      to: 'y',
      type: 'note',
      subject: 's',
      body: 'b',
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for a mutation with a malformed Authorization header', async () => {
    const res = await http(
      'POST',
      '/mailbox/send',
      {
        from: 'x',
        to: 'y',
        type: 'note',
        subject: 's',
        body: 'b',
      },
      wrongAuth(),
    );
    expect(res.status).toBe(401);
  });
});
