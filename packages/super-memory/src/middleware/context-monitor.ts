import type { EventBus, Message, Request } from '@wrongstack/core';
import type { Middleware } from '@wrongstack/core/kernel';
import type { InjectionTracker } from './injection-tracker.js';

export interface SuperMemoryContextMonitorOptions {
  tracker: InjectionTracker;
  events: EventBus;
  getSessionId?: (() => string | undefined) | undefined;
  now?: (() => Date) | undefined;
}

/** Emit an exact memory-presence snapshot for every provider-bound request. */
export function createSuperMemoryContextMonitorMiddleware(
  opts: SuperMemoryContextMonitorOptions,
): Middleware<Request> {
  return {
    name: 'super-memory.context-monitor',
    owner: 'super-memory',
    async handler(request, next) {
      const now = opts.now?.() ?? new Date();
      const sessionId = opts.getSessionId?.();
      const snapshot = opts.tracker.snapshotContextParts(
        requestTextParts(request),
        sessionId,
        now.getTime(),
      );
      opts.events.emit('memory.context_snapshot', {
        at: now.toISOString(),
        ...snapshot,
        reason: 'provider_request',
        sessionId,
      });
      return next(request);
    },
  };
}

function* requestTextParts(request: Request): Iterable<string> {
  for (const block of request.system ?? []) yield block.text;
  for (const message of request.messages) yield* messageText(message);
}

function messageText(message: Message): string[] {
  if (typeof message.content === 'string') return [message.content];
  return message.content.flatMap((block) => {
    if (block.type === 'text') return [block.text];
    if (block.type === 'tool_result') return [block.content];
    return [];
  });
}
