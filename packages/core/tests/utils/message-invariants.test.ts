import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/types/messages.js';
import { repairToolUseAdjacency } from '../../src/utils/message-invariants.js';

describe('repairToolUseAdjacency', () => {
  it('leaves valid tool_use/tool_result pairs untouched', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'u1', name: 'read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }] },
      { role: 'assistant', content: 'done' },
    ];

    const repaired = repairToolUseAdjacency(messages);

    expect(repaired.report.changed).toBe(false);
    expect(repaired.messages).toBe(messages);
  });

  it('removes assistant tool_use blocks without immediate results', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 'u1', name: 'read', input: {} },
        ],
      },
      { role: 'assistant', content: 'not a tool result' },
    ];

    const repaired = repairToolUseAdjacency(messages);

    expect(repaired.report.removedToolUses).toEqual(['u1']);
    expect(repaired.messages[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'checking' }],
    });
  });

  it('removes orphan tool_result blocks', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'x' }] },
      { role: 'assistant', content: 'next' },
    ];

    const repaired = repairToolUseAdjacency(messages);

    expect(repaired.report.removedToolResults).toEqual(['missing']);
    expect(repaired.report.removedMessages).toBe(1);
    expect(repaired.messages).toEqual([{ role: 'assistant', content: 'next' }]);
  });

  it('repairs ranges cut through a tool exchange', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'u1', name: 'grep', input: {} }] },
      { role: 'system', content: '[summary]' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'late' }] },
      { role: 'user', content: 'continue' },
    ];

    const repaired = repairToolUseAdjacency(messages);

    expect(repaired.report.removedToolUses).toEqual(['u1']);
    expect(repaired.report.removedToolResults).toEqual(['u1']);
    expect(repaired.messages).toEqual([
      { role: 'system', content: '[summary]' },
      { role: 'user', content: 'continue' },
    ]);
  });
});
