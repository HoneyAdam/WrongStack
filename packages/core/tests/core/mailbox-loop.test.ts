import { describe, expect, it, vi } from 'vitest';
import { injectPendingMailboxMessages } from '../../src/index.js';
import type { MailboxMessage } from '../../src/coordination/mailbox-types.js';

function msg(partial: Partial<MailboxMessage> & Pick<MailboxMessage, 'type'>): MailboxMessage {
  return {
    id: partial.id ?? `m_${Math.random().toString(36).slice(2)}`,
    from: partial.from ?? 'human@webui',
    to: partial.to ?? 'leader@abcd',
    type: partial.type,
    subject: partial.subject ?? 's',
    body: partial.body ?? 'b',
    priority: partial.priority ?? 'high',
    readBy: partial.readBy ?? {},
    completed: partial.completed ?? false,
    timestamp: partial.timestamp ?? '2026-06-19T00:00:00.000Z',
  };
}

const noopHost = {
  events: { emit: () => {} },
  logger: { debug: () => {} },
};

describe('injectPendingMailboxMessages', () => {
  it('signals interrupt on a control:interrupt message and does NOT fold it as content', async () => {
    const fold = vi.fn();
    const res = await injectPendingMailboxMessages(
      async () => [msg({ type: 'control', subject: 'interrupt', body: 'stop now' })],
      fold,
      noopHost,
    );
    expect(res.interrupt).toBe(true);
    expect(res.interruptReason).toBe('stop now');
    // control messages are out-of-band signals — never folded into the transcript
    expect(fold).not.toHaveBeenCalled();
  });

  it('folds normal content and does not signal interrupt', async () => {
    const fold = vi.fn();
    const res = await injectPendingMailboxMessages(
      async () => [msg({ type: 'steer', body: 'adjust your approach' })],
      fold,
      noopHost,
    );
    expect(res.interrupt).toBe(false);
    expect(fold).toHaveBeenCalledTimes(1);
  });

  it('folds content but still signals interrupt when both arrive together', async () => {
    const fold = vi.fn();
    const res = await injectPendingMailboxMessages(
      async () => [
        msg({ type: 'note', body: 'fyi' }),
        msg({ type: 'control', subject: 'interrupt', body: 'halt' }),
      ],
      fold,
      noopHost,
    );
    expect(res.interrupt).toBe(true);
    expect(fold).toHaveBeenCalledTimes(1); // only the note is folded
  });

  it('returns interrupt:false on empty mailbox and never folds', async () => {
    const fold = vi.fn();
    const res = await injectPendingMailboxMessages(async () => [], fold, noopHost);
    expect(res.interrupt).toBe(false);
    expect(fold).not.toHaveBeenCalled();
  });

  it('swallows a checker error (broken mailbox must not stop the agent)', async () => {
    const fold = vi.fn();
    const res = await injectPendingMailboxMessages(
      async () => {
        throw new Error('mailbox unavailable');
      },
      fold,
      noopHost,
    );
    expect(res.interrupt).toBe(false);
    expect(fold).not.toHaveBeenCalled();
  });
});
