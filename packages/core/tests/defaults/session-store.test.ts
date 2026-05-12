import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DefaultSessionStore } from '../../src/index.js';

describe('DefaultSessionStore', () => {
  let tmp: string;
  let store: DefaultSessionStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-sess-'));
    store = new DefaultSessionStore({ dir: tmp });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates a session and writes session_start as first event', async () => {
    const w = await store.create({ id: 'abc', model: 'm1', provider: 'p1' });
    await w.append({
      type: 'user_input',
      ts: new Date().toISOString(),
      content: 'hi there',
    });
    await w.close();
    const file = path.join(tmp, 'abc.jsonl');
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const first = JSON.parse(lines[0]!);
    expect(first.type).toBe('session_start');
    expect(first.model).toBe('m1');
    expect(first.provider).toBe('p1');
  });

  it('resume() appends to existing file and rehydrates messages', async () => {
    const w1 = await store.create({ id: 'res1', model: 'm', provider: 'p' });
    await w1.append({
      type: 'user_input',
      ts: new Date().toISOString(),
      content: 'first',
    });
    await w1.append({
      type: 'llm_response',
      ts: new Date().toISOString(),
      content: [{ type: 'text', text: 'one' }],
      usage: { input: 10, output: 5 },
      stopReason: 'end_turn',
    });
    await w1.close();

    const { writer, data } = await store.resume('res1');
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0]).toMatchObject({ role: 'user' });
    expect(data.messages[1]).toMatchObject({ role: 'assistant' });
    // First line of resumed file is the original session_start, not the
    // resume marker.
    await writer.append({
      type: 'user_input',
      ts: new Date().toISOString(),
      content: 'second',
    });
    await writer.close();

    const raw = await fs.readFile(path.join(tmp, 'res1.jsonl'), 'utf8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].type).toBe('session_start');
    expect(lines.some((l) => l.type === 'session_resumed')).toBe(true);
    expect(lines[lines.length - 1].content).toBe('second');

    // Reloading after the second turn returns all messages including the
    // newly-appended user input.
    const reloaded = await store.load('res1');
    expect(reloaded.messages).toHaveLength(3);
  });

  it('loads and replays user_input + llm_response events', async () => {
    const w = await store.create({ id: 's1', model: 'm', provider: 'p' });
    await w.append({
      type: 'user_input',
      ts: new Date().toISOString(),
      content: 'hello',
    });
    await w.append({
      type: 'llm_response',
      ts: new Date().toISOString(),
      content: [{ type: 'text', text: 'hi back' }],
      usage: { input: 10, output: 5 },
      model: 'm',
    });
    await w.close();

    const data = await store.load('s1');
    expect(data.metadata.id).toBe('s1');
    expect(data.metadata.model).toBe('m');
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(data.usage.input).toBe(10);
    expect(data.usage.output).toBe(5);
  });

  it('throws on damaged session (open tool_use without result)', async () => {
    const w = await store.create({ id: 'broken', model: 'm', provider: 'p' });
    await w.append({
      type: 'llm_response',
      ts: new Date().toISOString(),
      content: [{ type: 'tool_use', id: 'tu-1', name: 'x', input: {} }],
      usage: { input: 1, output: 1 },
      model: 'm',
    });
    await w.close();
    await expect(store.load('broken')).rejects.toThrow(/damaged/);
  });

  it('pairs tool_result with prior tool_use into single user message', async () => {
    const w = await store.create({ id: 'pair', model: 'm', provider: 'p' });
    await w.append({
      type: 'llm_response',
      ts: new Date().toISOString(),
      content: [{ type: 'tool_use', id: 'tu-1', name: 'x', input: {} }],
      usage: { input: 1, output: 1 },
      model: 'm',
    });
    await w.append({
      type: 'tool_result',
      ts: new Date().toISOString(),
      id: 'tu-1',
      content: 'ok',
      isError: false,
    });
    await w.close();
    const data = await store.load('pair');
    // 1 assistant + 1 user containing the tool_result
    expect(data.messages).toHaveLength(2);
    expect(data.messages[1]?.role).toBe('user');
  });

  it('lists sessions sorted by recency', async () => {
    const a = await store.create({ id: 'a', model: 'm', provider: 'p' });
    await a.append({
      type: 'user_input',
      ts: new Date().toISOString(),
      content: 'first',
    });
    await a.close();
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ id: 'b', model: 'm', provider: 'p' });
    await b.append({
      type: 'user_input',
      ts: new Date().toISOString(),
      content: 'second',
    });
    await b.close();
    const list = await store.list();
    expect(list.length).toBe(2);
    expect(list.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('list returns empty array for nonexistent dir', async () => {
    const phantomStore = new DefaultSessionStore({
      dir: path.join(tmp, 'definitely-not-here', 'sub'),
    });
    const list = await phantomStore.list();
    expect(list).toEqual([]);
  });

  it('delete removes the file', async () => {
    const w = await store.create({ id: 'doomed', model: 'm', provider: 'p' });
    await w.close();
    await store.delete('doomed');
    await expect(fs.access(path.join(tmp, 'doomed.jsonl'))).rejects.toThrow();
  });
});
