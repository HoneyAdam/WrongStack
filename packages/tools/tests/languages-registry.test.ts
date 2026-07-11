import { describe, expect, it } from 'vitest';
import {
  type LanguageProfile,
  LanguageProfileRegistry,
  languageProfileRegistry,
  PRIMARY_LANGUAGE_PROFILES,
  validateLanguageProfile,
} from '../src/languages/index.js';

const validProfile = (): LanguageProfile => ({
  id: 'go',
  displayName: 'Example Go',
  extensions: ['.go'],
  lspLanguageIds: ['go'],
  detectors: [{ kind: 'manifest', filename: 'go.mod', weight: 90 }],
  ignoredDirectories: ['vendor'],
  packageManagers: ['go'],
  executables: ['go'],
  operations: {
    syntax: async () => ({
      status: 'unavailable',
      profileId: 'go',
      workspaceId: 'fixture',
      operation: 'syntax',
      reason: 'fixture',
    }),
  },
});

describe('LanguageProfileRegistry', () => {
  it('ships unique immutable primary profiles', () => {
    const profiles = languageProfileRegistry.list();
    expect(profiles.map((profile) => profile.id)).toEqual([
      'typescript',
      'javascript',
      'go',
      'rust',
      'php',
      'csharp',
      'python',
      'java',
      'ruby',
      'c',
      'cpp',
      'swift',
      'dart',
      'elixir',
      'shell',
    ]);
    expect(new Set(profiles.map((profile) => profile.id)).size).toBe(profiles.length);
    for (const profile of profiles) {
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.detectors)).toBe(true);
      expect(Object.isFrozen(profile.operations)).toBe(true);
      expect(validateLanguageProfile(profile)).toEqual([]);
    }
    expect(PRIMARY_LANGUAGE_PROFILES).toHaveLength(6);
  });

  it('rejects duplicate ids', () => {
    const registry = new LanguageProfileRegistry([validProfile()]);
    expect(() => registry.register(validProfile())).toThrow(/already registered/);
  });

  it('rejects unsafe detector and executable declarations', () => {
    const invalid = {
      ...validProfile(),
      id: 'Bad Id',
      detectors: [{ kind: 'manifest', filename: '../go.mod', weight: 101 }],
      executables: ['go;calc'],
    } as unknown as LanguageProfile;
    expect(validateLanguageProfile(invalid)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/id/),
        expect.stringMatching(/weights/),
        expect.stringMatching(/basename/),
        expect.stringMatching(/executable/),
      ]),
    );
    expect(() => new LanguageProfileRegistry([invalid])).toThrow(/Invalid language profile/);
  });

  it('copies and freezes mutable profile collections on registration', () => {
    const input = validProfile();
    const extensions = input.extensions as string[];
    const registry = new LanguageProfileRegistry([input]);
    extensions.push('.mod');
    expect(registry.get('go')?.extensions).toEqual(['.go']);
  });
});
