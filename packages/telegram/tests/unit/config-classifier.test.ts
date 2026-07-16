import type { TelegramPluginConfig } from '../../src/config.js';
import { describe, expect, it } from 'vitest';
import {
  HOT_RELOAD_KEYS,
  RESTART_REQUIRED_KEYS,
  classifyReload,
  diffConfigKeys,
} from '../../src/config-classifier.js';

const baseConfig: TelegramPluginConfig = {
  botToken: 'test:token',
};

describe('classifyReload', () => {
  it.each([
    ...Array.from(HOT_RELOAD_KEYS).map((k) => [k, 'hot'] as const),
    ...Array.from(RESTART_REQUIRED_KEYS).map((k) => [k, 'restart-required'] as const),
  ])('classifies %s as %s', (key, expected) => {
    expect(classifyReload(key)).toBe(expected);
  });

  it('defaults unknown keys to restart-required so new fields are never silently hot', () => {
    // Force the cast: if TelegramPluginConfig gains a new field, this
    // compile-time cast surfaces the update path. At runtime the classifier
    // must default to the conservative answer until the field is mapped.
    expect(classifyReload('notARegisteredKey' as keyof TelegramPluginConfig)).toBe(
      'restart-required',
    );
  });

  it('HOT_RELOAD_KEYS and RESTART_REQUIRED_KEYS do not overlap', () => {
    for (const key of HOT_RELOAD_KEYS) {
      expect(RESTART_REQUIRED_KEYS.has(key)).toBe(false);
    }
  });
});

describe('HOT_RELOAD_KEYS rationale', () => {
  it.each([
    'inboundMode',
    'allowedUsers',
    'allowedChats',
    'allowedOutboundChats',
    'pollIntervalSec',
    'notifyOnSessionEnd',
    'notifyOnDelegate',
    'longToolThresholdMs',
    'maxMessageLength',
  ])('treats %s as hot because it is read on every relevant call', (key) => {
    expect(HOT_RELOAD_KEYS.has(key as keyof TelegramPluginConfig)).toBe(true);
  });

  it.each([
    'botToken',
    'notifyChatId',
    'offsetStoragePath',
    'singleInstanceLock',
    'outboundQueuePerChat',
    'outboundQueueConcurrency',
  ])('treats %s as restart-required because it is consumed at setup time', (key) => {
    expect(RESTART_REQUIRED_KEYS.has(key as keyof TelegramPluginConfig)).toBe(true);
  });
});

describe('diffConfigKeys', () => {
  it('reports no changes when both configs are identical', () => {
    expect(diffConfigKeys(baseConfig, baseConfig)).toEqual([]);
  });

  it('flags a changed hot key as hot', () => {
    const next: TelegramPluginConfig = { ...baseConfig, pollIntervalSec: 5 };
    expect(diffConfigKeys(baseConfig, next)).toEqual([
      { key: 'pollIntervalSec', classification: 'hot' },
    ]);
  });

  it('flags a changed restart-required key as restart-required', () => {
    const next: TelegramPluginConfig = { ...baseConfig, notifyChatId: 123 };
    expect(diffConfigKeys(baseConfig, next)).toEqual([
      { key: 'notifyChatId', classification: 'restart-required' },
    ]);
  });

  it('classifies a removed hot key as hot (every call re-reads the allowlist)', () => {
    const previous: TelegramPluginConfig = { ...baseConfig, allowedUsers: [1, 2] };
    const next: TelegramPluginConfig = { ...baseConfig };
    const diff = diffConfigKeys(previous, next);
    expect(diff).toEqual([{ key: 'allowedUsers', classification: 'hot' }]);
  });

  it('classifies an added hot key as hot (next call uses the new value)', () => {
    const previous: TelegramPluginConfig = { ...baseConfig };
    const next: TelegramPluginConfig = { ...baseConfig, maxMessageLength: 8000 };
    const diff = diffConfigKeys(previous, next);
    expect(diff).toEqual([{ key: 'maxMessageLength', classification: 'hot' }]);
  });

  it('treats array contents element-wise (a reorder is a change)', () => {
    const previous: TelegramPluginConfig = { ...baseConfig, allowedChats: [1, 2, 3] };
    const next: TelegramPluginConfig = { ...baseConfig, allowedChats: [3, 2, 1] };
    expect(diffConfigKeys(previous, next)).toEqual([
      { key: 'allowedChats', classification: 'hot' },
    ]);
  });

  it('reports multiple changes in a single diff', () => {
    const previous: TelegramPluginConfig = {
      ...baseConfig,
      pollIntervalSec: 2,
      notifyChatId: 100,
      allowedChats: [1],
    };
    const next: TelegramPluginConfig = {
      ...baseConfig,
      pollIntervalSec: 5,
      notifyChatId: 200,
      allowedChats: [1, 2],
    };
    const diff = diffConfigKeys(previous, next);
    expect(diff).toEqual([
      { key: 'pollIntervalSec', classification: 'hot' },
      { key: 'notifyChatId', classification: 'restart-required' },
      { key: 'allowedChats', classification: 'hot' },
    ]);
  });
});
