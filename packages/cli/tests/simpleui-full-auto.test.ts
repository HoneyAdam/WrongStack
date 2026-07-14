import type { Config } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import {
  applySimpleUiFullAutoProfile,
  configureSimpleUiRuntimeContext,
} from '../src/boot/simpleui-full-auto.js';

describe('SimpleUI full-auto launch profile', () => {
  it('overrides ordinary runtime limits while preserving safety configuration', () => {
    const config = Object.freeze({
      yolo: false,
      autonomy: { defaultMode: 'off' },
      tools: Object.freeze({
        disabledTools: ['bash', 'write'],
        restrictToProjectRoot: true,
        exec: { deny: ['shutdown'] },
      }),
    }) as Config;
    const flags: Record<string, string | boolean> = {
      simpleui: true,
      webui: true,
      'full-auto': true,
      'no-director': true,
      'no-autonomy': true,
    };

    const resolved = applySimpleUiFullAutoProfile(config, flags);

    expect(resolved).not.toBe(config);
    expect(resolved.yolo).toBe(true);
    expect(resolved.tools).toMatchObject({
      disabledTools: [],
      restrictToProjectRoot: true,
      exec: { deny: ['shutdown'] },
    });
    expect(resolved.autonomy?.defaultMode).toBe('off');
    expect(flags).toMatchObject({
      yolo: true,
      director: true,
      'no-director': false,
      autonomy: 'auto',
      'no-autonomy': false,
    });
  });

  it('leaves config and flags untouched when the profile is absent', () => {
    const config = { yolo: false, tools: { disabledTools: ['bash'] } } as Config;
    const flags = { simpleui: true, webui: true };

    expect(applySimpleUiFullAutoProfile(config, flags)).toBe(config);
    expect(flags).toEqual({ simpleui: true, webui: true });
  });

  it('does not apply outside the SimpleUI surface', () => {
    const config = { yolo: false, tools: { disabledTools: ['bash'] } } as Config;
    const flags = { webui: true, 'full-auto': true };

    expect(applySimpleUiFullAutoProfile(config, flags)).toBe(config);
    expect(flags).toEqual({ webui: true, 'full-auto': true });
  });
});

describe('SimpleUI runtime context profile', () => {
  it('keeps coordination telemetry in background mode for every SimpleUI launch', () => {
    const meta: Record<string, unknown> = {};

    configureSimpleUiRuntimeContext(meta, { simpleui: true, webui: true });

    expect(meta).toEqual({
      source: 'webui',
      surface: 'simpleui',
      coordinationContextMode: 'background',
    });
  });

  it('does not change other surfaces', () => {
    const meta: Record<string, unknown> = { source: 'cli' };
    configureSimpleUiRuntimeContext(meta, { webui: true });
    expect(meta).toEqual({ source: 'cli' });
  });
});
