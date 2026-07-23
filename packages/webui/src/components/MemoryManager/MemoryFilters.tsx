import { BrainCircuit, FilterX, Search, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SageStats, SageStatus } from '@/types';
import { KIND_LABELS, MEMORY_KINDS, MEMORY_STATUSES } from './shared';

export interface MemoryFiltersProps {
  searchQuery: string;
  statusFilter: 'all' | SageStatus;
  kindFilter: string;
  audienceOnly: boolean;
  tagFilter: string | null;
  hasFilters: boolean;
  allTags: Array<[string, number]>;
  stats: SageStats | null;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: 'all' | SageStatus) => void;
  onKindFilterChange: (value: string) => void;
  onToggleAudienceOnly: () => void;
  onTagFilterChange: (value: string | null) => void;
  onClearFilters: () => void;
}

export function MemoryFilters({
  searchQuery,
  statusFilter,
  kindFilter,
  audienceOnly,
  tagFilter,
  hasFilters,
  allTags,
  stats,
  onSearchChange,
  onStatusFilterChange,
  onKindFilterChange,
  onToggleAudienceOnly,
  onTagFilterChange,
  onClearFilters,
}: MemoryFiltersProps) {
  return (
    <div className="shrink-0 space-y-2 overflow-hidden border-b border-border/70 bg-card/45 p-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search memories"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search content, IDs, tags, anchors…"
            className="h-10 min-w-0 bg-background pl-9 pr-8 text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button
          variant={audienceOnly ? 'default' : 'ghost'}
          size="icon"
          onClick={onToggleAudienceOnly}
          aria-label="Filter audience-scoped only"
          title="Show only audience-scoped memories"
          className="shrink-0"
        >
          <BrainCircuit className="size-4" />
        </Button>
        {hasFilters && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClearFilters}
            aria-label="Clear all filters"
            title="Clear all filters"
          >
            <FilterX className="size-4" />
          </Button>
        )}
      </div>
      <div className="grid gap-2">
        <label className="sr-only" htmlFor="memory-status-filter">
          Filter by status
        </label>
        <select
          id="memory-status-filter"
          value={statusFilter}
          onChange={(event) =>
            onStatusFilterChange(event.target.value as 'all' | SageStatus)
          }
          className="h-9 min-w-0 border border-input bg-background px-2 text-xs"
        >
          <option value="all">All statuses</option>
          {MEMORY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status} · {stats?.byStatus[status] ?? 0}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="memory-kind-filter">
          Filter by kind
        </label>
        <select
          id="memory-kind-filter"
          value={kindFilter}
          onChange={(event) => onKindFilterChange(event.target.value)}
          className="h-9 min-w-0 border border-input bg-background px-2 text-xs"
        >
          <option value="all">All kinds</option>
          {MEMORY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]} · {stats?.byKind[kind] ?? 0}
            </option>
          ))}
        </select>
      </div>
      {allTags.length > 0 && (
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="sr-only">Popular tags</legend>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
            {allTags.slice(0, 18).map(([tagName, count]) => (
              <button
                key={tagName}
                type="button"
                aria-pressed={tagFilter === tagName}
                onClick={() => onTagFilterChange(tagFilter === tagName ? null : tagName)}
                className={cn(
                  'flex shrink-0 items-center gap-1 border px-2 py-1 text-[10px] transition-colors',
                  tagFilter === tagName
                    ? 'border-info/55 bg-info/10 text-info'
                    : 'border-border/70 bg-background/45 text-muted-foreground hover:border-info/35 hover:text-foreground',
                )}
              >
                <Tag className="size-2.5" /> {tagName}
                <span className="font-mono opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
