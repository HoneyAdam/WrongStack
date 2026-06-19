import { describe, expect, it } from 'vitest';
import { initCmd } from '../src/subcommands/handlers/init.js';

let writes: string[];
let errors: string[];

function mkDeps(over: Record<string, unknown> = {}) {
  writes = [];
  errors = [];
  return {
    renderer: {
      write: (s: string) => writes.push(s),
      writeError: (s: string) => errors.push(s),
      writeInfo: () => {},
    },
    ...over,
  } as never;
}

describe('initCmd subcommand (deprecated)', () => {
  it('returns 0 without error', async () => {
    const code = await initCmd([], mkDeps());
    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it('prints a deprecation notice pointing to `wstack auth`', async () => {
    await initCmd([], mkDeps());
    const out = writes.join('');
    expect(out).toMatch(/deprecated/i);
    expect(out).toContain('wstack auth');
  });

  it('does not prompt, read input, or load the provider catalog', async () => {
    // The deprecated stub takes no interactive deps; passing none must not throw.
    const code = await initCmd([], mkDeps());
    expect(code).toBe(0);
  });
});
