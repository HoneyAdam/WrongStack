import type { DistributiveOmit, Message, SessionEvent } from '@wrongstack/core';
import type { HistoryEntry } from './types.js';

/**
 * Render a SessionEvent back into a TUI HistoryEntry so a resumed session
 * displays exactly what the user saw during live interaction.
 *
 * ## Entry mapping
 *
 * | Event type                | HistoryEntry kind |
 * |--------------------------|-------------------|
 * | `user_input`             | `user`            |
 * | `llm_response`           | `assistant`       |
 * | `tool_use` + `tool_result` | `tool` (paired) |
 * | `tool_call_start`/`tool_call_end` | `tool`      |
 * | `compaction`             | `info`            |
 * | `error`                  | `error`           |
 * | `provider_retry`         | `warn`            |
 * | `provider_error`         | `error`           |
 * | `checkpoint`             | `info`            |
 * | `agent_spawned`/`agent_stopped` | `subagent`  |
 * | `agent_error`            | `subagent`        |
 * | `mode_changed`           | `info`            |
 * | `skill_activated`/`skill_deactivated` | `info` |
 * | `message_truncated`      | `warn`            |
 *
 * ## Non-resumable events (subagent transcripts)
 *
 * Subagent events (`agent_spawned`, `agent_stopped`, `agent_error`) are
 * rendered as `subagent` entries in the main TUI history but the full
 * subagent tool-call details live in per-subagent JSONL files. The main
 * session only holds the lifecycle markers.
 *
 * ## Compaction events
 *
 * Compaction boundaries are rendered as `info` entries showing how many
 * tokens were collapsed. This keeps the display neat without pretending
 * the full verbose context never existed.
 *
 * @param events  Parsed SessionEvent[] from session JSONL
 * @param startId Starting id counter for the generated entries
 * @returns       Ordered HistoryEntry[] ready for display
 */
export function replaySessionMessages(
  messages: readonly Message[],
  events: readonly SessionEvent[],
  startId: number,
): HistoryEntry[] {
  const toolEnds = new Map(
    events
      .filter(
        (event): event is Extract<SessionEvent, { type: 'tool_call_end' }> =>
          event.type === 'tool_call_end',
      )
      .map((event) => [event.id, event]),
  );
  const toolEntries = new Map<string, Extract<HistoryEntry, { kind: 'tool' }>>();
  const entries: HistoryEntry[] = [];
  let nextId = startId;

  const appendText = (message: Message, text: string): void => {
    if (!text.trim()) return;
    entries.push(
      message.role === 'assistant'
        ? { id: nextId++, kind: 'assistant', text }
        : message.role === 'system'
          ? { id: nextId++, kind: 'info', text }
          : { id: nextId++, kind: 'user', text },
    );
  };

  for (const message of messages) {
    if (typeof message.content === 'string') {
      appendText(message, message.content);
      continue;
    }

    appendText(
      message,
      message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
    );

    for (const block of message.content) {
      if (block.type === 'tool_use') {
        const end = toolEnds.get(block.id);
        const entry: Extract<HistoryEntry, { kind: 'tool' }> = {
          id: nextId++,
          kind: 'tool',
          name: block.name,
          durationMs: end?.durationMs ?? 0,
          ok: false,
          input: block.input,
          outputBytes: end?.outputBytes,
          outputTokens: end?.outputTokens,
          outputLines: end?.outputLines,
        };
        entries.push(entry);
        toolEntries.set(block.id, entry);
        continue;
      }
      if (block.type !== 'tool_result') continue;
      const existing = toolEntries.get(block.tool_use_id);
      if (existing) {
        existing.output = block.content.slice(0, 400);
        existing.ok = !block.is_error;
        toolEntries.delete(block.tool_use_id);
        continue;
      }
      const end = toolEnds.get(block.tool_use_id);
      entries.push({
        id: nextId++,
        kind: 'tool',
        name: block.name ?? block.tool_use_id,
        durationMs: end?.durationMs ?? 0,
        ok: !block.is_error,
        output: block.content.slice(0, 400),
        outputBytes: end?.outputBytes,
        outputTokens: end?.outputTokens,
        outputLines: end?.outputLines,
      });
    }
  }
  return entries;
}

export function replaySessionEvents(events: SessionEvent[], startId: number): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let nextId = startId;
  // Pending tool_use events awaiting their tool_result
  const pendingTools = new Map<string, { name: string; input: unknown; ts: string }>();
  // Tool entries already rendered from a richer `tool_call_end` event. Keep
  // the actual entry so the later core `tool_result` can enrich it with the
  // persisted output without moving it past messages that occurred between
  // the two events or rendering a duplicate call.
  const completedTools = new Map<string, Extract<HistoryEntry, { kind: 'tool' }>>();

  for (const ev of events) {
    const entry = eventToEntry(ev, pendingTools, completedTools);
    if (entry) {
      const completed = { ...entry, id: nextId++ } as HistoryEntry;
      entries.push(completed);
      if (ev.type === 'tool_call_end' && completed.kind === 'tool') {
        completedTools.set(ev.id, completed);
      }
    }
  }

  // Flush any orphaned tool_use events (tool_use without tool_result — e.g. from
  // a crash mid-execution)
  for (const [, tu] of pendingTools) {
    entries.push({
      id: nextId++,
      kind: 'tool',
      name: tu.name,
      durationMs: 0,
      ok: false,
      input: tu.input,
    });
  }

  return entries;
}

/**
 * Convert a single SessionEvent to a HistoryEntry (or null if the event
 * should be skipped in the display). `pendingTools` is mutated to pair
 * tool_use events with their subsequent tool_result.
 */
function eventToEntry(
  ev: SessionEvent,
  pendingTools: Map<string, { name: string; input: unknown; ts: string }>,
  completedTools: Map<string, Extract<HistoryEntry, { kind: 'tool' }>>,
): DistributiveOmit<HistoryEntry, 'id'> | null {
  switch (ev.type) {
    case 'user_input': {
      const text =
        typeof ev.content === 'string'
          ? ev.content
          : Array.isArray(ev.content)
            ? ev.content
                .filter((b) => (b as { type: string }).type === 'text')
                .map((b) => (b as { text: string }).text)
                .join('')
            : '';
      if (!text.trim()) return null;
      return { kind: 'user', text };
    }

    case 'llm_response': {
      for (const block of ev.content) {
        if (block.type === 'tool_use') {
          pendingTools.set(block.id, { name: block.name, input: block.input, ts: ev.ts });
        }
      }
      const text = ev.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      if (!text.trim()) return null;
      return { kind: 'assistant', text };
    }

    case 'tool_use': {
      // Defer — wait for the matching `tool_result` to construct a single
      // tool entry. Store the tool_use data keyed by its id.
      pendingTools.set(ev.id, { name: ev.name, input: ev.input, ts: ev.ts });
      return null;
    }

    case 'tool_result': {
      // Already rendered from the richer tool_call_end for this id —
      // emitting again would duplicate the call (named by its raw id).
      const completed = completedTools.get(ev.id);
      if (completed) {
        const serialized = typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content);
        completed.output = serialized?.slice(0, 400);
        completed.ok = !ev.isError;
        completedTools.delete(ev.id);
        return null;
      }
      // Pair with the previously stored tool_use.
      const tu = pendingTools.get(ev.id);
      pendingTools.delete(ev.id);
      return {
        kind: 'tool',
        name: tu?.name ?? ev.id,
        durationMs: 0, // duration not available from tool_result alone
        ok: !ev.isError,
        input: tu?.input,
        output: typeof ev.content === 'string' ? ev.content.slice(0, 400) : undefined,
      };
    }

    case 'tool_call_start': {
      // Defer — wait for tool_call_end
      pendingTools.set(ev.id, { name: ev.name, input: ev.input, ts: ev.ts });
      return null;
    }

    case 'tool_call_end': {
      const tu = pendingTools.get(ev.id);
      pendingTools.delete(ev.id);
      // The caller registers the completed entry by id after assigning its
      // stable history id, so a later tool_result can enrich it in place.
      // If we have a matching start, use its metadata; otherwise emit standalone.
      return {
        kind: 'tool',
        name: tu?.name ?? ev.name,
        durationMs: ev.durationMs,
        ok: ev.ok ?? false,
        input: tu?.input,
        outputBytes: ev.outputBytes,
        outputTokens: ev.outputTokens,
        outputLines: ev.outputLines,
      };
    }

    case 'compaction': {
      const before = (ev.before / 1000).toFixed(0);
      const after = (ev.after / 1000).toFixed(0);
      const level = ev.level ? ` (${ev.level})` : '';
      const reductions =
        ev.reductions && ev.reductions.length > 0
          ? ` [${ev.reductions.map((r) => `${r.phase}: −${r.saved}`).join(', ')}]`
          : '';
      return {
        kind: 'info',
        text: `⟲ context compacted${level}: ${before}K → ${after}K tokens${reductions}`,
      };
    }

    case 'error': {
      return {
        kind: 'error',
        text: ev.phase ? `[${ev.phase}] ${ev.message}` : ev.message,
      };
    }

    case 'provider_retry': {
      const secs = (ev.delayMs / 1000).toFixed(ev.delayMs >= 1000 ? 1 : 2);
      return {
        kind: 'warn',
        text: ev.status
          ? `⟳ retry ${ev.attempt} (HTTP ${ev.status}) after ${secs}s — ${ev.description}`
          : `⟳ retry ${ev.attempt} after ${secs}s — ${ev.description}`,
      };
    }

    case 'provider_error': {
      return {
        kind: 'error',
        text: ev.status
          ? `provider error (HTTP ${ev.status}, ${ev.retryable ? 'retryable' : 'fatal'}): ${ev.description}`
          : `provider error (${ev.retryable ? 'retryable' : 'fatal'}): ${ev.description}`,
      };
    }

    case 'checkpoint': {
      return {
        kind: 'info',
        text: `✓ checkpoint #${ev.promptIndex}: "${ev.promptPreview.slice(0, 60)}"`,
      };
    }

    case 'agent_spawned': {
      return {
        kind: 'subagent',
        agentLabel: ev.agentId.slice(0, 8),
        agentColor: 'magenta',
        icon: '⚡',
        text: `spawned as ${ev.role}`,
      };
    }

    case 'agent_stopped': {
      return {
        kind: 'subagent',
        agentLabel: ev.agentId.slice(0, 8),
        agentColor: 'gray',
        icon: '⊘',
        text: 'stopped',
      };
    }

    case 'agent_error': {
      return {
        kind: 'subagent',
        agentLabel: ev.agentId.slice(0, 8),
        agentColor: 'red',
        icon: '✗',
        text: `error: ${ev.error.slice(0, 80)}`,
      };
    }

    case 'mode_changed': {
      return {
        kind: 'info',
        text: `mode: ${ev.from} → ${ev.to}`,
      };
    }

    case 'skill_activated': {
      return {
        kind: 'info',
        text: `skill activated: ${ev.skillName}`,
      };
    }

    case 'skill_deactivated': {
      return {
        kind: 'info',
        text: `skill deactivated: ${ev.skillName}`,
      };
    }

    case 'message_truncated': {
      return {
        kind: 'warn',
        text:
          ev.after < ev.before
            ? `message truncated: ${ev.before} → ${ev.after} tokens`
            : `message truncated at ${ev.after} tokens`,
      };
    }

    // Skipped — internal markers not relevant for display
    case 'session_start':
    case 'session_resumed':
    case 'session_end':
    case 'in_flight_start':
    case 'in_flight_end':
    case 'llm_request':
    case 'tool_progress':
    case 'rewound':
    case 'file_snapshot':
    case 'task_created':
    case 'task_updated':
    case 'task_completed':
    case 'task_failed':
    case 'spec_parsed':
    case 'spec_analyzed':
      return null;

    default:
      // Exhaustive check: ignore unknown event types silently
      return null;
  }
}
