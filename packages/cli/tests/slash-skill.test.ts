import { describe, expect, it, vi } from 'vitest';
import { buildSkillCommand } from '../src/slash-commands/skill.js';

function fakeLoader(overrides: Record<string, unknown> = {}) {
  return {
    listEntries: vi.fn().mockResolvedValue([]),
    find: vi.fn(),
    readBody: vi.fn(),
    ...overrides,
  };
}

function opts(skillLoader: unknown = undefined) {
  return { skillLoader } as never;
}

describe('buildSkillCommand', () => {
  it('reports missing loader gracefully', async () => {
    const cmd = buildSkillCommand(opts());
    const res = await cmd.run('');
    expect(res?.message).toContain('No skill loader');
  });

  it('reports "no skills" when listEntries is empty', async () => {
    const cmd = buildSkillCommand(opts(fakeLoader()));
    const res = await cmd.run('');
    expect(res?.message).toContain('No skills found');
  });

  it('lists available skills with triggers and scope tag', async () => {
    const loader = fakeLoader({
      listEntries: vi.fn().mockResolvedValue([
        { name: 'a', trigger: 'when X', scope: ['project', 'shared', 'user'] },
        { name: 'b', trigger: 'when Y', scope: [] },
      ]),
    });
    const cmd = buildSkillCommand(opts(loader));
    const res = await cmd.run('');
    expect(res?.message).toContain('Available skills');
    expect(res?.message).toContain('a');
    expect(res?.message).toContain('b');
    expect(res?.message).toContain('when X');
    expect(res?.message).toContain('when Y');
    // First 3 scope tokens
    expect(res?.message).toContain('project, shared, user');
  });

  it('reports "not found" when find returns undefined', async () => {
    const loader = fakeLoader({ find: vi.fn().mockResolvedValue(undefined) });
    const cmd = buildSkillCommand(opts(loader));
    const res = await cmd.run('mystery');
    expect(res?.message).toContain('not found');
  });

  it('returns body when skill exists', async () => {
    const loader = fakeLoader({
      find: vi.fn().mockResolvedValue({ name: 'real' }),
      readBody: vi.fn().mockResolvedValue('# Body\nDetails'),
    });
    const cmd = buildSkillCommand(opts(loader));
    const res = await cmd.run('real');
    expect(res?.message).toContain('# Body');
    expect(loader.readBody).toHaveBeenCalledWith('real');
  });

  it('trims arg before lookup', async () => {
    const loader = fakeLoader({
      find: vi.fn().mockResolvedValue({ name: 'real' }),
      readBody: vi.fn().mockResolvedValue('ok'),
    });
    const cmd = buildSkillCommand(opts(loader));
    await cmd.run('  real  ');
    expect(loader.find).toHaveBeenCalledWith('real');
  });
});
