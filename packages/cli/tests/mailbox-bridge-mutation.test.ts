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

interface Mutation {
  name: string;
  route: string;
  validBody: Record<string, unknown>;
  mutate: (body: Record<string, unknown>) => void;
  rejectContains: string;
}

async function runMutation({
  name,
  route,
  validBody,
  mutate,
  rejectContains,
}: Mutation): Promise<void> {
  const baseline = await countMessages();
  const body = JSON.parse(JSON.stringify(validBody)) as Record<string, unknown>;
  mutate(body);
  const res = await http('POST', route, body, auth());
  expect(res.status, `mutation "${name}" expected 400 but got ${res.status}`).toBe(400);
  const err = (res.body as { error?: { code?: string; message?: string } }).error;
  expect(err?.code, `mutation "${name}" expected VALIDATION_ERROR envelope`).toBe('VALIDATION_ERROR');
  expect(err?.message ?? '', `mutation "${name}" message`).toContain(rejectContains);
  const after = await countMessages();
  expect(after, `mutation "${name}" leaked side effects`).toBe(baseline);
}

describe('mailbox-bridge — POST /mailbox/send validator mutations', () => {
  const validSend = {
    from: 'mut-sender',
    to: 'mut-receiver',
    type: 'note',
    subject: 's',
    body: 'b',
  };

  it.each([
    {
      rejectContains: '"from"',
      mutate: (b: Record<string, unknown>): void => {
        delete b['from'];
      },
    },
    {
      rejectContains: '"type"',
      mutate: (b: Record<string, unknown>): void => {
        b['type'] = 'not-a-real-type';
      },
    },
    {
      rejectContains: '"priority"',
      mutate: (b: Record<string, unknown>): void => {
        b['priority'] = 'urgent';
      },
    },
    {
      rejectContains: 'ttlMs',
      mutate: (b: Record<string, unknown>): void => {
        b['ttlMs'] = 0;
      },
    },
    {
      rejectContains: 'ttlMs',
      mutate: (b: Record<string, unknown>): void => {
        b['ttlMs'] = 1.5;
      },
    },
    {
      rejectContains: '"from"',
      mutate: (b: Record<string, unknown>): void => {
        b['from'] = 'leader';
      },
    },
  ])('rejects malformed `send` body (case: $rejectContains)', async (row) => {
    await runMutation({
      name: `send ${row.rejectContains}`,
      route: '/mailbox/send',
      validBody: validSend,
      mutate: row.mutate,
      rejectContains: row.rejectContains,
    });
  });
});

describe('mailbox-bridge — POST /mailbox/query validator mutations', () => {
  const validQuery = { to: 'someone', limit: 5 };

  it.each([
    {
      rejectContains: 'limit',
      mutate: (b: Record<string, unknown>): void => {
        b['limit'] = 0;
      },
    },
    {
      rejectContains: 'limit',
      mutate: (b: Record<string, unknown>): void => {
        b['limit'] = -3;
      },
    },
    {
      rejectContains: 'limit',
      mutate: (b: Record<string, unknown>): void => {
        b['limit'] = 1.5;
      },
    },
    {
      rejectContains: 'limit',
      mutate: (b: Record<string, unknown>): void => {
        b['limit'] = 'ten';
      },
    },
    {
      rejectContains: 'minPriority',
      mutate: (b: Record<string, unknown>): void => {
        b['minPriority'] = 'urgent';
      },
    },
    {
      rejectContains: 'incompleteOnly',
      mutate: (b: Record<string, unknown>): void => {
        b['incompleteOnly'] = 'yes';
      },
    },
  ])('rejects malformed `query` body (case: $rejectContains)', async (row) => {
    await runMutation({
      name: `query ${row.rejectContains}`,
      route: '/mailbox/query',
      validBody: validQuery,
      mutate: row.mutate,
      rejectContains: row.rejectContains,
    });
  });
});

describe('mailbox-bridge — POST /mailbox/check validator mutations', () => {
  const validCheck = { agentId: 'mut-check-agent', baseId: 'mut-check-base', limit: 10 };

  it.each([
    {
      rejectContains: '"agentId"',
      mutate: (b: Record<string, unknown>): void => {
        delete b['agentId'];
      },
    },
    {
      rejectContains: 'limit',
      mutate: (b: Record<string, unknown>): void => {
        b['limit'] = 0;
      },
    },
    {
      rejectContains: 'limit',
      mutate: (b: Record<string, unknown>): void => {
        b['limit'] = -7;
      },
    },
    {
      rejectContains: 'limit',
      mutate: (b: Record<string, unknown>): void => {
        b['limit'] = 0.5;
      },
    },
  ])('rejects malformed `check` body (case: $rejectContains)', async (row) => {
    await runMutation({
      name: `check ${row.rejectContains}`,
      route: '/mailbox/check',
      validBody: validCheck,
      mutate: row.mutate,
      rejectContains: row.rejectContains,
    });
  });
});

describe('mailbox-bridge — POST /mailbox/ack validator mutations', () => {
  const validAck = { messageId: 'placeholder', readerId: 'mut-reader', read: true };

  it('rejects missing messageId', async () => {
    await runMutation({
      name: 'ack missing messageId',
      route: '/mailbox/ack',
      validBody: validAck,
      mutate: (b) => {
        delete b['messageId'];
      },
      rejectContains: 'messageId',
    });
  });

  it('rejects missing readerId', async () => {
    await runMutation({
      name: 'ack missing readerId',
      route: '/mailbox/ack',
      validBody: validAck,
      mutate: (b) => {
        delete b['readerId'];
      },
      rejectContains: 'readerId',
    });
  });

  it('rejects non-string messageId', async () => {
    await runMutation({
      name: 'ack non-string messageId',
      route: '/mailbox/ack',
      validBody: validAck,
      mutate: (b) => {
        b['messageId'] = 7;
      },
      rejectContains: 'messageId',
    });
  });
});

describe('mailbox-bridge — POST /mailbox/ack-many validator mutations', () => {
  const validAckMany = {
    acks: [{ messageId: 'placeholder', readerId: 'mut-reader', read: true }],
  };

  // Note: `acks: []` is accepted (a documented no-op — `ackMany([])` returns
  // []), so it's not in the mutation matrix.
  it.each([
    {
      rejectContains: '"acks"',
      mutate: (b: Record<string, unknown>): void => {
        b['acks'] = 'not-an-array';
      },
    },
    {
      rejectContains: 'messageId',
      mutate: (b: Record<string, unknown>): void => {
        (b['acks'] as Array<Record<string, unknown>>)[0]!.messageId = 7;
      },
    },
  ])('rejects malformed `ack-many` body (case: $rejectContains)', async (row) => {
    await runMutation({
      name: `ack-many ${row.rejectContains}`,
      route: '/mailbox/ack-many',
      validBody: validAckMany,
      mutate: row.mutate,
      rejectContains: row.rejectContains,
    });
  });
});

describe('mailbox-bridge — POST /mailbox/ack-many empty-array acceptance boundary', () => {
  const valid = {
    acks: [{ messageId: 'placeholder', readerId: 'mut-reader', read: true }],
  };

  it('accepts an empty acks array as a documented no-op', async () => {
    const baseline = await countMessages();
    const res = await http('POST', '/mailbox/ack-many', { acks: [] }, auth());
    expect(res.status).toBe(200);
    const data = res.body as { count?: number; updated?: unknown };
    expect(data).toHaveProperty('count', 0);
    expect(data).toHaveProperty('updated');
    expect(await countMessages(), 'empty ack-many leaked side effects').toBe(baseline);
  });

  it('rejects acks as null', async () => {
    await runMutation({
      name: 'ack-many null acks',
      route: '/mailbox/ack-many',
      validBody: valid,
      mutate: (b) => { b['acks'] = null; },
      rejectContains: '"acks"',
    });
  });

  it('rejects missing acks field', async () => {
    await runMutation({
      name: 'ack-many missing acks',
      route: '/mailbox/ack-many',
      validBody: valid,
      mutate: (b) => { delete b['acks']; },
      rejectContains: '"acks"',
    });
  });
});

describe('mailbox-bridge — POST /mailbox/agents/register validator mutations', () => {
  const validAgentReg = {
    agentId: 'mut-agent',
    sessionId: 'external',
    name: 'Mut Agent',
    role: 'external',
    pid: 12345,
  };

  it.each([
    {
      rejectContains: '"pid"',
      mutate: (b: Record<string, unknown>): void => {
        b['pid'] = 0;
      },
    },
    {
      rejectContains: '"pid"',
      mutate: (b: Record<string, unknown>): void => {
        b['pid'] = -3;
      },
    },
    {
      rejectContains: '"pid"',
      mutate: (b: Record<string, unknown>): void => {
        b['pid'] = 1.5;
      },
    },
    {
      rejectContains: '"pid"',
      mutate: (b: Record<string, unknown>): void => {
        b['pid'] = '12345';
      },
    },
    {
      rejectContains: 'reserved',
      mutate: (b: Record<string, unknown>): void => {
        b['agentId'] = 'hq';
      },
    },
  ])('rejects malformed agent registration (case: $rejectContains)', async (row) => {
    await runMutation({
      name: `agent-register ${row.rejectContains}`,
      route: '/mailbox/agents/register',
      validBody: validAgentReg,
      mutate: row.mutate,
      rejectContains: row.rejectContains,
    });
  });
});

describe('mailbox-bridge — POST /mailbox/register-client validator mutations', () => {
  const validClientReg = { clientId: 'mut-client', name: 'Mut Client', pid: 12345 };

  it.each([
    {
      rejectContains: '"pid"',
      mutate: (b: Record<string, unknown>): void => {
        b['pid'] = 0;
      },
    },
    {
      rejectContains: '"pid"',
      mutate: (b: Record<string, unknown>): void => {
        b['pid'] = -1;
      },
    },
    {
      rejectContains: '"pid"',
      mutate: (b: Record<string, unknown>): void => {
        b['pid'] = 'abc';
      },
    },
  ])('rejects malformed client registration (case: $rejectContains)', async (row) => {
    await runMutation({
      name: `client-register ${row.rejectContains}`,
      route: '/mailbox/register-client',
      validBody: validClientReg,
      mutate: row.mutate,
      rejectContains: row.rejectContains,
    });
  });
});

describe('mailbox-bridge — body shape failures', () => {
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
