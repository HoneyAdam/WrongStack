import type {
  DesktopProjectEntry,
  DesktopRuntimeRecord,
  DesktopStateSnapshot,
  DesktopWebuiStatusSnapshot,
  DesktopWebuiCommand,
} from '../../shared/types.js';
import { getLocale, onLocaleChange, setLocale, SUPPORTED_LOCALES, t } from './i18n.js';
import { iconSvg } from './icons.js';
import type { IconName } from './icons.js';
import './styles.css';

/** Locale code → endonym (shown untranslated so a user finds their language in
 *  any UI language, same principle as the WebUI LANGUAGES list). */
const LOCALE_ENDONYMS: Record<string, string> = {
  en: 'English',
  tr: 'Türkçe',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  es: 'Español',
  'pt-BR': 'Português',
};

const appRootElement = document.querySelector<HTMLDivElement>('#app');
if (!appRootElement) throw new Error('Missing #app root');
const appRoot = appRootElement;

let state: DesktopStateSnapshot = {
  activeRuntimeId: null,
  runtimes: [],
  recentProjects: [],
  registeredProjects: [],
  restoring: false,
};
let webuiStatus: DesktopWebuiStatusSnapshot = { runtimeId: null, status: 'idle' };
let busy = false;
let shellError: string | null = null;
const RUNTIME_GROUP_STORAGE_KEY = 'wrongstack.desktop.runtimeGroups';
const SHELL_SIDEBAR_STORAGE_KEY = 'wrongstack.desktop.sidebarCollapsed';
const DESKTOP_PANEL_STORAGE_KEY = 'wrongstack.desktop.panel';
const PROJECT_TAB_STORAGE_KEY = 'wrongstack.desktop.projectTab';
type DesktopPanel = 'workspace' | 'projects' | 'quick';
type ProjectPickerTab = 'recent' | 'registered' | 'all';
type ProjectPickerVariant = 'dock' | 'full' | 'embedded';
let runtimeGroupState = readRuntimeGroupState();
let shellSidebarCollapsed = readShellSidebarCollapsed();
let desktopPanel: DesktopPanel = readDesktopPanel();
let projectPickerTab: ProjectPickerTab = readProjectPickerTab();
let projectSearch = '';
let launcherFeedback: LauncherFeedback | null = null;
let launcherFeedbackSeq = 0;

interface LauncherFeedback {
  id: number;
  state: 'pending' | 'success' | 'error';
  label: string;
  commandKey?: string | undefined;
  message?: string | undefined;
}

interface RuntimeProjectGroup {
  key: string;
  name: string;
  root: string;
  kind: DesktopRuntimeRecord['kind'];
  sessions: DesktopRuntimeRecord[];
}

function activeRuntime(): DesktopRuntimeRecord | undefined {
  return state.runtimes.find((runtime) => runtime.id === state.activeRuntimeId);
}

function render(): void {
  const active = activeRuntime();
  appRoot.innerHTML = `
    <div class="desktop-shell ${shellSidebarCollapsed ? 'shell-collapsed' : ''}">
      <aside class="sidebar">
        ${renderDesktopRail()}
        ${shellSidebarCollapsed ? '' : renderSidebarPane(active)}
      </aside>

      <main class="stage ${active?.status === 'running' ? 'stage-mounted' : ''}">
        ${renderStage(active)}
      </main>
    </div>
  `;
}

function renderDesktopRail(): string {
  return `
    <nav class="desktop-rail" aria-label="${t('desktopNavAria')}">
      <div class="rail-brand" title="WrongStack Desktop">WS</div>
      <div class="rail-section">
        <button class="rail-button accent" title="${t('openProjectFolderTitle')}" data-action="open-project" ${busy ? 'disabled' : ''}>
          ${iconSvg('folder-plus')}
        </button>
        ${renderDesktopPanelButton(t('workspace'), 'monitor', 'workspace')}
        ${renderDesktopPanelButton(t('projects'), 'folder', 'projects', projectCountLabel())}
        ${renderDesktopPanelButton(t('quickActions'), 'command', 'quick')}
      </div>
      ${renderCollapsedRuntimeButtons()}
      <div class="rail-spacer"></div>
      <select
        class="rail-locale-select"
        data-action="set-locale"
        title="${t('settings')}"
        aria-label="${t('settings')}"
      >
        ${SUPPORTED_LOCALES.map(
          (code) =>
            `<option value="${code}"${code === getLocale() ? ' selected' : ''}>${LOCALE_ENDONYMS[code] ?? code}</option>`,
        ).join('')}
      </select>
      <button class="rail-button" title="${t('globalSettings')}" data-action="open-settings" ${busy ? 'disabled' : ''}>
        ${iconSvg('settings')}
      </button>
      <button
        class="rail-button rail-toggle"
        title="${shellSidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}"
        data-action="toggle-shell-sidebar"
        aria-label="${shellSidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}"
        aria-pressed="${shellSidebarCollapsed ? 'true' : 'false'}"
      >
        ${iconSvg('chevron')}
      </button>
    </nav>
  `;
}

function renderDesktopPanelButton(
  label: string,
  icon: IconName,
  panel: DesktopPanel,
  badge?: string,
): string {
  const active = desktopPanel === panel;
  return `
    <button
      class="rail-button ${active ? 'active' : ''}"
      title="${escapeAttr(label)}"
      data-action="select-desktop-panel"
      data-panel="${escapeAttr(panel)}"
      aria-pressed="${active ? 'true' : 'false'}"
    >
      ${iconSvg(icon)}
      ${badge ? `<span class="rail-badge">${escapeHtml(badge)}</span>` : ''}
    </button>
  `;
}

function renderCollapsedRuntimeButtons(): string {
  if (state.runtimes.length === 0) return '';
  return `
    <div class="rail-divider"></div>
    <div class="rail-runtime-list">
      ${state.runtimes.map(renderCollapsedRuntimeButton).join('')}
    </div>
  `;
}

function renderCollapsedRuntimeButton(runtime: DesktopRuntimeRecord): string {
  const active = runtime.id === state.activeRuntimeId;
  return `
    <button
      class="rail-runtime ${active ? 'active' : ''}"
      title="${escapeAttr(`${runtime.name} · ${runtime.root}`)}"
      data-action="activate"
      data-runtime="${escapeAttr(runtime.id)}"
    >
      <span class="status-dot status-${runtime.status}"></span>
      <span>${escapeHtml(runtimeInitials(runtime))}</span>
    </button>
  `;
}

function renderSidebarPane(active: DesktopRuntimeRecord | undefined): string {
  return `
    <section class="sidebar-pane">
      ${renderPaneHeader(active)}
      ${renderPaneBody(active)}
    </section>
  `;
}

function renderPaneHeader(active: DesktopRuntimeRecord | undefined): string {
  const title =
    desktopPanel === 'projects' ? t('projects') : desktopPanel === 'quick' ? t('quick') : t('workspace');
  const subtitle =
    desktopPanel === 'projects'
      ? `${projectCountLabel()} projects`
      : desktopPanel === 'quick'
        ? active?.status === 'running'
          ? t('webuiCommands')
          : t('noActiveWebui')
        : active
          ? active.name
          : state.restoring
            ? t('restoring')
            : t('noProject');
  return `
    <header class="pane-header">
      <div class="pane-title-block">
        <div class="pane-kicker">WrongStack</div>
        <div class="pane-title">${escapeHtml(title)}</div>
      </div>
      <div class="pane-subtitle" title="${escapeAttr(subtitle)}">${escapeHtml(subtitle)}</div>
    </header>
  `;
}

function renderPaneBody(active: DesktopRuntimeRecord | undefined): string {
  if (desktopPanel === 'projects') {
    return `
      <div class="pane-body pane-body-scroll">
        ${renderShellError()}
        ${renderProjectsMenu()}
      </div>
    `;
  }
  if (desktopPanel === 'quick') {
    return `
      <div class="pane-body pane-body-scroll">
        ${renderShellError()}
        ${renderLauncher(active)}
        ${renderActiveProject(active)}
      </div>
    `;
  }
  return `
    <div class="pane-body workspace-pane">
      <div class="workspace-main">
        ${renderShellError()}
        ${renderActiveProject(active)}
        ${renderRuntimeList()}
      </div>
      <div class="workspace-projects">
        ${renderProjectPicker('dock')}
      </div>
    </div>
  `;
}

function renderProjectsMenu(): string {
  return `
    <div class="projects-menu-stack">
      ${renderLauncherFeedback()}
      ${renderProjectSessionTree()}
      ${renderProjectPicker('embedded')}
    </div>
  `;
}

function renderShellError(): string {
  if (!shellError) return '';
  return `
    <div class="shell-error" role="alert">
      <div class="shell-error-copy">${escapeHtml(shellError)}</div>
      <button class="icon-button" title="${t('dismiss')}" data-action="clear-error">
        ${iconSvg('x')}
      </button>
    </div>
  `;
}

function renderActiveProject(active: DesktopRuntimeRecord | undefined): string {
  if (!active) {
    return `
      <section class="panel active-panel">
        <header class="panel-header">
        <span>${t('active')}</span>
        <span class="status-chip idle">${state.restoring ? t('restoring') : t('idle')}</span>
      </header>
        <div class="project-empty">${state.restoring ? `${t('restoring')}...` : t('noProject')}</div>
      </section>
    `;
  }

  return `
    <section class="panel active-panel">
      <header class="panel-header">
        <span>${t('active')}</span>
        <span class="status-chip ${active.status}">${escapeHtml(runtimeStatusLabel(active))}</span>
      </header>
      <div class="active-project">
        <div class="active-title">${escapeHtml(active.name)}</div>
        ${active.kind === 'global-settings' ? `<div class="runtime-kind">${t('globalSettingsWorkspace')}</div>` : ''}
        <div class="active-path">${escapeHtml(active.root)}</div>
        <div class="active-meta">
          <span>HTTP ${active.httpPort}</span>
          <span>WS ${active.wsPort}</span>
        </div>
        ${renderWebuiStatus(active)}
        ${
          active.error
            ? `<div class="runtime-error">${escapeHtml(active.error)}</div>`
            : ''
        }
        ${renderRuntimeLogs(active)}
      </div>
      <div class="action-row project-action-row ${active.kind === 'project' ? '' : 'compact-actions'}">
        ${
          active.kind === 'project'
            ? `<button class="secondary-action project-session-action" data-action="new-project-session" data-runtime="${escapeAttr(active.id)}">
          ${iconSvg('plus')}<span>${t('newSession')}</span>
        </button>`
            : ''
        }
        <button class="icon-tool-button" title="${t('revealProjectFolder')}" data-action="reveal-root" data-runtime="${escapeAttr(active.id)}">
          ${iconSvg('folder')}
        </button>
        <button class="icon-tool-button" title="${t('openInBrowser')}" data-action="open-browser" data-runtime="${escapeAttr(active.id)}">
          ${iconSvg('external')}
        </button>
        <button class="icon-tool-button" title="${t('refresh')}" data-action="reload-webui" data-runtime="${escapeAttr(active.id)}">
          ${iconSvg('refresh')}
        </button>
      </div>
    </section>
  `;
}

function renderWebuiStatus(active: DesktopRuntimeRecord): string {
  const status = effectiveWebuiStatus(active);
  const pending =
    webuiStatus.runtimeId === active.id && webuiStatus.pendingCommands
      ? ` · ${webuiStatus.pendingCommands} queued`
      : '';
  const prefs = renderWebuiPrefBadges(active);
  const label = status === 'ready' ? t('webuiReady') : status === 'loading' ? t('webuiLoading') : status === 'error' ? t('webuiError') : t('webuiIdle');
  return `
    <div class="webui-state">
      <span class="status-dot status-${status === 'ready' ? 'running' : status === 'error' ? 'error' : status === 'loading' ? 'starting' : 'stopped'}"></span>
      <span>${escapeHtml(`${label}${pending}${prefs}`)}</span>
      ${webuiStatus.error && webuiStatus.runtimeId === active.id ? `<span class="webui-error">${escapeHtml(webuiStatus.error)}</span>` : ''}
    </div>
  `;
}

function renderWebuiPrefBadges(active: DesktopRuntimeRecord): string {
  if (webuiStatus.runtimeId !== active.id || !webuiStatus.prefs) return '';
  const labels: string[] = [];
  if (webuiStatus.prefs.yolo === true) labels.push(t('yolo'));
  if (webuiStatus.prefs.nextPrediction === true) labels.push(t('next'));
  if (webuiStatus.prefs.contextAutoCompact === true) labels.push(t('compact'));
  return labels.length > 0 ? ` · ${labels.join(' · ')}` : '';
}

function renderRuntimeLogs(active: DesktopRuntimeRecord): string {
  const logs = active.recentLogs?.filter((line) => line.trim()) ?? [];
  if (logs.length === 0) return '';
  return `
    <details class="runtime-log-details" ${active.status === 'error' ? 'open' : ''}>
      <summary>WebUI output <span>${logs.length}</span></summary>
      <pre>${logs.map(escapeHtml).join('\n')}</pre>
    </details>
  `;
}

function renderLauncher(active: DesktopRuntimeRecord | undefined): string {
  const enabled = Boolean(
    active && active.status === 'running' && effectiveWebuiStatus(active) !== 'error',
  );
  const disabled = enabled ? '' : 'disabled';
  const yoloActive = Boolean(
    active && webuiStatus.runtimeId === active.id && webuiStatus.prefs?.yolo === true,
  );
  return `
    <section class="panel launcher-panel">
      <header class="panel-header">
        <span>${t('quick')}</span>
        <span class="count">${enabled ? t('ready') : t('offline')}</span>
      </header>
      ${renderLauncherFeedback()}
      <div class="quick-action-grid">
        ${[
          renderShortcut(t('chat'), 'message', { activity: 'chat', view: 'chat' }, disabled),
          renderShortcut(t('prompt'), 'cursor', { action: 'focus-chat' }, disabled),
          renderShortcut(t('terminal'), 'terminal', { terminal: true }, disabled),
          renderShortcut(t('newTerm'), 'plus', { terminal: 'new' }, disabled),
          renderShortcut(t('yolo'), 'shield', { pref: { key: 'yolo', toggle: true } }, disabled, yoloActive),
        ].join('')}
      </div>
    </section>
  `;
}

function renderProjectPicker(variant: ProjectPickerVariant): string {
  const recentProjects = dedupeProjects(state.recentProjects);
  const registeredProjects = dedupeProjects(state.registeredProjects);
  const allProjects = dedupeProjects([...registeredProjects, ...recentProjects]);
  const tabProjects =
    projectPickerTab === 'recent'
      ? recentProjects
      : projectPickerTab === 'registered'
        ? registeredProjects
        : allProjects;
  const query = projectSearch.trim();
  const filteredProjects = query
    ? tabProjects.filter((project) => projectMatchesSearch(project, query))
    : tabProjects;
  const limit = variant === 'dock' ? 8 : variant === 'embedded' ? 18 : 48;
  const visibleProjects = filteredProjects.slice(0, limit);
  const visibleTotal = visibleProjects.length;
  const filteredTotal = filteredProjects.length;
  const total = allProjects.length;
  return `
    <section class="panel projects-panel projects-panel-${variant}">
      <header class="panel-header projects-header">
        <span>${t('projects')}</span>
        <span class="panel-header-actions">
          <span class="count">${visibleTotal}/${filteredTotal || total}</span>
          <button class="panel-header-button" title="${t('registerProjectFolder')}" data-action="register-project" ${busy ? 'disabled' : ''}>
            ${iconSvg('folder-plus')}
          </button>
        </span>
      </header>
      <div class="project-picker">
        ${renderProjectTabs(recentProjects.length, registeredProjects.length, allProjects.length)}
        <div class="project-search-row">
          ${iconSvg('search')}
          <input
            class="project-search-input"
            type="search"
            value="${escapeAttr(projectSearch)}"
            placeholder="${t('findProject')}"
            aria-label="${t('findProject')}"
            autocomplete="off"
            spellcheck="false"
          />
          ${
            projectSearch
              ? `<button class="project-search-clear" title="${t('clearProjectSearch')}" data-action="clear-project-search">${iconSvg('x')}</button>`
              : ''
          }
        </div>
        ${
          variant === 'full' || variant === 'embedded'
            ? `<div class="project-picker-actions">
          <button class="secondary-action compact-action" data-action="open-project" ${busy ? 'disabled' : ''}>
            ${iconSvg('folder')}<span>${t('open')}</span>
          </button>
          <button class="secondary-action compact-action" data-action="register-project" ${busy ? 'disabled' : ''}>
            ${iconSvg('folder-plus')}<span>${t('register')}</span>
          </button>
        </div>`
            : ''
        }
        ${
          visibleProjects.length === 0
            ? `<div class="empty compact-empty">${total === 0 ? t('noRegisteredProjects') : t('noMatchingProjects')}</div>`
            : `<div class="project-list">${visibleProjects.map(renderProjectItem).join('')}</div>`
        }
      </div>
    </section>
  `;
}

function renderProjectTabs(recentCount: number, registeredCount: number, allCount: number): string {
  return `
    <div class="project-tabs" role="tablist" aria-label="${t('projectLists')}">
      ${renderProjectTab('recent', t('recent'), recentCount)}
      ${renderProjectTab('registered', t('registered'), registeredCount)}
      ${renderProjectTab('all', t('all'), allCount)}
    </div>
  `;
}

function renderProjectTab(tab: ProjectPickerTab, label: string, count: number): string {
  const active = projectPickerTab === tab;
  return `
    <button
      class="project-tab ${active ? 'active' : ''}"
      data-action="set-project-tab"
      data-project-tab="${escapeAttr(tab)}"
      role="tab"
      aria-selected="${active ? 'true' : 'false'}"
    >
      <span>${escapeHtml(label)}</span>
      <span>${count}</span>
    </button>
  `;
}

function renderProjectItem(project: DesktopProjectEntry): string {
  const openRuntime = state.runtimes.find((runtime) => sameProjectRoot(runtime.root, project.root));
  const registered = state.registeredProjects.some((item) => sameProjectRoot(item.root, project.root));
  const recent = state.recentProjects.some((item) => sameProjectRoot(item.root, project.root));
  const title = project.name || basenameFromPath(project.root) || project.root;
  const subtitle = project.lastWorkingDir || project.root;
  const actionLabel = openRuntime ? t('quickView') : registered ? t('openRegisteredProject') : t('openProject');
  return `
    <div class="project-item-row ${openRuntime ? 'open' : ''} ${registered ? 'registered' : ''} ${recent ? 'recent' : ''}">
      <button
        class="project-item-main"
        data-action="${openRuntime ? 'activate' : 'open-project-path'}"
        ${openRuntime ? `data-runtime="${escapeAttr(openRuntime.id)}"` : `data-project-root="${escapeAttr(project.root)}"`}
        title="${escapeAttr(`${actionLabel} · ${project.root}`)}"
      >
        ${iconSvg(openRuntime ? 'project' : registered ? 'folder-plus' : 'folder')}
        <span class="project-item-copy">
          <span class="project-item-title">${escapeHtml(title)}</span>
          <span class="project-item-path">${escapeHtml(subtitle)}</span>
        </span>
        <span class="project-source-tags">
          ${registered ? `<span class="project-source-tag registered-tag">${t('registered')}</span>` : ''}
          ${recent ? `<span class="project-source-tag recent-tag">${t('recent')}</span>` : ''}
        </span>
        ${openRuntime ? `<span class="project-open-dot" title="${t('open')}"></span>` : ''}
      </button>
      ${
        registered
          ? `<button
        class="project-remove-button"
        data-action="unregister-project"
        data-project-root="${escapeAttr(project.root)}"
        title="${t('removeFromProjectRegistry')}"
        aria-label="${t('removeFromProjectRegistry')}"
      >
        ${iconSvg('x')}
      </button>`
          : '<span></span>'
      }
    </div>
  `;
}

function projectMatchesSearch(project: DesktopProjectEntry, query: string): boolean {
  const haystack = [
    project.name,
    project.root,
    project.slug,
    project.lastWorkingDir,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function renderLauncherFeedback(): string {
  if (!launcherFeedback) return '';
  const icon =
    launcherFeedback.state === 'success'
      ? 'check'
      : launcherFeedback.state === 'error'
        ? 'x'
        : 'pulse';
  const text =
    launcherFeedback.message ??
    (launcherFeedback.state === 'pending'
      ? `Opening ${launcherFeedback.label}...`
      : launcherFeedback.state === 'success'
        ? `${launcherFeedback.label} opened`
        : `${launcherFeedback.label} failed`);
  return `
    <div class="launcher-feedback ${launcherFeedback.state}" role="status">
      ${iconSvg(icon)}
      <span>${escapeHtml(text)}</span>
    </div>
  `;
}

function effectiveWebuiStatus(active: DesktopRuntimeRecord): DesktopWebuiStatusSnapshot['status'] {
  if (webuiStatus.runtimeId === active.id) return webuiStatus.status;
  return active.status === 'running' ? 'loading' : 'idle';
}

function renderShortcut(
  label: string,
  icon: IconName,
  command: DesktopWebuiCommand,
  disabled: string,
  active = false,
): string {
  const commandKey = launcherCommandKey(command);
  const pending = launcherFeedback?.state === 'pending' && launcherFeedback.commandKey === commandKey;
  const disabledAttr = disabled || pending ? 'disabled' : '';
  return `
    <button
      class="shortcut-button ${active ? 'active-shortcut' : ''} ${pending ? 'pending-shortcut' : ''}"
      data-action="webui-command"
      data-command="${escapeAttr(commandKey)}"
      data-label="${escapeAttr(label)}"
      title="${escapeAttr(label)}"
      aria-pressed="${active ? 'true' : 'false'}"
      aria-busy="${pending ? 'true' : 'false'}"
      ${disabledAttr}
    >
      ${iconSvg(icon)}<span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderRuntimeList(): string {
  const groups = groupRuntimesByProject(state.runtimes);
  return `
    <section class="panel runtime-panel">
      <header class="panel-header">
        <span>${t('runtimes')}</span>
        <span class="count">${groups.length}/${state.runtimes.length}</span>
      </header>
      <div class="runtime-list">
        ${
          state.runtimes.length === 0
            ? `<div class="empty">${t('none')}</div>`
            : groups.map(renderRuntimeGroup).join('')
        }
      </div>
    </section>
  `;
}

function renderProjectSessionTree(): string {
  const groups = groupRuntimesByProject(state.runtimes).filter((group) => group.kind === 'project');
  return `
    <section class="panel runtime-panel project-sessions-panel">
      <header class="panel-header">
        <span>${t('sessions')}</span>
        <span class="count">${groups.length}/${groups.reduce((sum, group) => sum + group.sessions.length, 0)}</span>
      </header>
      <div class="runtime-list project-session-tree">
        ${
          groups.length === 0
            ? `<div class="empty compact-empty">${state.restoring ? `${t('restoring')}...` : t('noOpenProjectSessions')}</div>`
            : groups.map(renderRuntimeGroup).join('')
        }
      </div>
    </section>
  `;
}

function groupRuntimesByProject(runtimes: DesktopRuntimeRecord[]): RuntimeProjectGroup[] {
  const groups = new Map<string, RuntimeProjectGroup>();
  for (const runtime of runtimes) {
    const key = runtimeProjectKey(runtime);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(runtime);
      continue;
    }
    groups.set(key, {
      key,
      name: runtime.kind === 'global-settings' ? t('globalSettings') : basenameFromPath(runtime.root) || runtime.name,
      root: runtime.root,
      kind: runtime.kind,
      sessions: [runtime],
    });
  }
  return [...groups.values()];
}

function runtimeProjectKey(runtime: DesktopRuntimeRecord): string {
  if (runtime.kind === 'global-settings') return 'global-settings';
  return `${runtime.kind}:${normalizeRuntimeRoot(runtime.root) || runtime.id}`;
}

function normalizeRuntimeRoot(root: string): string {
  return root.replace(/\\/g, '/').replace(/\/+$/g, '').trim().toLowerCase();
}

function sameProjectRoot(left: string, right: string): boolean {
  return normalizeRuntimeRoot(left) === normalizeRuntimeRoot(right);
}

function dedupeProjects(projects: DesktopProjectEntry[]): DesktopProjectEntry[] {
  const seen = new Set<string>();
  const next: DesktopProjectEntry[] = [];
  for (const project of projects) {
    const key = normalizeRuntimeRoot(project.root);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(project);
  }
  return next;
}

function basenameFromPath(root: string): string {
  const normalized = root.replace(/\\/g, '/').replace(/\/+$/g, '').trim();
  if (!normalized) return root;
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function renderRuntimeGroup(group: RuntimeProjectGroup): string {
  const active = group.sessions.some((runtime) => runtime.id === state.activeRuntimeId);
  const firstSession = group.sessions[0];
  const open = runtimeGroupIsOpen(group);
  const sessionLabel = group.sessions.length === 1 ? '1 session' : `${group.sessions.length} sessions`;
  return `
    <div class="runtime-project-group ${active ? 'active' : ''} ${open ? 'open' : 'collapsed'}" data-runtime-group="${escapeAttr(group.key)}">
      <div class="runtime-project-header">
        <button
          class="runtime-project-toggle"
          data-action="toggle-runtime-group"
          data-runtime-group-key="${escapeAttr(group.key)}"
          aria-expanded="${open ? 'true' : 'false'}"
          title="${escapeAttr(group.root)}"
        >
          <span class="runtime-chevron">${iconSvg('chevron')}</span>
          ${iconSvg(group.kind === 'global-settings' ? 'settings' : 'folder')}
          <span class="runtime-project-copy">
            <span class="runtime-name">${escapeHtml(group.name)}</span>
            <span class="runtime-path">${escapeHtml(group.root)}</span>
          </span>
          ${renderRuntimeGroupStatus(group)}
          <span class="runtime-session-count">${escapeHtml(sessionLabel)}</span>
        </button>
        ${
          group.kind === 'project' && firstSession
            ? `<button class="icon-button runtime-add-session" title="${t('newSession')}" data-action="new-project-session" data-runtime="${escapeAttr(firstSession.id)}">
          ${iconSvg('plus')}
        </button>`
            : ''
        }
      </div>
      ${
        open
          ? `<div class="runtime-session-list">
        ${group.sessions.map((runtime, index) => renderRuntimeSession(runtime, index + 1)).join('')}
      </div>`
          : ''
      }
    </div>
  `;
}

function runtimeGroupIsOpen(group: RuntimeProjectGroup): boolean {
  if (group.sessions.some((runtime) => runtime.id === state.activeRuntimeId)) return true;
  const stored = runtimeGroupState[group.key];
  if (typeof stored === 'boolean') return stored;
  return state.runtimes.length === group.sessions.length;
}

function renderRuntimeGroupStatus(group: RuntimeProjectGroup): string {
  const statuses: DesktopRuntimeRecord['status'][] = ['error', 'starting', 'running', 'stopped'];
  const activeStatuses = statuses.filter((status) =>
    group.sessions.some((runtime) => runtime.status === status),
  );
  return `
    <span class="runtime-status-stack" aria-hidden="true">
      ${activeStatuses
        .map((status) => `<span class="status-dot status-${escapeAttr(status)}"></span>`)
        .join('')}
    </span>
  `;
}

function renderRuntimeSession(runtime: DesktopRuntimeRecord, index: number): string {
  const isActive = runtime.id === state.activeRuntimeId;
  const label = runtime.kind === 'global-settings' ? t('settings') : `Session ${index}`;
  const meta = runtime.status === 'error'
    ? runtime.error ?? t('error')
    : `HTTP ${runtime.httpPort} · WS ${runtime.wsPort}`;
  const disabled = runtime.status === 'running' ? '' : 'disabled';
  return `
    <div class="runtime-session-row ${isActive ? 'active' : ''}">
      <button class="runtime-session-main" data-action="activate" data-runtime="${escapeAttr(runtime.id)}" title="${escapeAttr(runtime.root)}">
        <span class="status-dot status-${runtime.status}"></span>
        <span class="runtime-session-copy">
          <span class="runtime-session-title">${escapeHtml(label)}</span>
          <span class="runtime-session-meta">${escapeHtml(meta)}</span>
        </span>
      </button>
      <div class="runtime-session-actions" aria-label="${escapeAttr(label)} actions">
        <button class="runtime-session-action primary" title="${t('quickView')}" data-action="activate" data-runtime="${escapeAttr(runtime.id)}">
          ${iconSvg('monitor')}<span>${t('quick')}</span>
        </button>
        <button class="runtime-session-action" title="${t('openChat')}" data-action="session-webui-command" data-runtime="${escapeAttr(runtime.id)}" data-command="${escapeAttr(launcherCommandKey({ activity: 'chat', view: 'chat' }))}" data-label="Chat" ${disabled}>
          ${iconSvg('message')}<span>${t('chat')}</span>
        </button>
        <button class="runtime-session-action" title="${t('openTerminal')}" data-action="session-webui-command" data-runtime="${escapeAttr(runtime.id)}" data-command="${escapeAttr(launcherCommandKey({ terminal: 'toggle' }))}" data-label="Terminal" ${disabled}>
          ${iconSvg('terminal')}<span>${t('term')}</span>
        </button>
        <button class="runtime-session-action" title="${t('openFiles')}" data-action="session-webui-command" data-runtime="${escapeAttr(runtime.id)}" data-command="${escapeAttr(launcherCommandKey({ activity: 'files', view: 'files' }))}" data-label="Files" ${disabled}>
          ${iconSvg('files')}<span>${t('files')}</span>
        </button>
        <button class="runtime-session-icon" title="${t('openInBrowser')}" data-action="open-browser" data-runtime="${escapeAttr(runtime.id)}" ${disabled}>
          ${iconSvg('external')}
        </button>
        <button class="runtime-session-icon" title="${t('refresh')}" data-action="session-reload-webui" data-runtime="${escapeAttr(runtime.id)}" ${disabled}>
          ${iconSvg('refresh')}
        </button>
        <button class="runtime-session-icon danger" title="${t('closeSession')}" data-action="close" data-runtime="${escapeAttr(runtime.id)}">
          ${iconSvg('x')}
        </button>
      </div>
    </div>
  `;
}

function renderStage(active: DesktopRuntimeRecord | undefined): string {
  if (active?.status === 'running') {
    return '<div class="mount-shadow"></div>';
  }
  if (active?.status === 'starting') {
    return `
      <section class="stage-card">
        <div class="stage-kicker">${t('starting')}</div>
        <h1>${escapeHtml(active.name)}</h1>
        <div class="stage-path">${escapeHtml(active.root)}</div>
      </section>
    `;
  }
  if (active?.status === 'error') {
    return `
      <section class="stage-card error-card">
        <div class="stage-kicker">${t('runtimeError')}</div>
        <h1>${escapeHtml(active.name)}</h1>
        <pre>${escapeHtml(active.error ?? t('unknownError'))}</pre>
        ${renderRuntimeLogs(active)}
      </section>
    `;
  }
  return `
    <section class="stage-card">
      <div class="stage-kicker">WrongStack Desktop</div>
      <h1>${state.restoring ? t('restoring') : t('openProject')}</h1>
      <div class="stage-actions">
        <button class="primary-action inline" data-action="open-project" ${busy ? 'disabled' : ''}>
          ${iconSvg('folder-plus')}<span>${t('openProject')}</span>
        </button>
        <button class="secondary-action inline" data-action="register-project" ${busy ? 'disabled' : ''}>
          ${iconSvg('folder')}<span>${t('register')}</span>
        </button>
        <button class="secondary-action inline" data-action="open-settings" ${busy ? 'disabled' : ''}>
          ${iconSvg('settings')}<span>${t('settings')}</span>
        </button>
      </div>
    </section>
  `;
}

function runtimeStatusLabel(runtime: DesktopRuntimeRecord): string {
  if (runtime.status === 'starting') return t('starting');
  if (runtime.status === 'running') return t('running');
  if (runtime.status === 'error') return t('error');
  return t('stopped');
}

async function refresh(): Promise<void> {
  const [nextState, nextWebuiStatus] = await Promise.all([
    window.wrongstackDesktop.getState(),
    window.wrongstackDesktop.getWebuiStatus(),
  ]);
  state = nextState;
  webuiStatus = nextWebuiStatus;
  render();
}

async function withBusy(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  shellError = null;
  render();
  try {
    await fn();
  } catch (err) {
    shellError = toErrorMessage(err);
    console.error(err);
  } finally {
    busy = false;
    render();
  }
}

window.addEventListener('keydown', (event) => {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    void window.wrongstackDesktop.navigateWebui({ action: 'open-command-palette' });
  }
});

appRoot.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement | null;
  if (!target?.classList.contains('project-search-input')) return;
  const cursor = target.selectionStart ?? target.value.length;
  projectSearch = target.value;
  render();
  focusProjectSearch(cursor);
});

// Language picker (a <select>, so it fires `change`). setLocale updates the
// renderer chrome instantly + pushes to main, which persists it to the shared
// config so every other surface (webui, menu) follows.
appRoot.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement | null;
  if (target?.dataset.action !== 'set-locale') return;
  const match = SUPPORTED_LOCALES.find((c) => c === target.value);
  if (match && match !== getLocale()) {
    setLocale(match);
    render();
  }
});

appRoot.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const actionTarget = target?.closest<HTMLElement>('[data-action]');
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  const runtimeId = actionTarget.dataset.runtime;

  if (action === 'webui-command') {
    const raw = actionTarget.dataset.command;
    if (!raw) return;
    const label = actionTarget.dataset.label ?? t('command');
    const commandKey = raw;
    try {
      const command = JSON.parse(raw) as DesktopWebuiCommand;
      setLauncherFeedback({
        state: 'pending',
        label,
        commandKey,
      });
      void window.wrongstackDesktop
        .navigateWebui(command)
        .then((ok) => {
          if (ok) {
            setLauncherFeedback({
              state: 'success',
              label,
              commandKey,
            });
            return;
          }
          const message = t('launcherError');
          shellError = message;
          setLauncherFeedback({
            state: 'error',
            label,
            commandKey,
            message,
          });
        })
        .catch(() => {
          shellError = t('launcherError');
          setLauncherFeedback({
            state: 'error',
            label,
            commandKey,
            message: t('launcherError'),
          });
        });
    } catch {
      /* malformed DOM data should not break the shell */
    }
    return;
  }

  if (action === 'session-webui-command') {
    if (!runtimeId) return;
    const raw = actionTarget.dataset.command;
    if (!raw) return;
    const label = actionTarget.dataset.label ?? 'WebUI';
    const commandKey = raw;
    try {
      const command = JSON.parse(raw) as DesktopWebuiCommand;
      setLauncherFeedback({
        state: 'pending',
        label,
        commandKey: `${runtimeId}:${commandKey}`,
      });
      void withBusy(async () => {
        state = await window.wrongstackDesktop.activateRuntime(runtimeId);
        const ok = await window.wrongstackDesktop.navigateWebui(command);
        if (ok) {
          setLauncherFeedback({
            state: 'success',
            label,
            commandKey: `${runtimeId}:${commandKey}`,
          });
          return;
        }
        const message = t('sessionLauncherError');
        shellError = message;
        setLauncherFeedback({
          state: 'error',
          label,
          commandKey: `${runtimeId}:${commandKey}`,
          message,
        });
      });
    } catch {
      /* malformed DOM data should not break the shell */
    }
    return;
  }

  if (action === 'clear-error') {
    shellError = null;
    render();
    return;
  }

  if (action === 'clear-project-search') {
    projectSearch = '';
    render();
    focusProjectSearch(0);
    return;
  }

  if (action === 'toggle-shell-sidebar') {
    shellSidebarCollapsed = !shellSidebarCollapsed;
    writeShellSidebarCollapsed();
    void window.wrongstackDesktop.setShellSidebarCollapsed(shellSidebarCollapsed);
    render();
    return;
  }

  if (action === 'select-desktop-panel') {
    const panel = parseDesktopPanel(actionTarget.dataset.panel);
    if (!panel) return;
    desktopPanel = panel;
    writeDesktopPanel();
    render();
    return;
  }

  if (action === 'set-project-tab') {
    const tab = parseProjectPickerTab(actionTarget.dataset.projectTab);
    if (!tab) return;
    projectPickerTab = tab;
    writeProjectPickerTab();
    render();
    return;
  }

  if (action === 'toggle-runtime-group') {
    const key = actionTarget.dataset.runtimeGroupKey;
    if (!key) return;
    const group = groupRuntimesByProject(state.runtimes).find((item) => item.key === key);
    if (!group) return;
    runtimeGroupState = { ...runtimeGroupState, [key]: !runtimeGroupIsOpen(group) };
    writeRuntimeGroupState();
    render();
    return;
  }

  void withBusy(async () => {
    if (action === 'open-project') {
      state = await window.wrongstackDesktop.openProject();
    } else if (action === 'register-project') {
      state = await window.wrongstackDesktop.registerProject();
    } else if (action === 'open-project-path') {
      const root = actionTarget.dataset.projectRoot;
      if (root) state = await window.wrongstackDesktop.openProject(root);
    } else if (action === 'unregister-project') {
      const root = actionTarget.dataset.projectRoot;
      if (root) state = await window.wrongstackDesktop.unregisterProject(root);
    } else if (action === 'new-project-session') {
      state = await window.wrongstackDesktop.openProjectSession(runtimeId);
    } else if (action === 'open-settings') {
      state = await window.wrongstackDesktop.openSettings();
    } else if (action === 'activate' && runtimeId) {
      state = await window.wrongstackDesktop.activateRuntime(runtimeId);
    } else if (action === 'close' && runtimeId) {
      state = await window.wrongstackDesktop.closeRuntime(runtimeId);
    } else if (action === 'open-browser' && runtimeId) {
      await window.wrongstackDesktop.openRuntimeInBrowser(runtimeId);
    } else if (action === 'reveal-root' && runtimeId) {
      await window.wrongstackDesktop.revealRuntimeRoot(runtimeId);
    } else if (action === 'reload-webui' && runtimeId) {
      await window.wrongstackDesktop.reloadWebui();
    } else if (action === 'session-reload-webui' && runtimeId) {
      state = await window.wrongstackDesktop.activateRuntime(runtimeId);
      await window.wrongstackDesktop.reloadWebui();
    }
  });
});

window.wrongstackDesktop.onStateChanged((next) => {
  state = next;
  render();
});

window.wrongstackDesktop.onWebuiStatusChanged((next) => {
  webuiStatus = next;
  render();
});

window.wrongstackDesktop.onShellSidebarCollapsedChanged((collapsed) => {
  shellSidebarCollapsed = collapsed;
  writeShellSidebarCollapsed();
  render();
});

// Re-render whenever the locale changes — user picker OR a config push from
// main (another surface changed the shared language).
onLocaleChange(() => render());

void refresh();
void window.wrongstackDesktop.setShellSidebarCollapsed(shellSidebarCollapsed);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return t('operationFailed');
}

function readRuntimeGroupState(): Record<string, boolean> {
  return readBooleanRecord(RUNTIME_GROUP_STORAGE_KEY);
}

function readShellSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SHELL_SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeShellSidebarCollapsed(): void {
  try {
    window.localStorage.setItem(SHELL_SIDEBAR_STORAGE_KEY, String(shellSidebarCollapsed));
  } catch {
    /* best-effort UI preference */
  }
}

function readDesktopPanel(): DesktopPanel {
  return parseDesktopPanel(readLocalStorageValue(DESKTOP_PANEL_STORAGE_KEY)) ?? 'workspace';
}

function writeDesktopPanel(): void {
  try {
    window.localStorage.setItem(DESKTOP_PANEL_STORAGE_KEY, desktopPanel);
  } catch {
    /* best-effort UI preference */
  }
}

function readProjectPickerTab(): ProjectPickerTab {
  return parseProjectPickerTab(readLocalStorageValue(PROJECT_TAB_STORAGE_KEY)) ?? 'recent';
}

function writeProjectPickerTab(): void {
  try {
    window.localStorage.setItem(PROJECT_TAB_STORAGE_KEY, projectPickerTab);
  } catch {
    /* best-effort UI preference */
  }
}

function readLocalStorageValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseDesktopPanel(value: unknown): DesktopPanel | null {
  return value === 'workspace' || value === 'projects' || value === 'quick' ? value : null;
}

function parseProjectPickerTab(value: unknown): ProjectPickerTab | null {
  return value === 'recent' || value === 'registered' || value === 'all' ? value : null;
}

function readBooleanRecord(key: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const next: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') next[key] = value;
    }
    return next;
  } catch {
    return {};
  }
}

function writeRuntimeGroupState(): void {
  writeBooleanRecord(RUNTIME_GROUP_STORAGE_KEY, runtimeGroupState);
}

function writeBooleanRecord(key: string, value: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort UI preference */
  }
}

function launcherCommandKey(command: DesktopWebuiCommand): string {
  return JSON.stringify(command);
}

function runtimeInitials(runtime: DesktopRuntimeRecord): string {
  const source = runtime.kind === 'global-settings' ? t('gs') : runtime.name || basenameFromPath(runtime.root);
  const words = source
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const initials =
    words.length >= 2 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : source.slice(0, 2);
  return initials.toUpperCase();
}

function projectCountLabel(): string {
  return String(dedupeProjects([...state.recentProjects, ...state.registeredProjects]).length);
}

function setLauncherFeedback(next: Omit<LauncherFeedback, 'id'>): void {
  launcherFeedbackSeq += 1;
  const id = launcherFeedbackSeq;
  launcherFeedback = { id, ...next };
  render();
  if (next.state === 'pending') return;
  window.setTimeout(() => {
    if (launcherFeedback?.id !== id) return;
    launcherFeedback = null;
    render();
  }, next.state === 'success' ? 1_250 : 3_000);
}

function focusProjectSearch(cursor: number): void {
  window.requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('.project-search-input');
    if (!input) return;
    input.focus();
    const bounded = Math.max(0, Math.min(cursor, input.value.length));
    input.setSelectionRange(bounded, bounded);
  });
}
