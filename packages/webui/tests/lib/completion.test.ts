import { describe, expect, it } from 'vitest';
import {
  buildCompletionCacheKey,
  currentToken,
  getLanguage,
  shouldAllowCompletionLlm,
  shouldAskCompletionServer,
} from '@/lib/completion';

describe('completion helpers', () => {
  describe('getLanguage', () => {
    it('maps common code extensions to Monaco languages', () => {
      expect(getLanguage('src/App.tsx')).toBe('typescript');
      expect(getLanguage('server/index.js')).toBe('javascript');
      expect(getLanguage('scripts/deploy.ps1')).toBe('powershell');
    });

    it('falls back to plaintext for unknown extensions', () => {
      expect(getLanguage('README.unknown')).toBe('plaintext');
      expect(getLanguage('Dockerfile')).toBe('plaintext');
    });
  });

  describe('currentToken', () => {
    it('extracts the token immediately before the cursor', () => {
      expect(currentToken('repo.findBy')).toBe('findBy');
      expect(currentToken('const $user_1')).toBe('$user_1');
    });

    it('returns empty text after punctuation or whitespace', () => {
      expect(currentToken('repo.')).toBe('');
      expect(currentToken('const user = ')).toBe('');
    });
  });

  describe('shouldAskCompletionServer', () => {
    it('asks on explicit trigger characters regardless of token length', () => {
      expect(shouldAskCompletionServer({ triggerCharacter: '.' }, '')).toBe(true);
      expect(shouldAskCompletionServer({ triggerCharacter: '_' }, 'f')).toBe(true);
    });

    it('uses a token-length threshold for automatic suggestions', () => {
      expect(shouldAskCompletionServer({}, 'fi')).toBe(false);
      expect(shouldAskCompletionServer({}, 'fin')).toBe(true);
    });
  });

  describe('shouldAllowCompletionLlm', () => {
    it('allows LLM completions for member access', () => {
      expect(shouldAllowCompletionLlm({ triggerCharacter: '.' }, '')).toBe(true);
    });

    it('keeps low-value trigger completions on local sources only', () => {
      expect(shouldAllowCompletionLlm({ triggerCharacter: '_' }, 'find')).toBe(false);
    });

    it('allows semantic repository and accessor prefixes without a trigger', () => {
      expect(shouldAllowCompletionLlm({}, 'findBy')).toBe(true);
      expect(shouldAllowCompletionLlm({}, 'create')).toBe(true);
      expect(shouldAllowCompletionLlm({}, 'getUser')).toBe(true);
      expect(shouldAllowCompletionLlm({}, 'set_Status')).toBe(true);
    });

    it('does not call the LLM for ordinary identifier prefixes', () => {
      expect(shouldAllowCompletionLlm({}, 'filter')).toBe(false);
      expect(shouldAllowCompletionLlm({}, 'get')).toBe(false);
    });
  });

  describe('buildCompletionCacheKey', () => {
    const base = {
      filePath: 'src/user.ts',
      language: 'typescript',
      lineNumber: 12,
      column: 8,
      versionId: 3,
      triggerCharacter: '.',
      linePrefix: 'repo.',
      suffix: 'findMany();',
    };

    it('is stable for identical inputs', () => {
      expect(buildCompletionCacheKey(base)).toBe(buildCompletionCacheKey({ ...base }));
    });

    it('changes when cursor-sensitive fields change', () => {
      const original = buildCompletionCacheKey(base);
      expect(buildCompletionCacheKey({ ...base, column: 9 })).not.toBe(original);
      expect(buildCompletionCacheKey({ ...base, versionId: 4 })).not.toBe(original);
      expect(buildCompletionCacheKey({ ...base, suffix: 'save();' })).not.toBe(original);
    });

    it('bounds surrounding text in the cache key', () => {
      const longPrefix = `${'a'.repeat(200)}repo.`;
      const withExtraPrefix = `${'b'.repeat(40)}${longPrefix}`;
      expect(buildCompletionCacheKey({ ...base, linePrefix: longPrefix })).toBe(
        buildCompletionCacheKey({ ...base, linePrefix: withExtraPrefix }),
      );
    });
  });
});
