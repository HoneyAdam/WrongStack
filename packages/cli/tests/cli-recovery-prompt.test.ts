/**
 * Tests for cli-recovery-prompt.ts — interactive recovery decision prompt.
 */
import { describe, expect, it, vi } from 'vitest';
import { promptRecovery } from '../src/cli-recovery-prompt.js';

// Minimal mock renderer
function mockRenderer() {
  const lines: string[] = [];
  return {
    writeInfo: vi.fn((msg: string) => lines.push(msg)),
    lines,
    // The renderer needs writeInfo for autoRecover and non-TTY paths.
    // For interactive readKey path, we use a different branch.
  };
}

// Minimal mock reader
function mockReader(keyResponse: string) {
  return {
    readKey: vi.fn().mockResolvedValue(keyResponse),
  };
}

const baseAbandoned = {
  sessionId: 'sess_test123',
  messageCount: 15,
  ageMs: 120_000, // 2 minutes
};

describe('promptRecovery', () => {
  it('auto-recovers when autoRecover is true', async () => {
    const renderer = mockRenderer();
    const reader = mockReader('');
    const result = await promptRecovery(
      reader as never,
      renderer as never,
      baseAbandoned as never,
      true,
    );
    expect(result).toBe('resume');
    expect(renderer.writeInfo).toHaveBeenCalledWith(
      expect.stringContaining('Auto-resuming (--recover)'),
    );
  });

  it('skips when stdin is not a TTY', async () => {
    const renderer = mockRenderer();
    const reader = mockReader('');
    const result = await promptRecovery(
      reader as never,
      renderer as never,
      baseAbandoned as never,
      false,
    );
    expect(result).toBe('skip');
    expect(renderer.writeInfo).toHaveBeenCalledWith(
      expect.stringContaining('Non-interactive'),
    );
  });

  it('renders age in seconds when less than 1 minute', async () => {
    const abandoned = { ...baseAbandoned, ageMs: 5_000 }; // 5 seconds
    const renderer = mockRenderer();
    const reader = mockReader('');
    const result = await promptRecovery(
      reader as never,
      renderer as never,
      abandoned as never,
      false,
    );
    expect(result).toBe('skip');
    expect(renderer.writeInfo).toHaveBeenCalledWith(
      expect.stringContaining('5s ago'),
    );
  });

  it('renders age in minutes when less than 60 minutes', async () => {
    const abandoned = { ...baseAbandoned, ageMs: 300_000 }; // 5 minutes
    const renderer = mockRenderer();
    const reader = mockReader('');
    const result = await promptRecovery(
      reader as never,
      renderer as never,
      abandoned as never,
      false,
    );
    expect(result).toBe('skip');
    expect(renderer.writeInfo).toHaveBeenCalledWith(
      expect.stringContaining('5 min ago'),
    );
  });

  it('renders age in hours when >= 60 minutes', async () => {
    const abandoned = { ...baseAbandoned, ageMs: 7_200_000 }; // 2 hours
    const renderer = mockRenderer();
    const reader = mockReader('');
    const result = await promptRecovery(
      reader as never,
      renderer as never,
      abandoned as never,
      false,
    );
    expect(result).toBe('skip');
    expect(renderer.writeInfo).toHaveBeenCalledWith(
      expect.stringContaining('2h ago'),
    );
  });

  it('renders age in seconds for minimal age', async () => {
    const abandoned = { ...baseAbandoned, ageMs: 1000 }; // 1 second
    const renderer = mockRenderer();
    const reader = mockReader('');
    const result = await promptRecovery(
      reader as never,
      renderer as never,
      abandoned as never,
      false,
    );
    expect(result).toBe('skip');
    expect(renderer.writeInfo).toHaveBeenCalledWith(
      expect.stringContaining('1s ago'),
    );
  });
});
