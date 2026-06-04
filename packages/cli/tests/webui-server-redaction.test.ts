import { EventBus } from '@wrongstack/core/kernel';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWebUI } from '../src/webui-server.js';

const ports = { next: 45_570 };

function nextPort(): number {
  return ports.next++;
}

function waitForMessage(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 5_000);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: 'http://localhost' } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('runWebUI redaction', () => {
  afterEach(() => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('redacts secrets from tool event input/output before broadcasting to WebSocket clients', async () => {
    const port = nextPort();
    const events = new EventBus();
    const serverDone = runWebUI({
      port,
      events,
      session: { id: 'test-session' } as any,
      agent: {
        ctx: {
          model: 'test-model',
          provider: { id: 'test-provider' },
        },
        run: vi.fn(),
      } as any,
    });

    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await waitForMessage(ws, 'session.start');

    const openAiKey = `sk-${'1234567890'.repeat(3)}`;
    const bearer = `Bearer ${'abcdefghijklmnopqrstuvwxyz123456'}`;
    const secondOpenAiKey = `sk-${'abcdefghijklmnopqrstuvwxyz123456'}`;

    events.emit('tool.started', {
      id: 'tool-1',
      name: 'fetch',
      input: { url: `https://example.com?token=${openAiKey}` },
    });
    const started = await waitForMessage(ws, 'tool.started');
    expect(JSON.stringify(started.payload)).not.toContain(openAiKey);
    expect(JSON.stringify(started.payload)).toContain('[REDACTED:openai_key]');

    events.emit('tool.executed', {
      id: 'tool-1',
      name: 'fetch',
      durationMs: 3,
      ok: true,
      input: { authorization: bearer },
      output: `result contains ${secondOpenAiKey}`,
    });
    const executed = await waitForMessage(ws, 'tool.executed');
    expect(JSON.stringify(executed.payload)).not.toContain(bearer);
    expect(JSON.stringify(executed.payload)).not.toContain(secondOpenAiKey);
    expect(JSON.stringify(executed.payload)).toContain('[REDACTED:bearer_token]');
    expect(JSON.stringify(executed.payload)).toContain('[REDACTED:openai_key]');

    ws.close();
    process.emit('SIGTERM');
    await serverDone;
  });
});
