import type { SessionEvent } from '../types/session.js';

export interface QueryFilter {
  eventTypes?: string[];
  toolNames?: string[];
  timeRange?: { start: string; end: string };
}

export interface ToolInvocation {
  ts: string;
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface SessionError {
  ts: string;
  phase: string;
  message: string;
}

export interface ModeChange {
  ts: string;
  from: string;
  to: string;
}

export interface TaskSummary {
  taskId: string;
  title: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

export interface SessionAnalysis {
  sessionId: string;
  totalDuration: number;
  toolUsageCount: Record<string, number>;
  errorCount: number;
  modeChanges: ModeChange[];
  tasks: TaskSummary[];
}

export class SessionAnalyzer {
  analyze(events: SessionEvent[]): SessionAnalysis {
    const toolUsageCount: Record<string, number> = {};
    const errors: SessionError[] = [];
    const modeChanges: ModeChange[] = [];

    for (const event of events) {
      if (event.type === 'tool_use') {
        toolUsageCount[event.name] = (toolUsageCount[event.name] ?? 0) + 1;
      }
      if (event.type === 'error') {
        errors.push({ ts: event.ts, phase: event.phase, message: event.message });
      }
    }

    return {
      sessionId: '',
      totalDuration: this.calcDuration(events),
      toolUsageCount,
      errorCount: errors.length,
      modeChanges,
      tasks: [],
    };
  }

  query(events: SessionEvent[], filter: QueryFilter): SessionEvent[] {
    return events.filter((e) => {
      if (filter.eventTypes?.length && !filter.eventTypes.includes(e.type)) return false;
      if (filter.toolNames?.length && e.type === 'tool_use') {
        const toolEvent = e as { type: 'tool_use'; name: string };
        if (!filter.toolNames.includes(toolEvent.name)) return false;
      }
      if (filter.timeRange) {
        const ts = new Date(e.ts).getTime();
        const start = new Date(filter.timeRange.start).getTime();
        const end = new Date(filter.timeRange.end).getTime();
        if (ts < start || ts > end) return false;
      }
      return true;
    });
  }

  private calcDuration(events: SessionEvent[]): number {
    if (events.length < 2) return 0;
    const first = new Date(events[0]!.ts).getTime();
    const last = new Date(events[events.length - 1]!.ts).getTime();
    return last - first;
  }
}