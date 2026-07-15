import { beforeEach, describe, expect, it, vi } from 'vitest';

const undiciMocks = vi.hoisted(() => ({
  agentOptions: [] as unknown[],
  fetch: vi.fn(),
}));

vi.mock('undici', () => ({
  Agent: class {
    constructor(options: unknown) {
      undiciMocks.agentOptions.push(options);
    }

    destroy(): void {}
  },
  fetch: undiciMocks.fetch,
}));

vi.mock('node:dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:dns/promises')>()),
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

import { guardedFetch } from '../src/fetch.js';

describe('guarded fetch transport', () => {
  beforeEach(() => {
    undiciMocks.agentOptions.length = 0;
    undiciMocks.fetch.mockReset();
    undiciMocks.fetch.mockResolvedValue({ status: 200 });
  });

  it('pins and reuses the Undici dispatcher on HTTP/1.1', async () => {
    const signal = new AbortController().signal;
    await guardedFetch('https://example.com/', 0, signal);
    await guardedFetch('https://example.com/second', 0, signal);

    expect(undiciMocks.agentOptions).toEqual([
      {
        allowH2: false,
        connect: { lookup: expect.any(Function) },
      },
    ]);
    expect(undiciMocks.fetch).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ dispatcher: expect.any(Object) }),
    );
  });
});
