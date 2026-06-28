/**
 * Tests for the ACP client bench engine. ACPSession is mocked so no real
 * agent is spawned; we assert the grading + report logic.
 */
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startMock = vi.fn();
const promptMock = vi.fn();
const getAgentInfoMock = vi.fn(() => ({ name: 'fake', version: '1.0.0' }));
const closeMock = vi.fn(async () => {});

vi.mock('../src/client/acp-session.js', () => ({
  ACPSession: { start: (...a: unknown[]) => startMock(...a) },
  ACPSessionError: class extends Error {},
  textContent: (text: string) => ({ type: 'text', text }),
}));

import { renderAcpBenchText, runAcpBench } from '../src/index.js';

const MARKER = 'ACP_OK_TEST';
const cmdFor = (id: string) => ({ command: id, args: [], role: id });

function sessionOk() {
  startMock.mockResolvedValue({
    getAgentInfo: getAgentInfoMock,
    prompt: promptMock,
    close: closeMock,
  });
}

function promptReply(text: string) {
  return { text, hasText: text.length > 0, stopReason: 'end_turn', toolCalls: [], diffs: [], thoughts: '' };
}

beforeEach(() => {
  startMock.mockReset();
  promptMock.mockReset();
  closeMock.mockClear();
  getAgentInfoMock.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('runAcpBench grading', () => {
  it('passes when handshake + prompt + marker all succeed', async () => {
    sessionOk();
    promptMock.mockResolvedValue(promptReply(`${MARKER}`));
    const res = await runAcpBench({
      agentIds: ['gemini-cli'],
      resolveCmd: cmdFor,
      marker: MARKER,
    });
    const r = res.results[0]!;
    expect(r.status).toBe('pass');
    expect(r.checks.map((c) => `${c.name}:${c.ok}`)).toEqual([
      'handshake:true',
      'prompt:true',
      'marker:true',
    ]);
    expect(r.agentInfo?.name).toBe('fake');
    expect(res.summary.pass).toBe(1);
    expect(closeMock).toHaveBeenCalled();
  });

  it('is partial when the marker is missing but the prompt returned text', async () => {
    sessionOk();
    promptMock.mockResolvedValue(promptReply('here is an unrelated answer'));
    const res = await runAcpBench({ agentIds: ['x'], resolveCmd: cmdFor, marker: MARKER });
    const r = res.results[0]!;
    expect(r.status).toBe('partial');
    expect(r.checks.find((c) => c.name === 'marker')?.ok).toBe(false);
    expect(res.summary.partial).toBe(1);
  });

  it('is partial when the prompt returns no text', async () => {
    sessionOk();
    promptMock.mockResolvedValue(promptReply(''));
    const res = await runAcpBench({ agentIds: ['x'], resolveCmd: cmdFor, marker: MARKER });
    expect(res.results[0]!.status).toBe('partial');
    expect(res.results[0]!.checks.find((c) => c.name === 'prompt')?.ok).toBe(false);
  });

  it('fails when the handshake throws', async () => {
    startMock.mockRejectedValue(new Error('spawn ENOENT'));
    const res = await runAcpBench({ agentIds: ['x'], resolveCmd: cmdFor, marker: MARKER });
    const r = res.results[0]!;
    expect(r.status).toBe('fail');
    expect(r.checks).toEqual([{ name: 'handshake', ok: false, detail: 'spawn ENOENT' }]);
    expect(r.reason).toBe('spawn ENOENT');
    expect(res.summary.fail).toBe(1);
  });

  it('is partial when the prompt throws after a good handshake', async () => {
    sessionOk();
    promptMock.mockRejectedValue(new Error('prompt timed out'));
    const res = await runAcpBench({ agentIds: ['x'], resolveCmd: cmdFor, marker: MARKER });
    const r = res.results[0]!;
    expect(r.status).toBe('partial');
    expect(r.checks.find((c) => c.name === 'handshake')?.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'prompt')?.ok).toBe(false);
  });

  it('skips an unknown agent (resolveCmd → null)', async () => {
    const res = await runAcpBench({
      agentIds: ['nope'],
      resolveCmd: () => null,
      marker: MARKER,
    });
    expect(res.results[0]!.status).toBe('skipped');
    expect(startMock).not.toHaveBeenCalled();
    expect(res.summary.skipped).toBe(1);
  });

  it('runs the fs check when requested and grades it from the reply', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'acp-bench-'));
    try {
      sessionOk();
      // 1st prompt = marker echo; 2nd prompt = file contents echo.
      promptMock
        .mockResolvedValueOnce(promptReply(MARKER))
        .mockResolvedValueOnce(promptReply(`the file says FILE_${MARKER}`));
      const res = await runAcpBench({
        agentIds: ['x'],
        resolveCmd: cmdFor,
        projectRoot: dir,
        checkFs: true,
        marker: MARKER,
      });
      const r = res.results[0]!;
      expect(r.status).toBe('pass');
      expect(r.checks.find((c) => c.name === 'fs')?.ok).toBe(true);
      expect(promptMock).toHaveBeenCalledTimes(2);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('benches multiple agents and rolls up the summary', async () => {
    startMock.mockImplementation(async () => ({
      getAgentInfo: getAgentInfoMock,
      prompt: promptMock,
      close: closeMock,
    }));
    promptMock.mockResolvedValue(promptReply(MARKER));
    const res = await runAcpBench({
      agentIds: ['a', 'b', 'a'], // dedup → a, b
      resolveCmd: cmdFor,
      marker: MARKER,
      concurrency: 2,
    });
    expect(res.results.map((r) => r.agentId)).toEqual(['a', 'b']);
    expect(res.summary.pass).toBe(2);
  });
});

describe('renderAcpBenchText', () => {
  it('renders a graded report with per-agent checks and a summary', async () => {
    sessionOk();
    promptMock.mockResolvedValue(promptReply(MARKER));
    const res = await runAcpBench({ agentIds: ['gemini-cli'], resolveCmd: cmdFor, marker: MARKER });
    const text = renderAcpBenchText(res);
    expect(text).toContain('ACP client bench:');
    expect(text).toContain('gemini-cli');
    expect(text).toContain('PASS');
    expect(text).toContain('Bench summary: 1 pass');
  });
});
