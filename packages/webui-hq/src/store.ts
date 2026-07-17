/**
 * HQ dashboard store — zustand-based global store, matching the pattern
 * used by the main @wrongstack/webui package. Holds the latest snapshot,
 * recent events, active alerts, and UI state.
 *
 * WS wiring moved to main.tsx; API helpers (fetchJson, postMailboxSend,
 * postCommand) remain as standalone exports that access store state via
 * useHqStore.getState().
 */
import type {
  HqAlertMessage,
  HqCommandAuditEntry,
  HqEventEnvelope,
  HqSnapshot,
} from '@wrongstack/core';
import { create } from 'zustand';
import { authorizedFetch } from './lib/auth.js';

export type ViewId =
  | 'cockpit'
  | 'fleet'
  | 'console'
  | 'mailbox'
  | 'cost'
  | 'brain'
  | 'worktree'
  | 'trends'
  | 'alerts'
  | 'control';

interface HqState {
  snapshot: HqSnapshot | null;
  events: HqEventEnvelope[];
  alerts: HqAlertMessage[];
  commandStatuses: HqCommandAuditEntry[];
  activeView: ViewId;
  selectedSessionId: string | null;
  selectedAgentId: string | null;
  selectedClientId: string | null;
  connected: boolean;
  authRequired: boolean;
}

interface HqActions {
  setActiveView: (view: ViewId) => void;
  selectSession: (sessionId: string | null, agentId?: string | null) => void;
  selectAgent: (sessionId: string, agentId: string) => void;
  selectClient: (clientId: string | null) => void;
  markAuthRequired: () => void;
  /** Seed the first render from HTTP without claiming the WebSocket is live. */
  _hydrateSnapshot: (snapshot: HqSnapshot) => void;
  _onSnapshot: (snapshot: HqSnapshot) => void;
  _onEvent: (event: HqEventEnvelope) => void;
  _onAlert: (alert: HqAlertMessage) => void;
  _onCommandStatus: (command: HqCommandAuditEntry) => void;
  _setConnected: (connected: boolean) => void;
}

const MAX_EVENTS = 500;
const MAX_ALERTS = 100;
const MAX_COMMAND_STATUSES = 200;

function snapshotPatch(state: HqState, snapshot: HqSnapshot): Partial<HqState> {
  const liveSessions = snapshot.liveSessions ?? [];
  const selectedSession =
    state.selectedSessionId === null
      ? undefined
      : liveSessions.find((session) => session.sessionId === state.selectedSessionId);
  const selectedAgentStillExists =
    state.selectedAgentId === null ||
    selectedSession?.agents.some((agent) => agent.id === state.selectedAgentId) === true;
  const selectedClientStillExists =
    state.selectedClientId === null ||
    snapshot.clients.some((client) => client.clientId === state.selectedClientId);

  return {
    snapshot,
    ...(state.selectedSessionId !== null && selectedSession === undefined
      ? { selectedSessionId: null, selectedAgentId: null }
      : !selectedAgentStillExists
        ? { selectedAgentId: null }
        : {}),
    ...(!selectedClientStillExists ? { selectedClientId: null } : {}),
  };
}

function sameAlert(left: HqAlertMessage, right: HqAlertMessage): boolean {
  return (
    left.timestamp === right.timestamp &&
    left.severity === right.severity &&
    left.message === right.message
  );
}

export const useHqStore = create<HqState & HqActions>()((set) => ({
  snapshot: null,
  events: [],
  alerts: [],
  commandStatuses: [],
  activeView: 'cockpit',
  selectedSessionId: null,
  selectedAgentId: null,
  selectedClientId: null,
  connected: false,
  authRequired: false,

  setActiveView: (view) => set({ activeView: view }),

  selectSession: (sessionId, agentId = null) =>
    set({ selectedSessionId: sessionId, selectedAgentId: agentId }),

  selectAgent: (sessionId, agentId) =>
    set({ selectedSessionId: sessionId, selectedAgentId: agentId }),

  selectClient: (clientId) => set({ selectedClientId: clientId }),

  markAuthRequired: () => set((s) => (s.authRequired ? {} : { authRequired: true })),

  _hydrateSnapshot: (snapshot) =>
    set((state) =>
      // A live frame may win the race against the boot-time HTTP request.
      // Never let that older response replace the WebSocket snapshot.
      state.snapshot === null ? snapshotPatch(state, snapshot) : {},
    ),

  _onSnapshot: (snapshot) =>
    set((state) => ({ ...snapshotPatch(state, snapshot), connected: true })),

  _onEvent: (event) =>
    set((state) =>
      state.events.some((candidate) => candidate.id === event.id)
        ? {}
        : { events: [...state.events, event].slice(-MAX_EVENTS) },
    ),

  _onAlert: (alert) =>
    set((state) =>
      state.alerts.some((candidate) => sameAlert(candidate, alert))
        ? {}
        : { alerts: [...state.alerts, alert].slice(-MAX_ALERTS) },
    ),

  _onCommandStatus: (command) =>
    set((state) => {
      const existing = state.commandStatuses.findIndex(
        (candidate) => candidate.commandId === command.commandId,
      );
      if (existing < 0) {
        return {
          commandStatuses: [...state.commandStatuses, command].slice(-MAX_COMMAND_STATUSES),
        };
      }
      const next = [...state.commandStatuses];
      next[existing] = command;
      return { commandStatuses: next };
    }),

  _setConnected: (connected) => set({ connected }),
}));

// ── API helpers ──────────────────────────────────────────────────────

export interface MailboxSendInput {
  projectId?: string | undefined;
  sessionId?: string | undefined;
  type: 'steer' | 'btw' | 'queue' | 'broadcast';
  to?: string | undefined;
  subject?: string | undefined;
  body: string;
  priority?: 'high' | 'normal' | 'low' | undefined;
}

export interface MailboxSendResult {
  delivered: boolean;
  messageId?: string;
  to: string;
  type: string;
}

export async function fetchJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await authorizedFetch(path);
  } catch {
    throw new Error(`Network error fetching ${path}`);
  }
  if (res.status === 401) {
    useHqStore.getState().markAuthRequired();
    throw new Error(`401 Unauthorized fetching ${path} — browser token required`);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`Invalid JSON response from ${path}: ${res.status}`);
  }
}

export async function postMailboxSend(input: MailboxSendInput): Promise<MailboxSendResult> {
  let res: Response;
  try {
    res = await authorizedFetch('/api/mailbox-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Network error sending mailbox message');
  }
  if (res.status === 401) {
    useHqStore.getState().markAuthRequired();
    throw new Error('401 Unauthorized — browser token required');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const msg =
      typeof body?.error === 'string' ? body.error : res.statusText || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  try {
    return (await res.json()) as MailboxSendResult;
  } catch {
    throw new Error('Invalid JSON response from mailbox-send API');
  }
}

export async function postCommand(
  clientId: string,
  type: string,
  payload: unknown,
): Promise<{ commandId: string; queued: boolean }> {
  let res: Response;
  try {
    res = await authorizedFetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, type, payload }),
    });
  } catch {
    throw new Error('Network error sending command');
  }
  if (res.status === 401) {
    useHqStore.getState().markAuthRequired();
    throw new Error('401 Unauthorized — browser token required');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error ?? (res.statusText || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  try {
    return (await res.json()) as { commandId: string; queued: boolean };
  } catch {
    throw new Error('Invalid JSON response from command API');
  }
}
