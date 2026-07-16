/**
 * CodeMap Activity Store — tracks per-file realtime activity from WS events.
 *
 * Listens to WS messages for file-touching tool calls (read, write, edit,
 * patch, grep, glob), file-save events, and memory operations. Each activity
 * is recorded with timestamp + type + toolName + summary, creating:
 *
 *   1. A "pulse" overlay — recently-active files highlight + pulse on the graph
 *   2. A per-file activity history — click a node to see its chronological log
 *   3. Replay capability — step through what happened to each file over time
 *
 * Activity auto-expires from the "pulse" set after ACTIVITY_TTL_MS (default 8s),
 * but the full history is retained (capped at MAX_HISTORY_PER_FILE) for replay.
 */
import { create } from 'zustand';
import type { WSServerMessage } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityType = 'read' | 'write' | 'edit' | 'delete' | 'search' | 'memory' | 'index';

export interface FileActivity {
  filePath: string;
  type: ActivityType;
  toolName: string;
  summary: string;
  timestamp: number;
  /** Agent/session that triggered the activity, if known. */
  agent?: string | undefined;
}

interface CodemapActivityState {
  /** All recorded activities, newest-first per file. */
  history: Map<string, FileActivity[]>;
  /** Files currently "pulsing" (recently active). Map<filePath, expiryTimestamp>. */
  pulses: Map<string, number>;
  /** Total activity count (for stats display). */
  totalCount: number;

  /** Record a new activity event. */
  recordActivity: (activity: FileActivity) => void;
  /** Get the activity history for a file (newest-first). */
  getActivityForFile: (filePath: string) => FileActivity[];
  /** Get all currently-pulsing file paths. */
  getPulsingFiles: () => Set<string>;
  /** Get the dominant activity type for a pulsing file. */
  getPulseType: (filePath: string) => ActivityType | undefined;
  /** Clear all history and pulses. */
  clear: () => void;
  /** Internal: sweep expired pulses. Called on each read. */
  _sweep: () => void;
}

const ACTIVITY_TTL_MS = 8_000;
const MAX_HISTORY_PER_FILE = 200;
const MAX_TOTAL_FILES = 500;

// ─── Tool → ActivityType mapping ─────────────────────────────────────────────

const TOOL_TYPE_MAP: Record<string, ActivityType> = {
  read: 'read',
  write: 'write',
  edit: 'edit',
  patch: 'write',
  replace: 'edit',
  grep: 'search',
  glob: 'search',
  'codebase-search': 'search',
  'codebase-index': 'index',
  remember: 'memory',
  forget: 'memory',
  'memory_search': 'memory',
  'memory_update': 'memory',
  'memory_delete': 'memory',
};

/** Extract file path(s) from common tool inputs. */
function extractPaths(toolName: string, input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  // Most file tools use `path`
  const p = input['path'];
  if (typeof p === 'string') paths.push(p);
  // Some tools use `file`
  const f = input['file'];
  if (typeof f === 'string') paths.push(f);
  // `files` for multi-file tools
  const fs = input['files'];
  if (typeof fs === 'string') paths.push(fs);
  // edit uses `path` already; replace uses `files` glob
  return paths;
}

/** Extract a short summary from the tool input. */
function extractSummary(toolName: string, input: Record<string, unknown>): string {
  const pattern = input['pattern'];
  const query = input['query'];
  const text = input['text'];
  const command = input['command'];

  if (typeof query === 'string' && query.trim()) return `"${query.slice(0, 60)}"`;
  if (typeof pattern === 'string' && pattern.trim()) return `/${pattern.slice(0, 60)}/`;
  if (typeof command === 'string' && command.trim()) return `$ ${command.slice(0, 60)}`;
  if (typeof text === 'string' && text.trim()) return text.slice(0, 60);
  return '';
}

/**
 * Try to extract file-activity events from a WS message.
 * Returns 0 or more FileActivity records.
 */
export function extractActivitiesFromMessage(msg: WSServerMessage): FileActivity[] {
  const results: FileActivity[] = [];
  const now = Date.now();

  // Handle provider.response with tool_use blocks
  if (msg.type === 'provider.response') {
    const payload = msg.payload as { blocks?: Array<Record<string, unknown>> | undefined };
    const blocks = payload?.blocks;
    if (!Array.isArray(blocks)) return results;

    for (const block of blocks) {
      if (block['type'] !== 'tool_use') continue;
      const toolName = String(block['name'] ?? '');
      const input = (block['input'] ?? {}) as Record<string, unknown>;
      const activityType = TOOL_TYPE_MAP[toolName];
      if (!activityType) continue;

      const paths = extractPaths(toolName, input);
      const summary = extractSummary(toolName, input);

      if (paths.length > 0) {
        for (const fp of paths) {
          results.push({ filePath: fp, type: activityType, toolName, summary, timestamp: now });
        }
      } else if (activityType === 'memory' || activityType === 'search' || activityType === 'index') {
        // Memory/search/index activities without a specific file path
        results.push({
          filePath: '(global)',
          type: activityType,
          toolName,
          summary,
          timestamp: now,
        });
      }
    }
    return results;
  }

  // Handle file.saved
  if (msg.type === 'file.saved') {
    const payload = msg.payload as { filePath?: string | undefined };
    if (typeof payload?.filePath === 'string') {
      results.push({
        filePath: payload.filePath,
        type: 'write',
        toolName: 'save',
        summary: '',
        timestamp: now,
      });
    }
    return results;
  }

  // Handle memory.event
  if (msg.type === 'memory.event') {
    const payload = msg.payload as { event?: string | undefined; memoryId?: string | undefined };
    const memEvent = payload?.event;
    if (typeof memEvent === 'string') {
      results.push({
        filePath: '(memory)',
        type: 'memory',
        toolName: `memory.${memEvent}`,
        summary: String(payload?.memoryId ?? ''),
        timestamp: now,
      });
    }
    return results;
  }

  return results;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCodemapActivityStore = create<CodemapActivityState>((set, get) => ({
  history: new Map(),
  pulses: new Map(),
  totalCount: 0,

  recordActivity(activity) {
    set((state) => {
      const history = new Map(state.history);
      const pulses = new Map(state.pulses);

      // Record in history (newest-first)
      const existing = history.get(activity.filePath) ?? [];
      const updated = [activity, ...existing].slice(0, MAX_HISTORY_PER_FILE);
      history.set(activity.filePath, updated);

      // Cap total tracked files
      if (history.size > MAX_TOTAL_FILES) {
        const oldest = [...history.entries()]
          .sort((a, b) => {
            const aT = a[1][0]?.timestamp ?? 0;
            const bT = b[1][0]?.timestamp ?? 0;
            return aT - bT;
          })[0]?.[0];
        if (oldest) history.delete(oldest);
      }

      // Set pulse
      pulses.set(activity.filePath, Date.now() + ACTIVITY_TTL_MS);

      return { history, pulses, totalCount: state.totalCount + 1 };
    });
  },

  getActivityForFile(filePath) {
    return get().history.get(filePath) ?? [];
  },

  getPulsingFiles() {
    get()._sweep();
    return new Set(get().pulses.keys());
  },

  getPulseType(filePath) {
    get()._sweep();
    if (!get().pulses.has(filePath)) return undefined;
    const activities = get().history.get(filePath);
    return activities?.[0]?.type;
  },

  clear() {
    set({ history: new Map(), pulses: new Map(), totalCount: 0 });
  },

  _sweep() {
    const now = Date.now();
    const pulses = get().pulses;
    const expired: string[] = [];
    for (const [fp, expiry] of pulses) {
      if (expiry < now) expired.push(fp);
    }
    if (expired.length > 0) {
      set((state) => {
        const next = new Map(state.pulses);
        for (const k of expired) next.delete(k);
        return { pulses: next };
      });
    }
  },
}));
