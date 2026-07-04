/**
 * Control view — staged command composer for connected HQ clients.
 * Only clients advertising `control.receive` are targetable.
 */
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useHqStore, selectClient, postCommand, fetchJson } from '../store.js';
import { setHqControlPrefs, useHqLocalPrefs } from '../stores/hq-local-prefs.js';

type CmdType = 'steer' | 'abort' | 'spawn' | 'broadcast';
type Stage = 'compose' | 'preview';

interface DraftCommand {
  type: CmdType;
  payload: Record<string, unknown>;
  disabledReason: string | null;
  risk: 'normal' | 'danger';
  summary: string;
}

interface CommandAuditEntry {
  commandId: string;
  type: string;
  clientId: string;
  enqueuedBy: string;
  enqueuedAt: string;
  status: 'queued' | 'delivered' | 'acked' | string;
  ackStatus?: 'accepted' | 'completed' | 'failed' | 'rejected' | string;
  ackMessage?: string;
  ackedAt?: string;
}

interface CommandsResponse {
  commands: CommandAuditEntry[];
}

export function ControlView(): React.ReactElement {
  const state = useHqStore(['snapshot', 'selectedClientId']);
  const clients = (state.snapshot?.clients ?? []).filter((c) =>
    c.capabilities.includes('control.receive'),
  );
  const selected = state.selectedClientId ?? clients[0]?.clientId ?? null;
  const selectedClient = clients.find((c) => c.clientId === selected) ?? clients[0] ?? null;

  const persisted = useHqLocalPrefs();
  const pctl = persisted.control;

  const [cmdType, setCmdType] = useState<CmdType>(pctl.cmdType);
  const [stage, setStage] = useState<Stage>('compose');
  const [steerTo, setSteerTo] = useState(pctl.steerTo);
  const [steerSubject, setSteerSubject] = useState(pctl.steerSubject);
  const [steerBody, setSteerBody] = useState(pctl.steerBody);
  const [spawnRole, setSpawnRole] = useState(pctl.spawnRole);
  const [abortTarget, setAbortTarget] = useState(pctl.abortTarget);
  const [broadcastSubject, setBroadcastSubject] = useState(pctl.broadcastSubject);
  const [broadcastBody, setBroadcastBody] = useState(pctl.broadcastBody);
  const [confirmText, setConfirmText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auditEntries, setAuditEntries] = useState<CommandAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const draft = useMemo<DraftCommand>(
    () => buildDraft(),
    [
      cmdType,
      steerTo,
      steerSubject,
      steerBody,
      spawnRole,
      abortTarget,
      broadcastSubject,
      broadcastBody,
    ],
  );

  const confirmRequired = draft.risk === 'danger';
  const canDispatch =
    selected !== null &&
    draft.disabledReason === null &&
    (!confirmRequired || confirmText === 'ABORT');

  function resetPreview(): void {
    setStage('compose');
    setConfirmText('');
    setError(null);
    setStatus(null);
  }

  function chooseType(type: CmdType): void {
    setCmdType(type);
    setHqControlPrefs({ cmdType: type });
    resetPreview();
  }

  async function loadAudit(): Promise<void> {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const data = await fetchJson<CommandsResponse>('/api/commands?limit=25');
      setAuditEntries(data.commands.slice().reverse());
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    void loadAudit();
    const timer = setInterval(() => void loadAudit(), 5_000);
    return () => clearInterval(timer);
  }, []);

  async function dispatch(): Promise<void> {
    if (selected === null || !canDispatch) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await postCommand(selected, draft.type, draft.payload);
      setStatus(`queued ${draft.type} command ${res.commandId}`);
      setStage('compose');
      setConfirmText('');
      void loadAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function buildDraft(): DraftCommand {
    if (cmdType === 'steer') {
      const body = steerBody.trim();
      return {
        type: 'steer',
        payload: {
          to: steerTo || 'leader',
          subject: steerSubject || 'HQ steer',
          body: steerBody,
          priority: 'high',
        },
        disabledReason: body.length === 0 ? 'Steer body is required.' : null,
        risk: 'normal',
        summary: `Send high-priority steer to ${steerTo || 'leader'}.`,
      };
    }
    if (cmdType === 'abort') {
      return {
        type: 'abort',
        payload: { target: abortTarget },
        disabledReason: null,
        risk: 'danger',
        summary:
          abortTarget === 'fleet'
            ? 'Abort all subagents on the selected client.'
            : 'Abort the selected target on the selected client.',
      };
    }
    if (cmdType === 'spawn') {
      const task = steerBody.trim();
      return {
        type: 'spawn',
        payload: { role: spawnRole, ...(task ? { task } : {}) },
        disabledReason: spawnRole.trim().length === 0 ? 'Role is required.' : null,
        risk: 'normal',
        summary: `Spawn a ${spawnRole} subagent${task ? ' with an initial task' : ''}.`,
      };
    }
    const body = broadcastBody.trim();
    return {
      type: 'broadcast',
      payload: {
        subject: broadcastSubject || 'HQ broadcast',
        body: broadcastBody,
        priority: 'normal',
      },
      disabledReason: body.length === 0 ? 'Broadcast body is required.' : null,
      risk: 'normal',
      summary: 'Broadcast a normal-priority mailbox message to the selected client project.',
    };
  }

  if (clients.length === 0) {
    return (
      <div className="hq-empty">
        No controllable clients connected. Clients must advertise the <code>control.receive</code>{' '}
        capability (CLI/TUI/WebUI surfaces do this automatically when connected to HQ).
      </div>
    );
  }

  return (
    <div>
      <div className="hq-card-title">Command Target</div>
      <div className="hq-card hq-control-target">
        <label className="hq-label">Client</label>
        <select
          className="hq-select"
          value={selected ?? ''}
          onChange={(e) => {
            selectClient(e.target.value);
            resetPreview();
          }}
        >
          {clients.map((c) => (
            <option key={c.clientId} value={c.clientId}>
              {c.kind} — {c.hostname ?? c.clientId} ({c.projectId})
            </option>
          ))}
        </select>
        {selectedClient !== null && (
          <div className="hq-control-meta">
            <span>
              <strong>kind</strong> {selectedClient.kind}
            </span>
            <span>
              <strong>host</strong> {selectedClient.hostname ?? 'unknown'}
            </span>
            <span>
              <strong>project</strong> {selectedClient.projectId}
            </span>
            <span>
              <strong>client</strong> {shortId(selectedClient.clientId)}
            </span>
          </div>
        )}
      </div>

      <div className="hq-card-title">Command Type</div>
      <div className="hq-control-steps" aria-label="Control command stages">
        <span className="hq-step active">1 compose</span>
        <span className={'hq-step' + (stage === 'preview' ? ' active' : '')}>2 preview</span>
        <span className={'hq-step' + (status !== null ? ' active' : '')}>3 queued</span>
      </div>
      <div className="hq-row">
        {(['steer', 'abort', 'spawn', 'broadcast'] as CmdType[]).map((t) => (
          <button
            key={t}
            className={'hq-btn secondary' + (cmdType === t ? ' hq-btn-selected' : '')}
            onClick={() => chooseType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {cmdType === 'steer' && (
          <div className="hq-card">
            <label className="hq-label">
              To (agent address — e.g. <code>leader</code>, <code>leader@sessionTag</code>, or a
              subagent id)
            </label>
            <input
              className="hq-input"
              value={steerTo}
              onChange={(e) => {
                setSteerTo(e.target.value);
                setHqControlPrefs({ steerTo: e.target.value });
              }}
              placeholder="leader"
            />
            <label className="hq-label" style={{ marginTop: 8 }}>
              Subject
            </label>
            <input
              className="hq-input"
              value={steerSubject}
              onChange={(e) => {
                setSteerSubject(e.target.value);
                setHqControlPrefs({ steerSubject: e.target.value });
              }}
            />
            <label className="hq-label" style={{ marginTop: 8 }}>
              Body
            </label>
            <textarea
              className="hq-textarea"
              value={steerBody}
              onChange={(e) => {
                setSteerBody(e.target.value);
                setHqControlPrefs({ steerBody: e.target.value });
              }}
            />
          </div>
        )}

        {cmdType === 'abort' && (
          <div className="hq-card hq-card-danger">
            <label className="hq-label">Target</label>
            <select
              className="hq-select"
              value={abortTarget}
              onChange={(e) => {
                setAbortTarget(e.target.value as 'leader' | 'fleet');
                setHqControlPrefs({ abortTarget: e.target.value as 'leader' | 'fleet' });
              }}
            >
              <option value="leader">leader (session leader)</option>
              <option value="fleet">fleet (all subagents)</option>
            </select>
            <div className="hq-control-warning">
              Abort is destructive. Preview requires typing <strong>ABORT</strong> before dispatch.
            </div>
          </div>
        )}

        {cmdType === 'spawn' && (
          <div className="hq-card">
            <label className="hq-label">Role</label>
            <select
              className="hq-select"
              value={spawnRole}
              onChange={(e) => {
                setSpawnRole(e.target.value);
                setHqControlPrefs({ spawnRole: e.target.value });
              }}
            >
              <option value="bug-hunter">bug-hunter</option>
              <option value="refactor-planner">refactor-planner</option>
              <option value="critic">critic</option>
              <option value="security-scanner">security-scanner</option>
              <option value="code-reviewer">code-reviewer</option>
            </select>
            <label className="hq-label" style={{ marginTop: 8 }}>
              Task (optional)
            </label>
            <textarea
              className="hq-textarea"
              value={steerBody}
              onChange={(e) => {
                setSteerBody(e.target.value);
                setHqControlPrefs({ steerBody: e.target.value });
              }}
              placeholder="Describe the task…"
            />
          </div>
        )}

        {cmdType === 'broadcast' && (
          <div className="hq-card">
            <label className="hq-label">Subject</label>
            <input
              className="hq-input"
              value={broadcastSubject}
              onChange={(e) => {
                setBroadcastSubject(e.target.value);
                setHqControlPrefs({ broadcastSubject: e.target.value });
              }}
            />
            <label className="hq-label" style={{ marginTop: 8 }}>
              Body
            </label>
            <textarea
              className="hq-textarea"
              value={broadcastBody}
              onChange={(e) => {
                setBroadcastBody(e.target.value);
                setHqControlPrefs({ broadcastBody: e.target.value });
              }}
            />
          </div>
        )}
      </div>

      <div className="hq-card-title">Dispatch Gate</div>
      <div
        className={
          'hq-card hq-command-preview' + (draft.risk === 'danger' ? ' hq-card-danger' : '')
        }
      >
        <div className="hq-row">
          <span className={'hq-pill ' + (draft.risk === 'danger' ? 'error' : 'info')}>
            {draft.risk}
          </span>
          <span>{draft.summary}</span>
          {draft.disabledReason !== null && (
            <span className="hq-pill warn">{draft.disabledReason}</span>
          )}
        </div>
        {stage === 'preview' ? (
          <>
            <div className="hq-msg-sublabel">payload preview</div>
            <pre className="hq-msg-pre">
              {JSON.stringify(
                { clientId: selected, type: draft.type, payload: draft.payload },
                null,
                2,
              )}
            </pre>
            {confirmRequired && (
              <>
                <label className="hq-label" style={{ marginTop: 12 }}>
                  Confirm destructive dispatch
                </label>
                <input
                  className="hq-input"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type ABORT"
                />
              </>
            )}
            <div className="hq-row" style={{ marginTop: 12 }}>
              <button
                className="hq-btn"
                disabled={busy || !canDispatch}
                onClick={() => void dispatch()}
              >
                {busy ? 'Dispatching…' : 'Dispatch Command'}
              </button>
              <button className="hq-btn secondary" disabled={busy} onClick={resetPreview}>
                Back to Compose
              </button>
            </div>
          </>
        ) : (
          <button
            className="hq-btn"
            disabled={draft.disabledReason !== null || selected === null}
            onClick={() => {
              setStage('preview');
              setStatus(null);
              setError(null);
            }}
          >
            Preview Command
          </button>
        )}
      </div>

      <div className="hq-card-title">Command Audit</div>
      <div className="hq-card hq-command-audit">
        <div className="hq-row">
          <span className="hq-pill info">recent {auditEntries.length}</span>
          {auditLoading && <span className="hq-pill idle">refreshing</span>}
          {auditError !== null && <span className="hq-pill error">{auditError}</span>}
          <button
            className="hq-btn secondary"
            style={{ marginLeft: 'auto' }}
            onClick={() => void loadAudit()}
          >
            Refresh
          </button>
        </div>
        {auditEntries.length === 0 ? (
          <div className="hq-empty" style={{ padding: 16, fontSize: 12 }}>
            No command audit entries yet.
          </div>
        ) : (
          <div className="hq-audit-list">
            {auditEntries.map((entry) => (
              <div key={entry.commandId} className="hq-audit-row">
                <div className="hq-audit-main">
                  <span className={'hq-pill ' + auditTone(entry)}>{entry.status}</span>
                  <span className="hq-pill info">{entry.type}</span>
                  <span className="hq-mono">{shortId(entry.commandId)}</span>
                  {entry.ackStatus !== undefined && (
                    <span className="hq-pill active">ack {entry.ackStatus}</span>
                  )}
                </div>
                <div className="hq-audit-meta">
                  <span>
                    <strong>client</strong> {shortId(entry.clientId)}
                  </span>
                  <span>
                    <strong>by</strong> {entry.enqueuedBy}
                  </span>
                  <span>
                    <strong>queued</strong> {formatTime(entry.enqueuedAt)}
                  </span>
                  {entry.ackedAt !== undefined && (
                    <span>
                      <strong>acked</strong> {formatTime(entry.ackedAt)}
                    </span>
                  )}
                </div>
                {entry.ackMessage !== undefined && entry.ackMessage.length > 0 && (
                  <div className="hq-audit-message">{entry.ackMessage}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {status && (
        <div className="hq-pill active" style={{ marginTop: 12 }}>
          {status}
        </div>
      )}
      {error && (
        <div className="hq-pill error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

function formatTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString();
}

function auditTone(entry: CommandAuditEntry): 'active' | 'info' | 'idle' | 'error' | 'warn' {
  if (entry.ackStatus === 'failed' || entry.ackStatus === 'rejected') return 'error';
  if (entry.status === 'acked') return 'active';
  if (entry.status === 'delivered') return 'info';
  if (entry.status === 'queued') return 'warn';
  return 'idle';
}
