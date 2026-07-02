/**
 * OfficeMapSettingsPanel — secondary-panel controls for the Fleet HQ map.
 *
 * The map canvas itself renders in the wide main area; this panel owns the
 * display preferences (HUD / legend / minimap / controls / animation /
 * background) and a compact live-stats readout. Preferences live in
 * useOfficeMapStore and the canvas reacts to them.
 */

import { Activity, Bot, Cpu, Users, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppTranslation } from '@/i18n';
import { type BackgroundStyle, useMonitorStore, useOfficeMapStore } from '@/stores';

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-accent/50 transition-colors"
    >
      <span className="text-foreground">{label}</span>
      <span
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-3 w-3 transform rounded-full bg-background transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

const BACKGROUNDS: { value: BackgroundStyle; labelKey: string }[] = [
  { value: 'dots', labelKey: 'bgDots' },
  { value: 'lines', labelKey: 'bgLines' },
  { value: 'cross', labelKey: 'bgCross' },
  { value: 'none', labelKey: 'bgNone' },
];

export function OfficeMapSettingsPanel() {
  const { t } = useAppTranslation();
  const {
    showHud,
    showLegend,
    showMinimap,
    showControls,
    animateEdges,
    background,
    setShowHud,
    setShowLegend,
    setShowMinimap,
    setShowControls,
    setAnimateEdges,
    setBackground,
  } = useOfficeMapStore();

  const { clientCounts, currentSession, totalAgents, activeAgents } = useMonitorStore();
  const totalClients = clientCounts.tui + clientCounts.webui + clientCounts.repl;
  const fmtNum = (n?: number) => n?.toLocaleString() ?? '0';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-3">
      {/* Live stats summary */}
      <div>
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {t('activity:officeMap.liveHeading')}
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> {t('activity:officeMap.clients')}
            </span>
            <span className="font-mono">{totalClients}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Bot className="h-3.5 w-3.5" /> {t('activity:officeMap.agents')}
            </span>
            <span className="font-mono">
              {activeAgents}
              <span className="text-muted-foreground"> / {totalAgents}</span>
            </span>
          </div>
          {currentSession.model && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Cpu className="h-3.5 w-3.5" /> {t('activity:officeMap.model')}
              </span>
              <span className="font-mono truncate max-w-[140px]" title={currentSession.model}>
                {currentSession.model.split('/').pop()}
              </span>
            </div>
          )}
          {currentSession.mode && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Zap className="h-3.5 w-3.5" /> {t('activity:officeMap.mode')}
              </span>
              <span className="font-mono uppercase text-[10px]">{currentSession.mode}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="h-3.5 w-3.5" /> {t('activity:officeMap.toolCalls')}
            </span>
            <span className="font-mono">{fmtNum(currentSession.toolCalls)}</span>
          </div>
        </div>
      </div>

      {/* Display toggles */}
      <div>
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          {t('activity:officeMap.displayHeading')}
        </div>
        <div className="space-y-0.5">
          <Toggle label={t('activity:officeMap.statsHud')} checked={showHud} onChange={setShowHud} />
          <Toggle label={t('activity:officeMap.legends')} checked={showLegend} onChange={setShowLegend} />
          <Toggle label={t('activity:officeMap.minimap')} checked={showMinimap} onChange={setShowMinimap} />
          <Toggle label={t('activity:officeMap.zoomControls')} checked={showControls} onChange={setShowControls} />
          <Toggle label={t('activity:officeMap.animateWires')} checked={animateEdges} onChange={setAnimateEdges} />
        </div>
      </div>

      {/* Background style */}
      <div>
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 px-2">
          {t('activity:officeMap.backgroundHeading')}
        </div>
        <div className="flex flex-wrap gap-1 px-2">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => setBackground(b.value)}
              className={cn(
                'px-2 py-1 text-[10px] rounded transition-colors',
                background === b.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {t(`activity:officeMap.${b.labelKey}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
