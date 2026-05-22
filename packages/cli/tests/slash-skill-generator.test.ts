import { describe, expect, it, vi } from 'vitest';
import { buildSkillGeneratorCommand } from '../src/slash-commands/skill-generator.js';

function fakeOpts(skillLoader: unknown = undefined) {
  return { skillLoader } as never;
}

function fakeLoader(overrides: Record<string, unknown> = {}) {
  return {
    listEntries: vi.fn().mockResolvedValue([]),
    find: vi.fn(),
    readBody: vi.fn(),
    ...overrides,
  };
}

describe('buildSkillGeneratorCommand', () => {
  it('exposes /skill-gen with help and description', () => {
    const cmd = buildSkillGeneratorCommand(fakeOpts());
    expect(cmd.name).toBe('skill-gen');
    expect(cmd.help).toBeDefined();
    expect(cmd.description).toBeDefined();
  });

  it('list without loader reports unavailable', async () => {
    const cmd = buildSkillGeneratorCommand(fakeOpts());
    const res = await cmd.run('list');
    expect(res?.message).toContain('No skill loader');
  });

  it('list (and ls alias) report empty when no skills', async () => {
    const cmd = buildSkillGeneratorCommand(fakeOpts(fakeLoader()));
    expect((await cmd.run('list'))?.message).toContain('No skills found');
    expect((await cmd.run('ls'))?.message).toContain('No skills found');
  });

  it('list renders entries with source-glyph icons', async () => {
    const loader = fakeLoader({
      listEntries: vi.fn().mockResolvedValue([
        { name: 'proj-skill', source: 'project', trigger: 'when project' },
        { name: 'user-skill', source: 'user', trigger: 'when user' },
        { name: 'pkg-skill', source: 'bundled', trigger: 'when bundled' },
      ]),
    });
    const cmd = buildSkillGeneratorCommand(fakeOpts(loader));
    const res = await cmd.run('list');
    const msg = res?.message ?? '';
    expect(msg).toContain('📁');
    expect(msg).toContain('👤');
    expect(msg).toContain('📦');
    expect(msg).toContain('proj-skill');
    expect(msg).toContain('user-skill');
    expect(msg).toContain('pkg-skill');
  });

  it('edit without loader reports unavailable', async () => {
    const cmd = buildSkillGeneratorCommand(fakeOpts());
    const res = await cmd.run('edit something');
    expect(res?.message).toContain('No skill loader');
  });

  it('edit on unknown name reports not found', async () => {
    const loader = fakeLoader({ find: vi.fn().mockResolvedValue(undefined) });
    const cmd = buildSkillGeneratorCommand(fakeOpts(loader));
    const res = await cmd.run('edit mystery');
    expect(res?.message).toContain('not found');
  });

  it('edit returns formatted skill body when found', async () => {
    const loader = fakeLoader({
      find: vi.fn().mockResolvedValue({ path: '/skills/x/SKILL.md' }),
      readBody: vi.fn().mockResolvedValue('# X\nBody contents'),
    });
    const cmd = buildSkillGeneratorCommand(fakeOpts(loader));
    const res = await cmd.run('edit x');
    expect(res?.message).toContain('Skill: x');
    expect(res?.message).toContain('Path: /skills/x/SKILL.md');
    expect(res?.message).toContain('# X');
  });

  it('default (no subcommand) returns runText to launch AI-guided flow', async () => {
    const cmd = buildSkillGeneratorCommand(fakeOpts());
    const res = await cmd.run('');
    expect(res?.message).toContain('AI will guide you');
    expect(res?.runText).toMatch(/skill-creator|guide me/i);
  });

  it('arbitrary text triggers the AI-guided flow too', async () => {
    const cmd = buildSkillGeneratorCommand(fakeOpts());
    const res = await cmd.run('help me');
    expect(res?.runText).toBeTruthy();
  });
});
