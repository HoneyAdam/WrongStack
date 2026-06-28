import type { Logger } from '@wrongstack/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramBot } from '../../src/bot.js';
import { makeTelegramApproveTool } from '../../src/tools/telegram-approve.js';

const log: Logger = {
  level: 'debug',
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child() {
    return this;
  },
};

function makeBot() {
  return new TelegramBot({
    token: 'test:token',
    pollIntervalSec: 60,
    allowedUsers: new Set<string>(),
    allowedChats: new Set<string>(),
    bufferSize: 10,
    log,
    onMessage: vi.fn(),
  });
}

function makeTool(bot: TelegramBot, chatId = '999') {
  return makeTelegramApproveTool({
    bot,
    getDefaultChatId: () => chatId,
    maxMessageLength: 4000,
    log,
  });
}

describe('telegram_approve tool', () => {
  let _originalFetch: typeof globalThis.fetch;
  let sentBodies: string[];

  beforeEach(() => {
    _originalFetch = globalThis.fetch;
    sentBodies = [];
    // Default: sendMessage succeeds, no polls return anything.
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.body) sentBodies.push(String(init.body));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
      });
    }) as never as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = _originalFetch;
  });

  it('returns approved=false and fromUser=timeout when no callback arrives', async () => {
    const bot = makeBot();
    const tool = makeTool(bot);

    const start = Date.now();
    const result = await tool.execute({ prompt: 'Continue?', timeout_ms: 150 });
    const elapsed = Date.now() - start;

    expect(result.approved).toBe(false);
    expect(result.from).toBe('timeout');
    expect(result.prompt_message_id).toBe(42);
    expect(elapsed).toBeGreaterThanOrEqual(140);

    // One outbound sendMessage with the prompt + inline keyboard.
    const prompts = sentBodies.filter((b) => b.includes('Continue?'));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('inline_keyboard');
    expect(prompts[0]).toContain(':yes');
    expect(prompts[0]).toContain(':no');
  });

  it('truncates details to fit Telegram', async () => {
    const bot = makeBot();
    const tool = makeTool(bot);

    await tool.execute({
      prompt: 'Go?',
      details: 'a'.repeat(2000),
      timeout_ms: 100,
    });

    const prompt = sentBodies.find((b) => b.includes('Go?'))!;
    expect(prompt.length).toBeLessThan(2000); // well under Telegram's 4096
  });

  it('throws when no chat_id is provided and no default is set', async () => {
    const bot = makeBot();
    const tool = makeTelegramApproveTool({
      bot,
      getDefaultChatId: () => undefined,
      maxMessageLength: 4000,
      log,
    });

    await expect(tool.execute({ prompt: 'x' })).rejects.toThrow('No chat_id provided');
  });

  it('caps timeout_ms to the documented 600 000 ms ceiling', async () => {
    const bot = makeBot();
    const tool = makeTool(bot);

    const start = Date.now();
    const result = await tool.execute({ prompt: 'x', timeout_ms: 10 });
    const elapsed = Date.now() - start;

    expect(result.approved).toBe(false);
    expect(result.from).toBe('timeout');
    expect(elapsed).toBeGreaterThanOrEqual(950); // not 10 ms — clamped >=1000 ms minimum
    expect(elapsed).toBeLessThan(1500);
  });

  it('resolves approved=true when a matching yes-key arrives via bot.awaitCallback', async () => {
    const bot = makeBot();
    const tool = makeTool(bot);

    // Kick off the approval request, then race a waiter that fires yes.
    const execPromise = tool.execute({ prompt: 'ok?', timeout_ms: 5_000 });

    // Wait a tick so the tool has registered its two awaitCallback keys.
    await new Promise((r) => setTimeout(r, 5));

    // Find the registered yes key from the outbound prompt body so we
    // simulate the exact key the bot will see.
    const prompt = sentBodies.find((b) => b.includes('ok?'))!;
    const yesMatch = prompt.match(/"callback_data":"(approve:[^"]+:yes)"/);
    expect(yesMatch).not.toBeNull();
    const yesKey = yesMatch![1]!;

    await (
      bot as unknown as {
        dispatchCallback(cq: {
          id: string;
          from?: { username?: string; first_name?: string };
          data?: string;
        }): Promise<void>;
      }
    ).dispatchCallback({
      id: 'cb-approve',
      from: { username: 'alice' },
      data: yesKey,
    });

    const result = await execPromise;
    expect(result.approved).toBe(true);
    expect(result.from).toBe('alice');
  });
});
