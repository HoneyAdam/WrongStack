import { useCallback, useEffect, useState } from 'react';
import { useAppTranslation, i18n } from '@/i18n';
import { Activity, AlertCircle, BarChart3, Clock, Eye, FileWarning, Gauge, RefreshCw, Server, TrendingUp } from 'lucide-react';

interface FileWatcherMetrics {
  fileChangesDetected: number;
  filesProcessed: number;
  broadcastsSent: number;
  debounceResets: number;
  totalDebounceDelayMs: number;
  activeProjects: number;
  averageDebounceDelayMs: number;
  watcherActive: boolean;
  timestamp: number;
}

interface SystemMetrics {
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
  cpuUsage: NodeJS.CpuUsage;
}

interface DebugData {
  fileWatcher: FileWatcherMetrics | null;
  system: SystemMetrics | null;
  lastUpdated: Date | null;
  error: string | null;
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'text-blue-500',
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  const { t } = useAppTranslation();
  return (
    <div className="bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className={`p-2 rounded-lg bg-muted ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {trend && (
        <div className="mt-2 flex items-center gap-1">
          {trend === 'up' && <TrendingUp className="w-3 h-3 text-green-500" />}
          {trend === 'down' && <TrendingUp className="w-3 h-3 text-red-500 rotate-180" />}
          <span className="text-xs text-muted-foreground">
            {trend === 'up' ? t('activity:debug.trendUp') : trend === 'down' ? t('activity:debug.trendDown') : t('activity:debug.trendStable')}
          </span>
        </div>
      )}
    </div>
  );
}

function _StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
        active ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-green-500' : 'bg-red-500'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export function DebugDashboard() {
  const { t } = useAppTranslation();
  const [data, setData] = useState<DebugData>({
    fileWatcher: null,
    system: null,
    lastUpdated: null,
    error: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState<number>(2000);

  const fetchMetrics = useCallback(async () => {
    try {
      // Fetch file watcher metrics
      const watcherRes = await fetch('/debug/watcher-metrics');
      let watcherData: FileWatcherMetrics | null = null;
      if (watcherRes.ok) {
        watcherData = await watcherRes.json();
      }

      // Fetch system metrics from a different endpoint or calculate from browser
      // Since we don't have a /debug/system endpoint, we'll use browser APIs
      const systemData: SystemMetrics = {
        memoryUsage: {
          heapUsed: performance.memory?.usedJSHeapSize ?? 0,
          heapTotal: performance.memory?.totalJSHeapSize ?? 0,
          external: 0,
          rss: 0,
          arrayBuffers: 0,
        },
        uptime: performance.timeOrigin ? (performance.now() / 1000) : 0,
        cpuUsage: { user: 0, system: 0 },
      };

      setData({
        fileWatcher: watcherData,
        system: systemData,
        lastUpdated: new Date(),
        error: null,
      });
    } catch (err) {
      setData((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : i18n.t('activity:debug.fetchFailed'),
      }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMetrics, refreshInterval]);

  const handleRefresh = () => {
    setIsLoading(true);
    void fetchMetrics();
  };

  return (
    <div className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-7 h-7" />
              {t('activity:debug.heading')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('activity:debug.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('activity:debug.refreshLabel')}</span>
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="bg-background border rounded px-2 py-1 text-sm"
              >
                <option value={1000}>1s</option>
                <option value={2000}>2s</option>
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
              </select>
            </label>
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              {t('common:action.refresh')}
            </button>
          </div>
        </div>

        {/* Last Updated */}
        {data.lastUpdated && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            {t('activity:debug.lastUpdated', { time: data.lastUpdated.toLocaleTimeString() })}
          </div>
        )}

        {/* Error Display */}
        {data.error && (
          <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-medium">{t('activity:debug.fetchFailed')}</p>
              <p className="text-sm opacity-80">{data.error}</p>
            </div>
          </div>
        )}

        {/* File Watcher Section */}
        <section>
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Eye className="w-5 h-5" />
            {t('activity:debug.fileWatcher')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title={t('activity:debug.watcherStatus')}
              value={data.fileWatcher?.watcherActive ? t('activity:debug.running') : t('activity:debug.stopped')}
              icon={Server}
              color={data.fileWatcher?.watcherActive ? 'text-green-500' : 'text-red-500'}
            />
            <MetricCard
              title={t('activity:debug.activeProjects')}
              value={data.fileWatcher?.activeProjects ?? 0}
              subtitle={t('activity:debug.projectsWatched')}
              icon={FileWarning}
              color="text-purple-500"
            />
            <MetricCard
              title={t('activity:debug.fileChanges')}
              value={data.fileWatcher?.fileChangesDetected ?? 0}
              subtitle={t('activity:debug.totalDetected')}
              icon={Activity}
              color="text-blue-500"
              trend="neutral"
            />
            <MetricCard
              title={t('activity:debug.filesProcessed')}
              value={data.fileWatcher?.filesProcessed ?? 0}
              subtitle={t('activity:debug.afterHash')}
              icon={Gauge}
              color="text-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <MetricCard
              title={t('activity:debug.broadcastsSent')}
              value={data.fileWatcher?.broadcastsSent ?? 0}
              subtitle={t('activity:debug.toClients')}
              icon={TrendingUp}
              color="text-green-500"
            />
            <MetricCard
              title={t('activity:debug.debounceResets')}
              value={data.fileWatcher?.debounceResets ?? 0}
              subtitle={t('activity:debug.rapidWrites')}
              icon={RefreshCw}
              color="text-orange-500"
            />
            <MetricCard
              title={t('activity:debug.avgDebounce')}
              value={`${(data.fileWatcher?.averageDebounceDelayMs ?? 0).toFixed(1)}ms`}
              subtitle={t('activity:debug.actualDelay')}
              icon={Clock}
              color="text-yellow-500"
            />
            <MetricCard
              title={t('activity:debug.totalDelay')}
              value={`${(data.fileWatcher?.totalDebounceDelayMs ?? 0).toFixed(0)}ms`}
              subtitle={t('activity:debug.sumDelays')}
              icon={BarChart3}
              color="text-indigo-500"
            />
          </div>
        </section>

        {/* Browser Performance Section */}
        <section>
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Gauge className="w-5 h-5" />
            {t('activity:debug.browserPerf')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title={t('activity:debug.heapUsed')}
              value={formatBytes(data.system?.memoryUsage?.heapUsed ?? 0)}
              subtitle={t('activity:debug.jsHeap')}
              icon={BarChart3}
              color="text-blue-500"
            />
            <MetricCard
              title={t('activity:debug.heapTotal')}
              value={formatBytes(data.system?.memoryUsage?.heapTotal ?? 0)}
              subtitle={t('activity:debug.totalHeap')}
              icon={BarChart3}
              color="text-green-500"
            />
            <MetricCard
              title={t('activity:debug.pageUptime')}
              value={formatUptime(data.system?.uptime ?? 0)}
              subtitle={t('activity:debug.sinceLoad')}
              icon={Clock}
              color="text-purple-500"
            />
          </div>
        </section>

        {/* Raw JSON Section */}
        <section>
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5" />
            {t('activity:debug.rawData')}
          </h2>
          <div className="bg-card rounded-lg border p-4 shadow-sm">
            <pre className="text-xs font-mono overflow-x-auto">
              {JSON.stringify(
                {
                  fileWatcher: data.fileWatcher,
                  browserMemory: data.system?.memoryUsage,
                  pageUptime: data.system?.uptime,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
