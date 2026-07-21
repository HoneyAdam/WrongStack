import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DefaultSessionReader } from '../../src/storage/session-reader.js';
import { DefaultSessionStore } from '../../src/storage/session-store.js';

const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123';
const sessionDirs: string[] = [];

async function seedLegacySession(): Promise<{ dir: string; id: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-legacy-session-'));
  sessionDirs.push(dir);
  const id = 'legacy-plaintext';
  const file = path.join(dir, `${id}.jsonl`);
  const ts = '2026-07-21T12:00:00.000Z';
  const events = [
    { type: 'session_start', ts, id, model: 'model', provider: 'provider' },
    { type: 'user_input', ts, content: `legacy user secret ${SECRET}` },
    {
      type: 'llm_response',
      ts,
      content: [{ type: 'text', text: `legacy model echo ${SECRET}` }],
      stopReason: 'end_turn',
      usage: { input: 1, output: 1 },
    },
    { type: 'tool_result', ts, toolUseId: 'tool-1', content: { nested: SECRET } },
    {
      type: 'session_end',
      ts,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    },
  ];
  await fs.writeFile(file, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  return { dir, id, file };
}

afterEach(async () => {
  await Promise.all(
    sessionDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('legacy session read scrubbing', () => {
  it('scrubs before store caches, message projections, streaming search, and summaries', async () => {
    const { dir, id, file } = await seedLegacySession();
    const store = new DefaultSessionStore({ dir });

    const first = await store.load(id);
    const cached = await store.load(id);
    const streamed = await store.searchEvents(id, () => true);
    const summaries = await store.list();

    expect(await fs.readFile(file, 'utf8')).toContain(SECRET);
    for (const value of [first, cached, streamed, summaries]) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain(SECRET);
      expect(serialized).toContain('[REDACTED:anthropic_key]');
    }
  });

  it('prevents plaintext leaks through replay, search, query, and export APIs', async () => {
    const { dir, id } = await seedLegacySession();
    const reader = new DefaultSessionReader({ store: new DefaultSessionStore({ dir }) });

    const replayed = [];
    for await (const event of reader.replay(id)) replayed.push(event);
    const secretHits = await reader.search({ query: SECRET }, id);
    const query = await reader.query();
    const jsonExport = await reader.export(id, { format: 'json' });
    const textExport = await reader.export(id, { format: 'text' });

    expect(secretHits).toEqual([]);
    for (const value of [replayed, query, jsonExport, textExport]) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      expect(serialized).not.toContain(SECRET);
    }
    expect(JSON.stringify(replayed)).toContain('[REDACTED:anthropic_key]');
  });
});
