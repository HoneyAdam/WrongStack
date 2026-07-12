import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import {
  type ConfirmDecision,
  type ConnectionContext,
  type PendingConfirm,
  handleAbort,
  handlePing,
  handleToolConfirmResult,
  handleUserMessage,
} from '../../src/webui-server/ws-handlers/connection.js';
import type { WsServerMessage } from '../../src/webui-server/ws-handlers/index.js';

/**
 * PR 5k of Issue #30: connection-level ws-handler unit tests
 * (user_message / abort / ping / tool.confirm_result). A fake agent
 * drives the run path; the abort/confirm maps are real Maps so the
 * per-socket scoping and the finally-block cleanup are exercised
 * directly.
 */

const WS_A = { id: 'a' } as never as WebSocket;
const WS_B = { id: 'b' } as never as WebSocket;

type RunResult = {
  status: string;
  iterations: number;
  finalText: string;
  error?: { code: string; message: string; recoverable: boolean };
};

/** Minimal tool shape that passes the runtime's isLikelyVisionTool heuristic
 *  (auto permission, non-mutating, vision-ish name, image key in schema). */
function makeVisionTool(describeResult: string) {
  return {
    name: 'zai-vision',
    description: 'Analyze an image and describe it',
    permission: 'auto',
    mutating: false,
    inputSchema: { type: 'object', properties: { image: {}, prompt: {} } },
    execute: async () => describeResult,
  };
}

function makeCtx(
  run?: (content: unknown, opts: { signal: AbortSignal }) => Promise<RunResult>,
  { vision = true, visionTools = [] as ReturnType<typeof makeVisionTool>[] } = {},
): {
  ctx: ConnectionContext;
  sent: Array<{ ws: WebSocket; msg: WsServerMessage }>;
  abortControllers: Map<WebSocket, AbortController>;
  pendingConfirms: Map<string, PendingConfirm>;
} {
  const sent: Array<{ ws: WebSocket; msg: WsServerMessage }> = [];
  const abortControllers = new Map<WebSocket, AbortController>();
  const pendingConfirms = new Map<string, PendingConfirm>();
  const ctx: ConnectionContext = {
    opts: {
      agent: {
        run: run ?? (async () => ({ status: 'completed', iterations: 1, finalText: 'ok' })),
        ctx: { provider: { id: 'prov', capabilities: { vision } }, model: 'mod' },
        tools: {
          list: () => visionTools,
          get: (name: string) => visionTools.find((t) => t.name === name),
        },
      } as never,
    },
    abortControllers,
    pendingConfirms,
    send: (ws, msg) => sent.push({ ws, msg }),
    broadcast: () => {},
    log: () => {},
  };
  return { ctx, sent, abortControllers, pendingConfirms };
}

// 1×1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const lastFor = (
  sent: Array<{ ws: WebSocket; msg: WsServerMessage }>,
  ws: WebSocket,
  type: string,
) => sent.filter((s) => s.ws === ws && s.msg.type === type).at(-1)?.msg;

describe('handleUserMessage', () => {
  it('rejects an overlapping run on the same socket without calling the agent', async () => {
    let ran = false;
    const t = makeCtx(async () => {
      ran = true;
      return { status: 'completed', iterations: 1, finalText: 'ok' };
    });
    // Simulate an in-flight run for WS_A.
    t.abortControllers.set(WS_A, new AbortController());
    await handleUserMessage(t.ctx, WS_A, 'hi');
    expect(ran).toBe(false);
    expect(lastFor(t.sent, WS_A, 'error')?.payload).toMatchObject({
      phase: 'agent.run',
      message: expect.stringContaining('already in progress'),
    });
  });

  it('runs the agent, maps the result, and clears the controller', async () => {
    let seenSignal: AbortSignal | undefined;
    const t = makeCtx(async (_content, opts) => {
      seenSignal = opts.signal;
      // The controller must be registered for the duration of the run.
      expect(t.abortControllers.has(WS_A)).toBe(true);
      return { status: 'completed', iterations: 3, finalText: 'done' };
    });
    await handleUserMessage(t.ctx, WS_A, 'hello');
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(lastFor(t.sent, WS_A, 'run.result')?.payload).toEqual({
      status: 'completed',
      iterations: 3,
      finalText: 'done',
      error: undefined,
    });
    // Cleared in the finally block.
    expect(t.abortControllers.has(WS_A)).toBe(false);
  });

  it('maps a structured run error', async () => {
    const t = makeCtx(async () => ({
      status: 'error',
      iterations: 2,
      finalText: '',
      error: { code: 'E_X', message: 'boom', recoverable: true },
    }));
    await handleUserMessage(t.ctx, WS_A, 'go');
    expect(lastFor(t.sent, WS_A, 'run.result')?.payload).toMatchObject({
      status: 'error',
      error: { code: 'E_X', message: 'boom', recoverable: true },
    });
  });

  it('reports a thrown run error and still clears the controller', async () => {
    const t = makeCtx(async () => {
      throw new Error('kaboom');
    });
    await handleUserMessage(t.ctx, WS_A, 'go');
    expect(lastFor(t.sent, WS_A, 'error')?.payload).toMatchObject({
      phase: 'agent.run',
      message: 'kaboom',
    });
    expect(t.abortControllers.has(WS_A)).toBe(false);
  });

  it('converts attached images to ImageBlocks ahead of the text', async () => {
    let seenInput: unknown;
    const t = makeCtx(async (input) => {
      seenInput = input;
      return { status: 'completed', iterations: 1, finalText: 'ok' };
    });
    await handleUserMessage(t.ctx, WS_A, 'what is this?', undefined, {
      images: [{ data: PNG_B64, mediaType: 'image/png' }],
    });
    expect(seenInput).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } },
      { type: 'text', text: 'what is this?' },
    ]);
  });

  it('rejects images on a non-vision model with no adapter, without running the agent', async () => {
    let ran = false;
    const t = makeCtx(
      async () => {
        ran = true;
        return { status: 'completed', iterations: 1, finalText: 'ok' };
      },
      { vision: false },
    );
    await handleUserMessage(t.ctx, WS_A, 'see this', undefined, {
      images: [{ data: PNG_B64, mediaType: 'image/png' }],
    });
    expect(ran).toBe(false);
    expect(lastFor(t.sent, WS_A, 'error')?.payload).toMatchObject({
      phase: 'user_message',
      code: 'vision_unsupported',
      message: expect.stringContaining('does not support image input'),
    });
    // Controller cleaned up so the next message isn't rejected as overlapping.
    expect(t.abortControllers.has(WS_A)).toBe(false);
  });

  it('routes images through a vision adapter tool on a non-vision model', async () => {
    let seenInput: unknown;
    const t = makeCtx(
      async (input) => {
        seenInput = input;
        return { status: 'completed', iterations: 1, finalText: 'ok' };
      },
      { vision: false, visionTools: [makeVisionTool('a solid red square')] },
    );
    await handleUserMessage(t.ctx, WS_A, 'what is this?', undefined, {
      images: [{ data: PNG_B64, mediaType: 'image/png' }],
    });
    expect(lastFor(t.sent, WS_A, 'error')).toBeUndefined();
    expect(seenInput).toEqual([
      { type: 'text', text: '[Image 1 analyzed via zai-vision]\na solid red square' },
      { type: 'text', text: 'what is this?' },
    ]);
  });

  it('rejects invalid image payloads with a user_message error', async () => {
    let ran = false;
    const t = makeCtx(async () => {
      ran = true;
      return { status: 'completed', iterations: 1, finalText: 'ok' };
    });
    await handleUserMessage(t.ctx, WS_A, 'bad', undefined, {
      images: [{ data: '!!!not-base64!!!', mediaType: 'image/png' }],
    });
    expect(ran).toBe(false);
    expect(lastFor(t.sent, WS_A, 'error')?.payload).toMatchObject({
      phase: 'user_message',
      message: expect.stringContaining('base64'),
    });
  });

  it('passes plain text through unchanged when no images are attached', async () => {
    let seenInput: unknown;
    const t = makeCtx(async (input) => {
      seenInput = input;
      return { status: 'completed', iterations: 1, finalText: 'ok' };
    });
    await handleUserMessage(t.ctx, WS_A, 'just text', undefined, {});
    expect(seenInput).toBe('just text');
  });

  it('lets a second socket start its own run concurrently', async () => {
    const t = makeCtx();
    t.abortControllers.set(WS_A, new AbortController()); // A is busy
    await handleUserMessage(t.ctx, WS_B, 'hi from B');
    // B was not rejected — it produced a run.result.
    expect(lastFor(t.sent, WS_B, 'run.result')).toBeDefined();
    expect(lastFor(t.sent, WS_B, 'error')).toBeUndefined();
  });
});

describe('handleAbort', () => {
  it('aborts only the requesting socket and notifies it', () => {
    const t = makeCtx();
    const ctrlA = new AbortController();
    const ctrlB = new AbortController();
    t.abortControllers.set(WS_A, ctrlA);
    t.abortControllers.set(WS_B, ctrlB);
    handleAbort(t.ctx, WS_A);
    expect(ctrlA.signal.aborted).toBe(true);
    expect(ctrlB.signal.aborted).toBe(false);
    expect(lastFor(t.sent, WS_A, 'error')?.payload).toMatchObject({
      phase: 'abort',
      message: 'User aborted',
    });
  });

  it('is a no-op on the controller when none is in flight, but still notifies', () => {
    const t = makeCtx();
    expect(() => handleAbort(t.ctx, WS_A)).not.toThrow();
    expect(lastFor(t.sent, WS_A, 'error')?.payload).toMatchObject({ phase: 'abort' });
  });
});

describe('handlePing', () => {
  it('replies with pong', () => {
    const t = makeCtx();
    handlePing(t.ctx, WS_A);
    expect(lastFor(t.sent, WS_A, 'pong')).toBeDefined();
  });
});

describe('handleToolConfirmResult', () => {
  it('resolves and removes the pending confirm', () => {
    const t = makeCtx();
    let got: ConfirmDecision | undefined;
    t.pendingConfirms.set('c1', {
      resolve: (d) => {
        got = d;
      },
    });
    handleToolConfirmResult(t.ctx, 'c1', 'always');
    expect(got).toBe('always');
    expect(t.pendingConfirms.has('c1')).toBe(false);
  });

  it('ignores an unknown confirm id', () => {
    const t = makeCtx();
    expect(() => handleToolConfirmResult(t.ctx, 'missing', 'yes')).not.toThrow();
  });
});
