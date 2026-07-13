import { describe, expect, it } from 'vitest';
import {
  parseMailboxMessage,
  parseMailboxMessageLine,
} from '../../src/coordination/mailbox-message-codec.js';

const validMessage = {
  id: 'm1',
  from: 'leader',
  to: 'worker',
  type: 'note',
  subject: 'subject',
  body: 'body',
  priority: 'normal',
  readBy: {},
  completed: false,
  timestamp: '2026-07-12T00:00:00.000Z',
};

describe('mailbox message codec', () => {
  it('parses a valid JSONL message and keeps supported optional fields', () => {
    const parsed = parseMailboxMessageLine(
      JSON.stringify({
        ...validMessage,
        replyTo: 'parent',
        taskContext: { agentRole: 'executor', status: 'running' },
      }),
    );

    expect(parsed).toMatchObject({
      id: 'm1',
      replyTo: 'parent',
      taskContext: { agentRole: 'executor', status: 'running' },
    });
  });

  it('migrates legacy receipts and message types', () => {
    const parsed = parseMailboxMessage({
      ...validMessage,
      type: 'info',
      readBy: undefined,
      read: true,
      readAt: '2026-07-12T01:00:00.000Z',
    });

    expect(parsed.type).toBe('note');
    expect(parsed.readBy).toEqual({ worker: '2026-07-12T01:00:00.000Z' });
  });

  it('uses the legacy unknown recipient and normalizes unknown priorities', () => {
    const parsed = parseMailboxMessage({
      ...validMessage,
      to: undefined,
      priority: 'unexpected',
      readBy: undefined,
      read: true,
      readAt: '2026-07-12T01:00:00.000Z',
    });

    expect(parsed.priority).toBe('normal');
    expect(parsed.readBy).toEqual({ unknown: '2026-07-12T01:00:00.000Z' });
  });

  it.each([
    null,
    [],
    { ...validMessage, id: 1 },
    { ...validMessage, type: 'mystery' },
    { ...validMessage, priority: 1 },
    { ...validMessage, readBy: [] },
    { ...validMessage, readBy: { worker: 1 } },
    { ...validMessage, completed: 'no' },
    { ...validMessage, taskContext: [] },
    { ...validMessage, taskContext: { status: 'mystery' } },
  ])('rejects structurally invalid persisted values', (value) => {
    expect(() => parseMailboxMessage(value)).toThrow(TypeError);
  });

  it('rejects malformed JSON before structural validation', () => {
    expect(() => parseMailboxMessageLine('{')).toThrow(SyntaxError);
  });
});
