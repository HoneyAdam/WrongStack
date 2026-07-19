import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLosslessDigest,
  buildSmartDigest,
  dedupStaleReads,
  eliseOldToolResults,
  enforceHardBudget,
  extractText,
  findExchangeStart,
  findPreserveStart,
  findSafeBoundary,
  hasLargeToolResult,
  hasToolUse,
  scoreMessage,
} from '../../src/execution/compaction-core.js';
import { estimateMessageTokens } from '../../src/utils/token-estimate.js';
import type { Message } from '../../src/types/index.js';

afterEach(() => vi.restoreAllMocks());

const text = (role: Message['role'], t: string): Message =>
  ({ role, content: [{ type: 'text', text: t }] }) as Message;
const strMsg = (role: Message['role'], t: string): Message => ({ role, content: t }) as Message;
const toolUse = (role: Message['role'] = 'assistant'): Message =>
  ({ role, content: [{ type: 'tool_use', id: 'u1', name: 'bash', input: {} }] }) as Message;
const toolResult = (content: unknown, role: Message['role'] = 'user'): Message =>
  ({ role, content: [{ type: 'tool_result', tool_use_id: 'u1', content }] }) as Message;

describe('extractText / hasToolUse / hasLargeToolResult', () => {
  it('extracts text from string and block content', () => {
    expect(extractText(strMsg('user', 'hello'))).toBe('hello');
    expect(extractText(text('user', 'a'))).toBe('a');
    expect(extractText(toolUse())).toBe(''); // no text blocks
  });

  it('detects tool_use blocks', () => {
    expect(hasToolUse(strMsg('user', 'x'))).toBe(false);
    expect(hasToolUse(toolUse())).toBe(true);
    expect(hasToolUse(text('user', 'x'))).toBe(false);
  });

  it('detects large tool results (string and object content)', () => {
    expect(hasLargeToolResult(strMsg('user', 'x'))).toBe(false);
    expect(hasLargeToolResult(toolResult('a'.repeat(4000)))).toBe(true);
    expect(hasLargeToolResult(toolResult({ data: 'b'.repeat(4000) }))).toBe(true);
    expect(hasLargeToolResult(toolResult('short'))).toBe(false);
  });
});

describe('scoreMessage', () => {
  it('scores pure tool I/O as noise (0)', () => {
    expect(scoreMessage(toolUse())).toBe(0);
    expect(scoreMessage(toolResult(''))).toBe(0);
  });

  it('demotes repeated failures: 3rd-4th → 1, 5th+ → 0', () => {
    const failureCounts = new Map<string, number>();
    const fail = () => scoreMessage(text('user', 'Error: ENOENT happened'), { failureCounts });
    expect(fail()).toBe(5); // 1st (error keyword → critical) but failureCounts increments
    fail(); // 2nd
    expect(fail()).toBe(1); // 3rd
    fail(); // 4th
    expect(fail()).toBe(0); // 5th → noise
  });

  it('marks user corrections / stop signals as critical (5)', () => {
    expect(scoreMessage(text('user', 'no, stop that'))).toBe(5);
    expect(scoreMessage(text('user', 'actually revert that'))).toBe(5);
  });

  it('marks error, security, and architecture content as critical (5)', () => {
    expect(scoreMessage(text('assistant', 'a TypeError was thrown'))).toBe(5);
    expect(scoreMessage(text('assistant', 'found a SQL injection vulnerability'))).toBe(5);
    expect(scoreMessage(text('assistant', 'I will refactor the approach here'))).toBe(5);
  });

  it('marks Turkish corrections / errors / decisions as critical (5)', () => {
    // Corrections / stop signals (user role).
    expect(scoreMessage(text('user', 'hayır bu yanlış olmuş'))).toBe(5);
    expect(scoreMessage(text('user', 'dur, geri al bunu'))).toBe(5);
    expect(scoreMessage(text('user', 'yanlis, vazgec'))).toBe(5); // ascii-folded
    // Error language (any role).
    expect(scoreMessage(text('assistant', 'testler başarısız oldu'))).toBe(5);
    expect(scoreMessage(text('user', 'burada bir hata var'))).toBe(5);
    // Architecture / decision (assistant role).
    expect(scoreMessage(text('assistant', 'mimari kararı şöyle veriyorum'))).toBe(5);
    expect(scoreMessage(text('assistant', 'bu tasarim yaklasimini secelim'))).toBe(5);
  });

  it('marks large tool results and grep/list output as low (1)', () => {
    // A large tool result with accompanying text (a bare result with no text is noise).
    const bigWithText: Message = {
      role: 'user',
      content: [
        { type: 'text', text: 'here is the output' },
        { type: 'tool_result', tool_use_id: 'u1', content: 'z'.repeat(4000) },
      ],
    } as Message;
    expect(scoreMessage(bigWithText)).toBe(1);
    expect(scoreMessage(text('user', 'found 12 match in the tree'))).toBe(1);
  });

  it('defaults to medium (3) for normal exchanges', () => {
    expect(scoreMessage(text('user', 'please add a button'))).toBe(3);
    expect(scoreMessage(text('assistant', 'Sure, here is the plan for it'))).toBe(3);
  });
});

describe('buildSmartDigest', () => {
  it('applies tiered treatment and collapses noise', () => {
    const longMedium =
      'First sentence here. Second sentence that should be dropped from the digest entirely.';
    const messages: Message[] = [
      text('user', 'no, stop'), // 5 → verbatim
      text('assistant', longMedium), // 3 → first sentence
      text('user', 'found 7 match in the tree'), // 1 → one-line summary
      toolUse(), // 0 → noise collapsed
      toolUse(), // 0 → noise collapsed
    ];
    const digest = buildSmartDigest(messages);
    expect(digest).toContain('[user]: no, stop');
    expect(digest).toContain('First sentence here.');
    expect(digest).not.toContain('Second sentence');
    expect(digest).toContain('found 7 match');
    expect(digest).toContain('low-importance turn(s) collapsed');
  });

  it('truncates a long single-line low-priority result to one line', () => {
    const longGrep = `found 5 match: ${'a'.repeat(140)}`; // grep → score 1, >100 chars
    const digest = buildSmartDigest([text('user', longGrep)]);
    expect(digest).toContain('…'); // truncated
    expect(digest).toContain('found 5 match');
  });

  it('renders a tool-call marker and handles short text without a sentence break', () => {
    const m: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'quick note' },
        { type: 'tool_use', id: 'u1', name: 'bash', input: {} },
      ],
    } as Message;
    const digest = buildSmartDigest([m]);
    expect(digest).toContain('[1 tool call(s)]');
    expect(digest).toContain('quick note');
  });
});

describe('buildSmartDigest empty / countToolBlocks edge', () => {
  it('skips a message whose display and tool count are both empty', () => {
    // empty string content → score 3, firstSentence('')='' , 0 tool blocks → skipped
    const digest = buildSmartDigest([strMsg('user', ''), text('user', 'real content here')]);
    expect(digest).toContain('real content here');
    expect(digest).not.toContain('[user]: \n'); // the empty one produced no line
  });
});

describe('eliseOldToolResults', () => {
  const big = (n: number): Message =>
    ({
      role: 'user',
      content: [
        { type: 'text', text: 'output below' },
        { type: 'tool_result', tool_use_id: 'u1', content: 'z'.repeat(n) },
      ],
    }) as Message;

  it('elides oversized tool results before the preserved window, keeping text blocks', () => {
    const messages: Message[] = [
      big(8000),
      text('user', 'recent 1'),
      text('assistant', 'recent 2'),
      text('user', 'recent 3'),
    ];
    const res = eliseOldToolResults(messages, { preserveK: 2, eliseThreshold: 100 });
    expect(res.changed).toBe(true);
    expect(res.saved).toBeGreaterThan(0);
    const elided = res.messages[0];
    const blocks = Array.isArray(elided?.content) ? elided.content : [];
    expect(blocks.find((b) => b.type === 'text')).toBeDefined(); // text block preserved (passthrough)
    expect(JSON.stringify(blocks)).toContain('elided');
  });

  it('keeps semantic hints in elided tool result markers', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'u1',
            name: 'grep',
            content: `packages/core/src/execution/compactor.ts:12:boom\nError: failed to parse\n${'z'.repeat(8000)}`,
            is_error: true,
          },
        ],
      } as Message,
      text('user', 'recent'),
    ];

    const res = eliseOldToolResults(messages, { preserveK: 1, eliseThreshold: 100 });

    expect(res.changed).toBe(true);
    expect(JSON.stringify(res.messages[0])).toContain('tool=grep');
    expect(JSON.stringify(res.messages[0])).toContain('packages/core/src/execution/compactor.ts');
    expect(JSON.stringify(res.messages[0])).toContain('Error: failed to parse');
  });

  it('elides oversized old tool_use inputs without breaking the pair id', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'write-1',
            name: 'write',
            input: {
              path: 'src/generated.ts',
              content: 'export const value = 1;\n'.repeat(1200),
              nested: { a: 1, b: 2 },
            },
          },
        ],
      } as Message,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'write-1', content: 'write: ok' }],
      } as Message,
      text('user', 'recent'),
    ];

    const res = eliseOldToolResults(messages, { preserveK: 1, eliseThreshold: 100 });

    expect(res.changed).toBe(true);
    expect(res.saved).toBeGreaterThan(0);
    const first = res.messages[0];
    const block = Array.isArray(first?.content) ? first.content[0] : undefined;
    expect(block).toMatchObject({ type: 'tool_use', id: 'write-1', name: 'write' });
    expect(JSON.stringify(block)).toContain('__elided_tool_input');
    expect(JSON.stringify(block)).toContain('src/generated.ts');
    expect(JSON.stringify(block)).not.toContain(
      'export const value = 1;\\nexport const value = 1;',
    );
  });

  it('does not elide recent oversized tool_use inputs inside the preserved window', () => {
    const input = { content: 'x'.repeat(8000) };
    const messages: Message[] = [
      text('user', 'old'),
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'recent-use', name: 'write', input }],
      } as Message,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'recent-use', content: 'ok' }],
      } as Message,
    ];

    const res = eliseOldToolResults(messages, { preserveK: 2, eliseThreshold: 100 });

    expect(res.changed).toBe(false);
    expect(JSON.stringify(res.messages)).toContain('x'.repeat(100));
  });

  it('returns unchanged when nothing is oversized', () => {
    const messages: Message[] = [big(10), text('user', 'a'), text('user', 'b')];
    const res = eliseOldToolResults(messages, { preserveK: 1, eliseThreshold: 100000 });
    expect(res.changed).toBe(false);
    expect(res.saved).toBe(0);
  });

  it('logs a regression warning under WRONGSTACK_DEBUG when the inner ratio is high', () => {
    const prev = process.env.WRONGSTACK_DEBUG;
    process.env.WRONGSTACK_DEBUG = '1';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 15 tool_result blocks on one message → fullPassInner/fullPass ratio > 10
      const blocks = Array.from({ length: 15 }, (_, i) => ({
        type: 'tool_result' as const,
        tool_use_id: `u${i}`,
        content: i === 0 ? 'z'.repeat(8000) : 'small',
      }));
      const messages: Message[] = [
        { role: 'user', content: blocks } as Message,
        text('user', 'recent'),
      ];
      eliseOldToolResults(messages, { preserveK: 1, eliseThreshold: 100 });
      expect(err).toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.WRONGSTACK_DEBUG;
      else process.env.WRONGSTACK_DEBUG = prev;
    }
  });
});

describe('buildLosslessDigest', () => {
  it('keeps text verbatim, marks tool-only messages, and skips empty ones', () => {
    const messages: Message[] = [
      text('user', 'keep this text'),
      toolUse('assistant'), // tool-only → omitted marker
      strMsg('assistant', ''), // empty + no tools → skipped
    ];
    const digest = buildLosslessDigest(messages);
    expect(digest).toContain('keep this text');
    expect(digest).toContain('tool call(s) omitted');
    expect(digest.split('\n').length).toBe(2); // only the text + tool-only lines
  });
});

describe('findPreserveStart', () => {
  it('walks back K user/assistant turns', () => {
    const messages: Message[] = [
      text('user', '1'),
      text('assistant', '2'),
      text('user', '3'),
      text('assistant', '4'),
    ];
    expect(findPreserveStart(messages, 2)).toBe(2);
    expect(findPreserveStart(messages, 10)).toBe(0); // more than available
  });

  it('widens backward when the preserved window starts on a tool_result', () => {
    const messages: Message[] = [
      text('user', 'old'),
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'u1', name: 'read', input: { path: 'a.ts' } }],
      } as Message,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }],
      } as Message,
    ];

    expect(findPreserveStart(messages, 1)).toBe(1);
  });
});

describe('findSafeBoundary / findExchangeStart', () => {
  it('finds the exchange start for the nearest user-with-text message', () => {
    const messages: Message[] = [
      text('user', 'first task'),
      toolUse('assistant'),
      text('assistant', 'done thinking'), // assistant, no tool use → boundary after it
      text('user', 'second task'),
      toolUse('assistant'),
    ];
    const b = findSafeBoundary(messages, 0, 4);
    expect(b).toBe(3); // start of the 'second task' exchange (after the no-tool assistant)
  });

  it('returns -1 when no user-with-text message exists in range', () => {
    expect(findSafeBoundary([toolUse(), toolUse()], 0, 1)).toBe(-1);
  });

  it('findExchangeStart stops at a prior user message and falls back to 0', () => {
    const messages: Message[] = [text('user', 'a'), text('user', 'b')];
    expect(findExchangeStart(messages, 1)).toBe(0); // prior user at index 0
    // only tool-use assistants before the user index → walk falls through to 0
    expect(findExchangeStart([toolUse('assistant'), toolUse('assistant')], 1)).toBe(0);
  });
});

// ── enforceHardBudget: the no-overflow guarantee ───────────────────────────

describe('enforceHardBudget', () => {
  const bigText = (role: Message['role'], n: number): Message =>
    ({ role, content: [{ type: 'text', text: 'x'.repeat(n) }] }) as Message;

  it('is a no-op when already within budget', () => {
    const msgs = [text('user', 'hello'), text('assistant', 'hi')];
    const before = estimateMessageTokens(msgs);
    const res = enforceHardBudget(msgs, before + 1000, { preserveK: 5 });
    expect(res.changed).toBe(false);
    expect(res.messages).toBe(msgs); // same reference
    expect(res.withinBudget).toBe(true);
  });

  it('trims a single oversized message to fit the budget', () => {
    // One giant message far larger than the budget — no elision target,
    // preserveK protects it, yet the request MUST end up under budget.
    const msgs = [bigText('user', 200_000)];
    const budget = 2_000;
    const res = enforceHardBudget(msgs, budget, { preserveK: 5 });
    expect(res.changed).toBe(true);
    expect(estimateMessageTokens(res.messages)).toBeLessThanOrEqual(budget);
    expect(res.withinBudget).toBe(true);
  });

  it('elides old tool results before truncating text', () => {
    const msgs: Message[] = [
      toolUse('assistant'),
      toolResult('R'.repeat(40_000)),
      text('user', 'recent turn 1'),
      text('assistant', 'recent turn 2'),
      text('user', 'recent turn 3'),
    ];
    const budget = 1_500;
    const res = enforceHardBudget(msgs, budget, { preserveK: 2 });
    expect(res.changed).toBe(true);
    expect(estimateMessageTokens(res.messages)).toBeLessThanOrEqual(budget);
    // The big tool_result payload is gone (elided marker or dropped).
    const serialized = JSON.stringify(res.messages);
    expect(serialized).not.toContain('R'.repeat(1_000));
  });

  it('keeps tool_use/tool_result adjacency intact after dropping messages', () => {
    // Force Pass 4 (whole-message drops) with a tiny budget, then verify no
    // orphaned protocol blocks survive.
    const msgs: Message[] = [];
    for (let i = 0; i < 8; i++) {
      msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: `u${i}`, name: 'read', input: { path: `f${i}` } }] } as Message);
      msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `u${i}`, content: 'y'.repeat(5_000) }] } as Message);
    }
    const res = enforceHardBudget(msgs, 500, { preserveK: 1 });
    expect(estimateMessageTokens(res.messages)).toBeLessThanOrEqual(500);
    // Every surviving tool_result must have its tool_use in the prior assistant msg.
    const useIds = new Set<string>();
    for (const m of res.messages) {
      if (typeof m.content === 'string') continue;
      for (const b of m.content) {
        if (b.type === 'tool_use') useIds.add(b.id);
        if (b.type === 'tool_result') expect(useIds.has(b.tool_use_id)).toBe(true);
      }
    }
  });
});

// ── dedupStaleReads: superseded repeated reads ─────────────────────────────

describe('dedupStaleReads', () => {
  const readUse = (id: string, path: string): Message =>
    ({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'read', input: { path } }] }) as Message;
  const readResult = (id: string, content: string): Message =>
    ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }) as Message;

  it('marks the stale (older) read of a repeated file and keeps the newest', () => {
    const msgs: Message[] = [
      readUse('u1', 'src/a.ts'),
      readResult('u1', 'OLD content of a.ts '.repeat(200)),
      text('user', 'turn 1'),
      text('assistant', 'turn 2'),
      text('user', 'turn 3'),
      text('assistant', 'turn 4'),
      readUse('u2', 'src/a.ts'),
      readResult('u2', 'NEW content of a.ts '.repeat(200)),
      text('user', 'turn 5'),
      text('assistant', 'turn 6'),
    ];
    const res = dedupStaleReads(msgs, [{ file: 'src/a.ts', count: 2 }], { preserveK: 2 });
    expect(res.changed).toBe(true);
    expect(res.deduped).toBe(1);
    const serialized = JSON.stringify(res.messages);
    expect(serialized).toContain('stale read of');
    expect(serialized).toContain('NEW content'); // newest kept verbatim
    expect(serialized).not.toContain('OLD content'); // oldest collapsed
  });

  it('is a no-op when there is no repeated-read pressure', () => {
    const msgs: Message[] = [readUse('u1', 'src/a.ts'), readResult('u1', 'content'.repeat(100))];
    const res = dedupStaleReads(msgs, [], { preserveK: 2 });
    expect(res.changed).toBe(false);
    expect(res.messages).toBe(msgs);
  });
});
