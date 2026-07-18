import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/types/messages.js';
import {
  hasMeaningfulContent,
  repairToolUseAdjacency,
} from '../../src/utils/message-invariants.js';

describe('hasMeaningfulContent', () => {
  it('rejects empty strings and empty text blocks', () => {
    expect(hasMeaningfulContent('  \n')).toBe(false);
    expect(hasMeaningfulContent([])).toBe(false);
    expect(hasMeaningfulContent([{ type: 'text', text: '   ' }])).toBe(false);
  });

  it('keeps protocol content and signed thinking blocks', () => {
    expect(hasMeaningfulContent([{ type: 'tool_use', id: 'u1', name: 'read', input: {} }])).toBe(
      true,
    );
    expect(hasMeaningfulContent([{ type: 'thinking', thinking: '', signature: 'signed' }])).toBe(
      true,
    );
  });
});

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

  it('removes assistant messages containing only empty text blocks', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: '' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    ];

    const repaired = repairToolUseAdjacency(messages);

    expect(repaired.report.removedMessages).toBe(1);
    expect(repaired.messages).toEqual([messages[0], messages[2]]);
  });
});
