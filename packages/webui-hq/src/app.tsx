/**
 * HQ dashboard root — activity bar + view router + status bar.
 * Offline React app, no CDN. Connects to /ws/browser on mount.
 */
import type React from 'react';
import { useEffect } from 'react';
import { resolveHqToken } from './lib/auth.js';
import { fetchJson, setActiveView, useHqStore, type ViewId } from './store.js';
import { AlertsView } from './views/alerts.js';
import { BrainView } from './views/brain.js';
import { CockpitView } from './views/cockpit.js';
import { ControlView } from './views/control.js';
import { CostView } from './views/cost.js';
import { FleetMapView } from './views/fleet-map.js';
import { LiveConsoleView } from './views/live-console.js';
import { MailboxView } from './views/mailbox.js';
import { TokenGate } from './views/token-gate.js';
import { TrendsView } from './views/trends.js';
import { WorktreeView } from './views/worktree.js';
import './app.css';
import './syntax-highlight.css';

const VIEWS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'cockpit', label: 'Cockpit', icon: '🛰' },
  { id: 'fleet', label: 'Fleet', icon: '🖥' },
  { id: 'console', label: 'Console', icon: '💬' },
  { id: 'mailbox', label: 'Mailbox', icon: '📬' },
  { id: 'cost', label: 'Cost', icon: '💰' },
  { id: 'brain', label: 'Brain', icon: '🧠' },
  { id: 'worktree', label: 'Worktrees', icon: '🌿' },
  { id: 'trends', label: 'Trends', icon: '📈' },
  { id: 'alerts', label: 'Alerts', icon: '🔔' },
  { id: 'control', label: 'Control', icon: '⚡' },
];

export function HqApp(): React.ReactElement {
  // 'activeView' must be in the subscription keys: the store only notifies
  // listeners whose key filter intersects the change, so without it tab
  // clicks only "took effect" when the next snapshot broadcast re-rendered
  // the app (i.e. never on an idle server).
  const state = useHqStore(['snapshot', 'alerts', 'activeView', 'authRequired']);

  // Boot probe: a WS upgrade rejected with 401 is invisible to the browser
  // (it looks like an endless "reconnecting…"), so one authorized snapshot
  // fetch decides deterministically whether the token gate must show.
  // fetchJson flips `authRequired` on 401; other failures (server briefly
  // down) stay in the normal reconnect flow.
  useEffect(() => {
    fetchJson('/api/snapshot').catch(() => {
      /* 401 already handled via markAuthRequired; ignore the rest */
    });
  }, []);

  if (state.authRequired) {
    return <TokenGate hadToken={resolveHqToken() !== null} />;
  }

  const snap = state.snapshot;
  const totals = snap?.totals;
  const unread = totals?.unreadMailboxMessages ?? 0;
  const activeAlerts = state.alerts.filter((a) => a.severity !== 'info').length;

  return (
    <div className="hq-app">
      <header className="hq-header">
        <div className="hq-brand">WrongStack HQ</div>
        <span className="hq-ui-badge" title="Served from @wrongstack/webui-hq/dist">
          built webui-hq
        </span>
        <div className="hq-led" data-live={state.connected} />
        <span className="hq-conn">{state.connected ? 'connected' : 'reconnecting…'}</span>
        <div className="hq-stats">
          <Stat label="machines" value={totals?.activeMachines ?? 0} />
          <Stat label="clients" value={totals?.activeClients ?? 0} />
          <Stat label="sessions" value={totals?.activeSessions ?? 0} />
          <Stat label="agents" value={totals?.activeAgents ?? 0} />
          <Stat label="cost $" value={(totals?.totalCostUsd ?? 0).toFixed(2)} accent="green" />
        </div>
      </header>
      <nav className="hq-nav">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={'hq-tab' + (state.activeView === v.id ? ' active' : '')}
            onClick={() => setActiveView(v.id)}
          >
            <span className="hq-tab-icon">{v.icon}</span>
            <span className="hq-tab-label">{v.label}</span>
            {v.id === 'mailbox' && unread > 0 ? <span className="hq-badge">{unread}</span> : null}
            {v.id === 'alerts' && activeAlerts > 0 ? (
              <span className="hq-badge red">{activeAlerts}</span>
            ) : null}
          </button>
        ))}
      </nav>
      <main className="hq-main">
        {state.activeView === 'cockpit' && <CockpitView />}
        {state.activeView === 'fleet' && <FleetMapView />}
        {state.activeView === 'console' && <LiveConsoleView />}
        {state.activeView === 'mailbox' && <MailboxView />}
        {state.activeView === 'cost' && <CostView />}
        {state.activeView === 'brain' && <BrainView />}
        {state.activeView === 'worktree' && <WorktreeView />}
        {state.activeView === 'trends' && <TrendsView />}
        {state.activeView === 'alerts' && <AlertsView />}
        {state.activeView === 'control' && <ControlView />}
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}): React.ReactElement {
  return (
    <div className={'hq-stat' + (accent ? ` ${accent}` : '')}>
      <span className="hq-stat-num">{value}</span>
      <span className="hq-stat-label">{label}</span>
    </div>
  );
}
