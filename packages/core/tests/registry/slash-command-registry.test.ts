import { describe, it, expect } from 'vitest';
import { SlashCommandRegistry } from '../../src/registry/slash-command-registry.js';
import type { Context } from '../../src/core/context.js';

describe('SlashCommandRegistry', () => {
  it('dispatch returns null for non-slash', async () => {
    const r = new SlashCommandRegistry();
    expect(await r.dispatch('hello', {} as Context)).toBeNull();
  });

  it('dispatch returns message for unknown', async () => {
    const r = new SlashCommandRegistry();
    const res = await r.dispatch('/nope', {} as Context);
    expect(res?.message).toMatch(/Unknown/);
  });

  it('dispatches with args', async () => {
    const r = new SlashCommandRegistry();
    let received = '';
    r.register({
      name: 'echo',
      description: 'echo',
      async run(args) {
        received = args;
      },
    });
    await r.dispatch('/echo hi there', {} as Context);
    expect(received).toBe('hi there');
  });

  it('aliases route to same command', async () => {
    const r = new SlashCommandRegistry();
    let calls = 0;
    r.register({
      name: 'exit',
      aliases: ['q', 'quit'],
      description: 'exit',
      async run() {
        calls++;
      },
    });
    await r.dispatch('/exit', {} as Context);
    await r.dispatch('/q', {} as Context);
    await r.dispatch('/quit', {} as Context);
    expect(calls).toBe(3);
  });

  it('rejects duplicate', () => {
    const r = new SlashCommandRegistry();
    r.register({ name: 'x', description: '', async run() {} });
    expect(() => r.register({ name: 'x', description: '', async run() {} })).toThrow();
  });
});
