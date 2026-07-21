import { describe, expect, it, vi } from 'vitest';
import {
  CompactionSummaryCache,
  compactionSummaryKey,
} from '../../src/execution/compaction-summary-cache.js';
import type { Message } from '../../src/types/messages.js';

describe('CompactionSummaryCache', () => {
  it('reuses a successful summary and deduplicates concurrent calls', async () => {
    const cache = new CompactionSummaryCache({ capacity: 2 });
    let resolve!: (value: string) => void;
    const create = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );

    const first = cache.getOrCreate('same', create);
    const second = cache.getOrCreate('same', create);
    resolve('compact result');

    await expect(first).resolves.toBe('compact result');
    await expect(second).resolves.toBe('compact result');
    await expect(cache.getOrCreate('same', create)).resolves.toBe('compact result');
    expect(create).toHaveBeenCalledOnce();
  });

  it('does not cache failed summary calls', async () => {
    const cache = new CompactionSummaryCache();
    await expect(
      cache.getOrCreate('retry', async () => Promise.reject(new Error('nope'))),
    ).rejects.toThrow('nope');
    await expect(cache.getOrCreate('retry', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('keys semantic message content without transient token estimates', () => {
    const a: Message[] = [{ role: 'user', content: 'same', _estTokens: 10 }];
    const b: Message[] = [{ role: 'user', content: 'same', _estTokens: 999 }];
    expect(compactionSummaryKey('m', 'p', a)).toBe(compactionSummaryKey('m', 'p', b));
    expect(compactionSummaryKey('m', 'p', a)).not.toBe(compactionSummaryKey('other-model', 'p', b));
  });
});
