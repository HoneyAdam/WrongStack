import type {
  AckRecord,
  MailboxMessage,
  MailboxMessageType,
  MailboxTaskContext,
  ReadReceipts,
} from './mailbox-types.js';

const MESSAGE_TYPES = new Set<MailboxMessageType>([
  'note',
  'ask',
  'assign',
  'steer',
  'btw',
  'broadcast',
  'status',
  'result',
  'review',
  'control',
]);

const PRIORITIES = new Set<MailboxMessage['priority']>(['low', 'normal', 'high']);
const TASK_STATUSES = new Set([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'idle',
  'running',
  'streaming',
  'waiting_user',
  'error',
  'offline',
  'busy',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new TypeError(`mailbox message field "${key}" must be a string`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== 'string') {
    throw new TypeError(`mailbox message field "${key}" must be a string when present`);
  }
  return { [key]: value };
}

function parseMessageType(value: unknown): MailboxMessageType {
  if (value === 'info') return 'note';
  if (value === 'task') return 'assign';
  if (typeof value === 'string' && MESSAGE_TYPES.has(value as MailboxMessageType)) {
    return value as MailboxMessageType;
  }
  throw new TypeError('mailbox message field "type" is invalid');
}

/** Normalize message types emitted by pre-union mailbox builds. */
export function normalizeMailboxMessageType(value: unknown): MailboxMessageType {
  return parseMessageType(value);
}

function parsePriority(value: unknown): MailboxMessage['priority'] {
  if (typeof value === 'string' && PRIORITIES.has(value as MailboxMessage['priority'])) {
    return value as MailboxMessage['priority'];
  }
  // Older callers were intentionally tolerant here and ranked unknown values
  // as normal. Normalize rather than dropping an otherwise valid message.
  if (typeof value === 'string') return 'normal';
  throw new TypeError('mailbox message field "priority" must be a string');
}

function parseReadReceipts(record: Record<string, unknown>, to: string): ReadReceipts {
  const value = record['readBy'];
  if (value === undefined) {
    const legacyReadAt = record['readAt'];
    return record['read'] === true && typeof legacyReadAt === 'string'
      ? { [to || 'unknown']: legacyReadAt }
      : {};
  }
  if (!isRecord(value)) {
    throw new TypeError('mailbox message field "readBy" must be an object');
  }

  const receipts: ReadReceipts = {};
  for (const [agentId, timestamp] of Object.entries(value)) {
    if (typeof timestamp !== 'string') {
      throw new TypeError('mailbox message read receipt timestamps must be strings');
    }
    receipts[agentId] = timestamp;
  }
  return receipts;
}

function parseTaskContext(value: unknown): MailboxTaskContext | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TypeError('mailbox message field "taskContext" must be an object');
  }

  const status = value['status'];
  if (
    status !== undefined &&
    (typeof status !== 'string' ||
      !TASK_STATUSES.has(status as NonNullable<MailboxTaskContext['status']>))
  ) {
    throw new TypeError('mailbox message taskContext status is invalid');
  }

  return {
    ...optionalString(value, 'agentRole'),
    ...optionalString(value, 'agentName'),
    ...optionalString(value, 'taskId'),
    ...(status === undefined
      ? {}
      : { status: status as NonNullable<MailboxTaskContext['status']> }),
  };
}

/** Parse, migrate, and structurally validate one persisted mailbox message. */
export function parseMailboxMessage(value: unknown): MailboxMessage {
  if (!isRecord(value)) throw new TypeError('mailbox message must be an object');

  const to = value['to'] === undefined ? '' : requiredString(value, 'to');
  const completed = value['completed'];
  if (typeof completed !== 'boolean') {
    throw new TypeError('mailbox message field "completed" must be a boolean');
  }

  const taskContext = parseTaskContext(value['taskContext']);
  return {
    id: requiredString(value, 'id'),
    from: requiredString(value, 'from'),
    to,
    type: parseMessageType(value['type']),
    subject: requiredString(value, 'subject'),
    body: requiredString(value, 'body'),
    priority: parsePriority(value['priority']),
    readBy: parseReadReceipts(value, to),
    completed,
    timestamp: requiredString(value, 'timestamp'),
    ...optionalString(value, 'completedBy'),
    ...optionalString(value, 'outcome'),
    ...optionalString(value, 'completedAt'),
    ...optionalString(value, 'deletedAt'),
    ...optionalString(value, 'deletedBy'),
    ...optionalString(value, 'replyTo'),
    ...optionalString(value, 'senderSessionId'),
    ...optionalString(value, 'expiresAt'),
    ...(taskContext === undefined ? {} : { taskContext }),
  };
}

/** Parse one JSONL line and validate the decoded mailbox message. */
export function parseMailboxMessageLine(line: string): MailboxMessage {
  return parseMailboxMessage(JSON.parse(line) as unknown);
}

// ── Ack record helpers ─────────────────────────────────────────────────

/**
 * Check if a parsed JSONL value is an append-only ack record (not a message).
 * Ack records carry a `__ack: true` discriminator.
 */
export function isAckRecord(value: unknown): value is AckRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)['__ack'] === true
  );
}

/**
 * Parse one JSONL line, returning either a MailboxMessage or an AckRecord.
 * Returns null when the line is neither (corrupt/malformed).
 */
export function parseMailboxLine(line: string): MailboxMessage | AckRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (isAckRecord(parsed)) return parsed;
    return parseMailboxMessage(parsed);
  } catch {
    return null;
  }
}

/**
 * Apply an ack record's effects to a MailboxMessage in-place.
 * This mutates the message object (readBy, completed, completedBy, completedAt, outcome).
 */
export function applyAckToMessage(msg: MailboxMessage, ack: AckRecord): void {
  if (ack.read && !(ack.readerId in msg.readBy)) {
    msg.readBy[ack.readerId] = ack.timestamp;
  }
  if (ack.completed && !msg.completed) {
    msg.completed = true;
    msg.completedBy = ack.completedBy ?? ack.readerId;
    msg.completedAt = ack.timestamp;
  }
  if (ack.outcome !== undefined && msg.outcome !== ack.outcome) {
    msg.outcome = ack.outcome;
  }
}

/**
 * Serialize an ack record to a JSONL line.
 */
export function serializeAckRecord(ack: AckRecord): string {
  return JSON.stringify(ack) + '\n';
}
