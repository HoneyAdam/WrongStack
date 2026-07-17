/**
 * HQ operator workbench — stable shell, lazy view router, and failure boundary.
 * Offline React app, no CDN. The WebSocket transport is wired in main.tsx.
 */

import type { HqSnapshot } from '@wrongstack/core';
import {
  Activity,
  BellRing,
  BrainCircuit,
  ChartNoAxesCombined,
  CircleDollarSign,
  GitBranch,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  MessageSquareText,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RadioTower,
  RotateCcw,
  Server,
  ShieldCheck,
  Sun,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  Component,
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { resolveHqToken } from './lib/auth.js';
import { fetchJson, useHqStore, type ViewId } from './store.js';
import { setHqAppearancePrefs, useHqLocalPrefs } from './stores/hq-local-prefs.js';
import { TokenGate } from './views/token-gate.js';
import './app.css';
import './syntax-highlight.css';

export type HqViewGroup = 'Operations' | 'Intelligence' | 'System';

export interface HqViewDefinition {
  id: ViewId;
  label: string;
  eyebrow: string;
  description: string;
  group: HqViewGroup;
  icon: LucideIcon;
  shortcut: number;
}

export const HQ_VIEW_DEFINITIONS: readonly HqViewDefinition[] = [
  {
    id: 'cockpit',
    label: 'Cockpit',
    eyebrow: 'Fleet overview',
    description: 'Health, active work, alerts, cost and command shortcuts.',
    group: 'Operations',
    icon: LayoutDashboard,
    shortcut: 1,
  },
  {
    id: 'fleet',
    label: 'Fleet Map',
    eyebrow: 'Topology',
    description: 'Machines, projects, terminals and agents in one live graph.',
    group: 'Operations',
    icon: Network,
    shortcut: 2,
  },
  {
    id: 'console',
    label: 'Live Console',
    eyebrow: 'Transcripts',
    description: 'Stream and inspect session or agent conversations.',
    group: 'Operations',
    icon: MessageSquareText,
    shortcut: 3,
  },
  {
    id: 'mailbox',
    label: 'Mailbox',
    eyebrow: 'Coordination',
    description: 'Cross-project messages, unread work and direct delivery.',
    group: 'Operations',
    icon: Inbox,
    shortcut: 4,
  },
  {
    id: 'alerts',
    label: 'Alerts',
    eyebrow: 'Attention',
    description: 'Active fleet warnings and alert transition history.',
    group: 'Intelligence',
    icon: BellRing,
    shortcut: 5,
  },
  {
    id: 'cost',
    label: 'Cost',
    eyebrow: 'Economics',
    description: 'Project, provider and model spending distribution.',
    group: 'Intelligence',
    icon: CircleDollarSign,
    shortcut: 6,
  },
  {
    id: 'trends',
    label: 'Trends',
    eyebrow: 'Telemetry',
    description: 'Cost, token and tool activity over time.',
    group: 'Intelligence',
    icon: ChartNoAxesCombined,
    shortcut: 7,
  },
  {
    id: 'brain',
    label: 'Brain',
    eyebrow: 'Decisions',
    description: 'Autonomous decisions, escalations and interventions.',
    group: 'Intelligence',
    icon: BrainCircuit,
    shortcut: 8,
  },
  {
    id: 'worktree',
    label: 'Worktrees',
    eyebrow: 'Workspace',
    description: 'Distributed branches, worktrees and ownership state.',
    group: 'System',
    icon: GitBranch,
    shortcut: 9,
  },
  {
    id: 'control',
    label: 'Control',
    eyebrow: 'Command plane',
    description: 'Steer, queue, broadcast and audit remote commands.',
    group: 'System',
    icon: RadioTower,
    shortcut: 0,
  },
];

const GROUPS: readonly HqViewGroup[] = ['Operations', 'Intelligence', 'System'];

const VIEW_COMPONENTS: Record<ViewId, LazyExoticComponent<ComponentType>> = {
  cockpit: lazy(() =>
    import('./views/cockpit.js').then((module) => ({ default: module.CockpitView })),
  ),
  fleet: lazy(() =>
    import('./views/fleet-map.js').then((module) => ({ default: module.FleetMapView })),
  ),
  console: lazy(() =>
    import('./views/live-console.js').then((module) => ({ default: module.LiveConsoleView })),
  ),
  mailbox: lazy(() =>
    import('./views/mailbox.js').then((module) => ({ default: module.MailboxView })),
  ),
  cost: lazy(() => import('./views/cost.js').then((module) => ({ default: module.CostView }))),
  brain: lazy(() => import('./views/brain.js').then((module) => ({ default: module.BrainView }))),
  worktree: lazy(() =>
    import('./views/worktree.js').then((module) => ({ default: module.WorktreeView })),
  ),
  trends: lazy(() =>
    import('./views/trends.js').then((module) => ({ default: module.TrendsView })),
  ),
  alerts: lazy(() =>
    import('./views/alerts.js').then((module) => ({ default: module.AlertsView })),
  ),
  control: lazy(() =>
    import('./views/control.js').then((module) => ({ default: module.ControlView })),
  ),
};

export function getHqViewDefinition(view: ViewId): HqViewDefinition {
  return (
    HQ_VIEW_DEFINITIONS.find((definition) => definition.id === view) ?? HQ_VIEW_DEFINITIONS[0]!
  );
}

interface ViewBoundaryProps {
  view: ViewId;
  children: ReactNode;
}

interface ViewBoundaryState {
  error: string | null;
}

class HqViewBoundary extends Component<ViewBoundaryProps, ViewBoundaryState> {
  state: ViewBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ViewBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidUpdate(previous: ViewBoundaryProps): void {
    if (previous.view !== this.props.view && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="hq-view-error" role="alert">
        <ShieldCheck size={22} />
        <div>
          <strong>This HQ surface stopped safely.</strong>
          <p>{this.state.error}</p>
        </div>
        <button
          type="button"
          className="hq-btn secondary"
          onClick={() => this.setState({ error: null })}
        >
          <RotateCcw size={13} />
          Retry view
        </button>
      </div>
    );
  }
}

export function HqApp(): React.ReactElement {
  const { snapshot, alerts, activeView, authRequired, connected } = useHqStore(
    useShallow((state) => ({
      snapshot: state.snapshot,
      alerts: state.alerts,
      activeView: state.activeView,
      authRequired: state.authRequired,
      connected: state.connected,
    })),
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1180,
  );
  const { theme } = useHqLocalPrefs().appearance;

  useEffect(() => {
    document.documentElement.dataset.hqTheme = theme;
    return () => {
      delete document.documentElement.dataset.hqTheme;
    };
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    fetchJson<HqSnapshot>('/api/snapshot')
      .then((initialSnapshot) => {
        if (!cancelled) useHqStore.getState()._hydrateSnapshot(initialSnapshot);
      })
      .catch(() => {
        /* 401 already handled via markAuthRequired; the WS reconnect loop handles network recovery. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      if (event.altKey && /^\d$/.test(event.key)) {
        const shortcut = Number(event.key);
        const definition = HQ_VIEW_DEFINITIONS.find((candidate) => candidate.shortcut === shortcut);
        if (definition) {
          event.preventDefault();
          useHqStore.getState().setActiveView(definition.id);
        }
        return;
      }
      if (event.key === 'Escape' && sidebarOpen && window.innerWidth < 900) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  if (authRequired) {
    return <TokenGate hadToken={resolveHqToken() !== null} />;
  }

  const totals = snapshot?.totals;
  const unread = totals?.unreadMailboxMessages ?? 0;
  const activeAlerts = alerts.filter((alert) => alert.severity !== 'info').length;
  const current = getHqViewDefinition(activeView);
  const CurrentIcon = current.icon;
  const ActiveView = VIEW_COMPONENTS[activeView];

  const activateView = (view: ViewId): void => {
    useHqStore.getState().setActiveView(view);
    if (window.innerWidth < 900) setSidebarOpen(false);
  };

  return (
    <div className="hq-app" data-theme={theme} data-testid="hq-workbench">
      <button
        type="button"
        className="hq-sidebar-scrim"
        data-open={sidebarOpen}
        aria-label="Close HQ navigation"
        onClick={() => setSidebarOpen(false)}
      />

      <aside className="hq-secondary-nav" data-open={sidebarOpen} aria-label="HQ navigation">
        <div className="hq-secondary-header">
          <div>
            <span className="hq-secondary-eyebrow">Command center</span>
            <strong>WrongStack HQ</strong>
          </div>
          <button
            type="button"
            className="hq-icon-button hq-secondary-close"
            aria-label="Collapse HQ navigation"
            title="Collapse navigation (Ctrl+B)"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <div className="hq-secondary-scroll">
          {GROUPS.map((group) => (
            <section key={group} className="hq-nav-group">
              <div className="hq-nav-group-label">{group}</div>
              {HQ_VIEW_DEFINITIONS.filter((definition) => definition.group === group).map(
                (definition) => {
                  const Icon = definition.icon;
                  const badge =
                    definition.id === 'mailbox'
                      ? unread
                      : definition.id === 'alerts'
                        ? activeAlerts
                        : 0;
                  return (
                    <button
                      key={definition.id}
                      type="button"
                      className="hq-nav-item"
                      data-active={activeView === definition.id}
                      aria-current={activeView === definition.id ? 'page' : undefined}
                      onClick={() => activateView(definition.id)}
                    >
                      <Icon size={15} />
                      <span>{definition.label}</span>
                      <kbd>Alt+{definition.shortcut}</kbd>
                      {badge > 0 ? <span className="hq-nav-badge">{badge}</span> : null}
                    </button>
                  );
                },
              )}
            </section>
          ))}
        </div>

        <div className="hq-secondary-footer">
          <div className="hq-link-state" data-live={connected}>
            <span className="hq-link-dot" />
            <div>
              <strong>{connected ? 'Connected' : 'Reconnecting'}</strong>
              <span>
                {totals?.activeMachines ?? 0} machines · {totals?.activeClients ?? 0} clients
              </span>
            </div>
          </div>
          <span className="hq-build-label">@wrongstack/webui-hq</span>
        </div>
      </aside>

      <section className="hq-workbench">
        <header className="hq-header">
          <button
            type="button"
            className="hq-icon-button hq-sidebar-toggle"
            aria-label={sidebarOpen ? 'Collapse HQ navigation' : 'Expand HQ navigation'}
            aria-expanded={sidebarOpen}
            title="Toggle navigation (Ctrl+B)"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <div className="hq-view-icon" aria-hidden="true">
            <CurrentIcon size={18} />
          </div>
          <div className="hq-view-identity">
            <span>{current.eyebrow}</span>
            <h1>{current.label}</h1>
            <p>{current.description}</p>
          </div>

          <div className="hq-top-metrics">
            <TopMetric icon={Server} label="Machines" value={totals?.activeMachines ?? 0} />
            <TopMetric icon={Users} label="Agents" value={totals?.activeAgents ?? 0} />
            <TopMetric icon={Activity} label="Sessions" value={totals?.activeSessions ?? 0} />
            <TopMetric
              icon={CircleDollarSign}
              label="Cost"
              value={`$${(totals?.totalCostUsd ?? 0).toFixed(2)}`}
              accent
            />
          </div>
          <div className="hq-connection-pill" data-live={connected}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {connected ? 'Live' : 'Reconnecting'}
          </div>
          <button
            type="button"
            className="hq-icon-button hq-theme-toggle"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onClick={() => setHqAppearancePrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        <main className="hq-main" id="hq-main" tabIndex={-1}>
          <HqViewBoundary view={activeView}>
            <Suspense fallback={<ViewLoading label={current.label} />}>
              <ActiveView />
            </Suspense>
          </HqViewBoundary>
        </main>
      </section>
    </div>
  );
}

function TopMetric({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  accent?: boolean | undefined;
}): React.ReactElement {
  return (
    <div className="hq-top-metric" data-accent={accent}>
      <Icon size={12} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ViewLoading({ label }: { label: string }): React.ReactElement {
  return (
    <div className="hq-view-loading" role="status">
      <RadioTower size={18} />
      <span>Loading {label}…</span>
    </div>
  );
}
