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

  it('records slash commands after trimming outer whitespace', () => {
    expect(shouldPushSubmittedHistory('   /fix lint error   ')).toEqual({
      push: true,
      route: 'slash',
      trimmed: '/fix lint error',
    });
  });

  it('routes /image and /paste-image through the paste-image branch', () => {
    expect(shouldPushSubmittedHistory('/image')).toEqual({
      push: true,
      route: 'paste-image',
      trimmed: '/image',
    });
    expect(shouldPushSubmittedHistory('/paste-image')).toEqual({
      push: true,
      route: 'paste-image',
      trimmed: '/paste-image',
    });
  });

  it('routes bare prompt-browser commands through the prompt-picker branch', () => {
    expect(shouldPushSubmittedHistory('/prompt')).toEqual({
      push: true,
      route: 'prompt-picker',
      trimmed: '/prompt',
    });
    expect(shouldPushSubmittedHistory('/prompts-browse')).toEqual({
      push: true,
      route: 'prompt-picker',
      trimmed: '/prompts-browse',
    });
  });

  it('treats slash variants with arguments as normal slash-command history entries', () => {
    expect(shouldPushSubmittedHistory('/prompt search auth')).toEqual({
      push: true,
      route: 'slash',
      trimmed: '/prompt search auth',
    });
  });

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
