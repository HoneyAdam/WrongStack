import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores';
import { TodosPanel } from './TodosPanel';
import { TasksPanel } from './TasksPanel';
import { PlanPanel } from './PlanPanel';

type TabId = 'todos' | 'tasks' | 'plan';

interface TabInfo {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabInfo[] = [
  { id: 'todos', label: 'Todos', icon: '✅' },
  { id: 'tasks', label: 'Tasks', icon: '📋' },
  { id: 'plan', label: 'Plan', icon: '🗺️' },
];

/**
 * WorkDashboard — tabbed container for Todos, Tasks, and Plan panels.
 *
 * All three panels are always mounted (hidden with display:none when
 * inactive) so their WebSocket subscriptions stay alive. Switching tabs
 * is instant and all data is fresh.
 *
 * Auto-hides when all three panels are empty.
 */
export function WorkDashboard(): React.ReactElement | null {
  const activeTab = useUIStore((s) => s.workDashboardTab);
  const setActiveTab = useUIStore((s) => s.setWorkDashboardTab);

  return (
    <div className="rounded-lg border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border/50 bg-muted/30">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium transition-colors',
              'border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-primary text-foreground bg-background'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30',
            )}
          >
            <span className="text-xs">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel slots — always mounted, only active one visible */}
      <div className={cn(activeTab === 'todos' ? 'block' : 'hidden')}>
        <TodosPanel />
      </div>
      <div className={cn(activeTab === 'tasks' ? 'block' : 'hidden')}>
        <TasksPanel />
      </div>
      <div className={cn(activeTab === 'plan' ? 'block' : 'hidden')}>
        <PlanPanel />
      </div>
    </div>
  );
}
