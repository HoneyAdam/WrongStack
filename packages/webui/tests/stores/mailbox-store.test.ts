import { describe, expect, it } from 'vitest';
import {
  type MailboxMessage,
  selectUnreadCount,
  useMailboxStore,
} from '../../src/stores/mailbox-store';

function makeMessage(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return {
    id: 'msg_1',
    from: 'agent-a',
    to: '*',
    type: 'note',
    subject: 'hello',
    body: 'body',
    priority: 'normal',
    readBy: {},
    readByCount: 0,
    completed: false,
    timestamp: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('mailbox store', () => {
  it('counts only unread, uncompleted messages', () => {
    useMailboxStore.getState().setMessages([
      makeMessage({ id: 'a' }), // unread
      makeMessage({ id: 'b', readByCount: 2 }), // read
      makeMessage({ id: 'c', completed: true }), // completed
      makeMessage({ id: 'd' }), // unread
    ]);
    expect(selectUnreadCount(useMailboxStore.getState())).toBe(2);
  });

  it('is zero when empty', () => {
    useMailboxStore.getState().setMessages([]);
    expect(selectUnreadCount(useMailboxStore.getState())).toBe(0);
  });
});
