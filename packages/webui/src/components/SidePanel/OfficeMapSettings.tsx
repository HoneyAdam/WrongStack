/**
 * OfficeMapSettings — Settings and controls panel for the Office Map.
 *
 * Rendered in the SidePanel when the Office Map is active, replacing
 * the map itself which now lives in the full-width main area.
 */

import { cn } from '@/lib/utils';
import { useAppTranslation } from '@/i18n';
import {
  useFleetStore,
  useMailboxStore,
  useVizStore,
  useOfficeMapStore,
} from '@/stores';

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {description && (
          <div className="text-[10px] text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-1',
        )}
      />
    </button>
  );
}

export function OfficeMapSettings() {
  const { t } = useAppTranslation();
  const fleetAgents = useFleetStore((s) => s.agents);
  const vizEvents = useVizStore((s) => s.events);
  const mailboxMessages = useMailboxStore((s) => s.messages);

  // Settings from the store — these control the canvas in real-time
  const showMinimap = useOfficeMapStore((s) => s.showMinimap);
  const showControls = useOfficeMapStore((s) => s.showControls);
  const animateEdges = useOfficeMapStore((s) => s.animateEdges);
  const showLegend = useOfficeMapStore((s) => s.showLegend);
  const showHud = useOfficeMapStore((s) => s.showHud);
  const showFeed = useOfficeMapStore((s) => s.showFeed);
  const background = useOfficeMapStore((s) => s.background);

  const setShowMinimap = useOfficeMapStore((s) => s.setShowMinimap);
  const setShowControls = useOfficeMapStore((s) => s.setShowControls);
  const setAnimateEdges = useOfficeMapStore((s) => s.setAnimateEdges);
  const setShowLegend = useOfficeMapStore((s) => s.setShowLegend);
  const setShowHud = useOfficeMapStore((s) => s.setShowHud);
  const setShowFeed = useOfficeMapStore((s) => s.setShowFeed);
  const setBackground = useOfficeMapStore((s) => s.setBackground);

  const runningAgents = Array.from(fleetAgents.values()).filter((a) => a.status === 'running').length;
  const totalAgents = fleetAgents.size;
  const unreadMessages = mailboxMessages.filter((m) => !m.completed && (m.readByCount ?? 0) === 0).length;
  const recentEvents = vizEvents.slice(0, 10).length;

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t('activity:officeSettings.heading')}</h3>
        <p className="text-[10px] text-muted-foreground">
          {t('activity:officeSettings.headingHint')}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border bg-card p-2.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('activity:officeSettings.statAgents')}</div>
          <div className="text-lg font-mono font-bold text-primary mt-0.5">
            {runningAgents}
            <span className="text-muted-foreground text-sm font-normal">/{totalAgents}</span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-2.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('activity:officeSettings.statMail')}</div>
          <div className="text-lg font-mono font-bold text-yellow-500 mt-0.5">
            {unreadMessages}
            <span className="text-muted-foreground text-sm font-normal">{t('activity:officeSettings.unreadSuffix')}</span>
          </div>
        </div>
      </div>

      {/* View Settings */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('activity:officeSettings.sectionView')}
        </div>
        <div className="rounded-lg border bg-card divide-y">
          <SettingRow label={t('activity:officeSettings.hudLabel')} description={t('activity:officeSettings.hudDesc')}>
            <Toggle
              checked={showHud}
              onChange={setShowHud}
              label={t('activity:officeSettings.hudToggle')}
            />
          </SettingRow>
          <SettingRow label={t('activity:officeSettings.minimapLabel')} description={t('activity:officeSettings.minimapDesc')}>
            <Toggle
              checked={showMinimap}
              onChange={setShowMinimap}
              label={t('activity:officeSettings.minimapToggle')}
            />
          </SettingRow>
          <SettingRow label={t('activity:officeSettings.controlsLabel')} description={t('activity:officeSettings.controlsDesc')}>
            <Toggle
              checked={showControls}
              onChange={setShowControls}
              label={t('activity:officeSettings.controlsToggle')}
            />
          </SettingRow>
        </div>
      </div>

      {/* Display Settings */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('activity:officeSettings.sectionDisplay')}
        </div>
        <div className="rounded-lg border bg-card divide-y">
          <SettingRow label={t('activity:officeSettings.animateLabel')} description={t('activity:officeSettings.animateDesc')}>
            <Toggle
              checked={animateEdges}
              onChange={setAnimateEdges}
              label={t('activity:officeSettings.animateToggle')}
            />
          </SettingRow>
          <SettingRow label={t('activity:officeSettings.legendLabel')} description={t('activity:officeSettings.legendDesc')}>
            <Toggle
              checked={showLegend}
              onChange={setShowLegend}
              label={t('activity:officeSettings.legendToggle')}
            />
          </SettingRow>
          <SettingRow label={t('activity:officeSettings.feedLabel')} description={t('activity:officeSettings.feedDesc')}>
            <Toggle
              checked={showFeed}
              onChange={setShowFeed}
              label={t('activity:officeSettings.feedToggle')}
            />
          </SettingRow>
        </div>
      </div>

      {/* Background Style */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('activity:officeSettings.sectionBackground')}
        </div>
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex gap-2">
            {(['dots', 'lines', 'cross', 'none'] as const).map((bg) => (
              <button
                key={bg}
                onClick={() => setBackground(bg)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md border transition-colors',
                  background === bg
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                )}
              >
                {t(`activity:officeSettings.bg.${bg}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('activity:officeSettings.sectionRecent')}
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs font-mono">
            <span className="text-primary">{recentEvents}</span>
            <span className="text-muted-foreground">{t('activity:officeSettings.eventsTrackedSuffix')}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {t('activity:officeSettings.recentHint')}
          </p>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('activity:officeSettings.sectionShortcuts')}
        </div>
        <div className="rounded-lg border bg-card p-3 space-y-2 text-[10px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('activity:officeSettings.fitView')}</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">F</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('activity:officeSettings.zoomIn')}</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">+</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('activity:officeSettings.zoomOut')}</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">-</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('activity:officeSettings.resetZoom')}</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">0</kbd>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('activity:officeSettings.sectionLegend')}
        </div>
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs">{t('activity:officeSettings.legendActive')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-500" />
            <span className="text-xs">{t('activity:officeSettings.legendIdle')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs">{t('activity:officeSettings.legendError')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-600" />
            <span className="text-xs">{t('activity:officeSettings.legendOffline')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
