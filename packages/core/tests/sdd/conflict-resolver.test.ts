import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import {
  makePreferSideConflictResolver,
  resolveConflictText,
  hasConflictMarkers,
} from '../../src/sdd/conflict-resolver.js';
import type { TaskNode } from '../../src/types/task-graph.js';

const TWO_WAY = ['top', '<<<<<<< HEAD', 'ours-1', '=======', 'theirs-1', '>>>>>>> branch', 'bottom'].join(
  '\n',
);
const DIFF3 = [
  'top',
  '<<<<<<< HEAD',
  'ours-1',
  '||||||| base',
  'base-1',
  '=======',
  'theirs-1',
  '>>>>>>> branch',
  'bottom',
].join('\n');

const task = { id: 't1', title: 'T', metadata: {} } as unknown as TaskNode;

describe('resolveConflictText', () => {
  it('keeps the incoming (theirs) side', () => {
    expect(resolveConflictText(TWO_WAY, 'incoming')).toBe('top\ntheirs-1\nbottom');
  });
  it('keeps the base (ours) side', () => {
    expect(resolveConflictText(TWO_WAY, 'base')).toBe('top\nours-1\nbottom');
  });
  it('handles diff3 markers (drops the |||| base section)', () => {
    expect(resolveConflictText(DIFF3, 'incoming')).toBe('top\ntheirs-1\nbottom');
    expect(resolveConflictText(DIFF3, 'base')).toBe('top\nours-1\nbottom');
  });
  it('resolves multiple hunks and leaves no markers', () => {
    const txt = `${TWO_WAY}\n${TWO_WAY}`;
    const out = resolveConflictText(txt, 'incoming');
    expect(hasConflictMarkers(out)).toBe(false);
    expect(out.match(/theirs-1/g)?.length).toBe(2);
  });
  it('leaves clean text untouched', () => {
    expect(resolveConflictText('a\nb\nc', 'incoming')).toBe('a\nb\nc');
  });
});

describe('makePreferSideConflictResolver', () => {
  it('rewrites conflicted files on disk and returns true', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cr-'));
    try {
      writeFileSync(path.join(dir, 'a.txt'), TWO_WAY);
      const resolver = makePreferSideConflictResolver('incoming');
      const ok = await resolver({ task, conflictFiles: ['a.txt'], cwd: dir });
      expect(ok).toBe(true);
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('top\ntheirs-1\nbottom');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false for an empty file list or an unreadable file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cr-'));
    try {
      const resolver = makePreferSideConflictResolver('base');
      expect(await resolver({ task, conflictFiles: [], cwd: dir })).toBe(false);
      expect(await resolver({ task, conflictFiles: ['missing.txt'], cwd: dir })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
