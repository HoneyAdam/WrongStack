import { describe, expect, it } from 'vitest';
import { shouldPushSubmittedHistory } from '../src/submit-history.js';

describe('shouldPushSubmittedHistory', () => {
  it('ignores blank input after trimming', () => {
    expect(shouldPushSubmittedHistory('   ')).toEqual({
      push: false,
      route: 'empty',
      trimmed: '',
    });
  });

  it('records normal free-text submissions', () => {
    expect(shouldPushSubmittedHistory('hello world')).toEqual({
      push: true,
      route: 'normal',
      trimmed: 'hello world',
    });
  });

  // ── slash commands with arguments → saved ──────────────────────────

  it('records slash commands after trimming outer whitespace', () => {
    expect(shouldPushSubmittedHistory('   /fix lint error   ')).toEqual({
      push: true,
      route: 'slash',
      trimmed: '/fix lint error',
    });
  });

  it('treats slash variants with arguments as normal slash-command history entries', () => {
    expect(shouldPushSubmittedHistory('/prompt search auth')).toEqual({
      push: true,
      route: 'slash',
      trimmed: '/prompt search auth',
    });
  });

  it('records any slash command that carries at least one argument word', () => {
    expect(shouldPushSubmittedHistory('/setmodel anthropic/claude-sonnet')).toEqual({
      push: true,
      route: 'slash',
      trimmed: '/setmodel anthropic/claude-sonnet',
    });
  });

  // ── bare slash commands (no arguments) → NOT saved ─────────────────

  it('ignores bare "/" (just the slash prefix)', () => {
    expect(shouldPushSubmittedHistory('/')).toEqual({
      push: false,
      route: 'slash',
      trimmed: '/',
    });
  });

  it('ignores bare "/image" and "/paste-image" (no arguments)', () => {
    expect(shouldPushSubmittedHistory('/image')).toEqual({
      push: false,
      route: 'slash',
      trimmed: '/image',
    });
    expect(shouldPushSubmittedHistory('/paste-image')).toEqual({
      push: false,
      route: 'slash',
      trimmed: '/paste-image',
    });
  });

  it('ignores bare "/prompt" and "/prompts-browse" (no arguments)', () => {
    expect(shouldPushSubmittedHistory('/prompt')).toEqual({
      push: false,
      route: 'slash',
      trimmed: '/prompt',
    });
    expect(shouldPushSubmittedHistory('/prompts-browse')).toEqual({
      push: false,
      route: 'slash',
      trimmed: '/prompts-browse',
    });
  });

  it('ignores bare command names from the slash menu (no arguments)', () => {
    expect(shouldPushSubmittedHistory('/help')).toEqual({
      push: false,
      route: 'slash',
      trimmed: '/help',
    });
    expect(shouldPushSubmittedHistory('/clear')).toEqual({
      push: false,
      route: 'slash',
      trimmed: '/clear',
    });
  });

  // ── Telegram token security ────────────────────────────────────────

  it('suppresses legacy Telegram setup commands that contain bot tokens', () => {
    expect(shouldPushSubmittedHistory('/telegram-setup 123456:superSecretToken 42')).toEqual({
      push: false,
      route: 'slash',
      trimmed: '/telegram-setup 123456:superSecretToken 42',
    });
    expect(shouldPushSubmittedHistory('/tg-setup 123456:superSecretToken')).toMatchObject({
      push: false,
    });
  });
});
