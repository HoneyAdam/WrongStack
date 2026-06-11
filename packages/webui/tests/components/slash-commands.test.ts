import { describe, expect, it } from 'vitest';
import {
  SLASH_COMMANDS,
  detectAtMention,
  matchSlash,
} from '@/components/ChatInput/slash-commands';

describe('ChatInput slash command registry', () => {
  it('only advertises commands with WebUI behavior', () => {
    const names = new Set(SLASH_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]));

    for (const command of [
      '/agents',
      '/compact!',
      '/enhance',
      '/load',
      '/next',
      '/repair',
      '/resume',
      '/suggest',
    ]) {
      expect(names.has(command)).toBe(true);
    }
  });

  it('matches command names and aliases case-insensitively', () => {
    expect(matchSlash('/RES').map((c) => c.name)).toEqual(['/load']);
    expect(matchSlash('/comp').map((c) => c.name)).toEqual(['/compact', '/compact!']);
  });

  it('detects whitespace-delimited @ mentions at the cursor', () => {
    expect(detectAtMention('@src/App', 8)).toEqual({ start: 0, query: 'src/App' });
    expect(detectAtMention('open @pack', 10)).toEqual({ start: 5, query: 'pack' });
    expect(detectAtMention('email@domain.test', 16)).toBeNull();
    expect(detectAtMention('open @src and keep typing', 14)).toBeNull();
  });
});
