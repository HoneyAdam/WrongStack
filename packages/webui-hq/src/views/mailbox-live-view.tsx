/** Live mailbox feed with filters, project chips, and flat timeline rendering. */
import type {
  HqEventEnvelope,
  HqMailboxMessageType,
  HqMailboxPriority,
  HqSnapshot,
} from '@wrongstack/core';
import type React from 'react';
import { useEffect, useMemo, useReducer } from 'react';
import { useHqStore } from '../store.js';
import { setHqMailboxPrefs, useHqLocalPrefs } from '../stores/hq-local-prefs.js';
import { mailboxLiveFilterReducer } from './mailbox-filters.js';
import { groupMailboxEvents } from './mailbox-grouping.js';
import { buildLiveFeedFromHq } from './mailbox-live.js';
import { MessageRow } from './mailbox-row.js';

export interface LiveMailboxViewProps {
  /** Optional injected snapshot for unit tests. */
  snapshot?: Pick<HqSnapshot, 'mailboxes'> | null | undefined;
  /** Optional injected event stream for unit tests. */
  events?: readonly HqEventEnvelope[] | undefined;
}

const MESSAGE_TYPES: readonly HqMailboxMessageType[] = [
  'ask',
  'assign',
  'steer',
  'review',
  'result',
  'status',
  'broadcast',
  'note',
  'btw',
  'control',
];
const PRIORITIES: readonly HqMailboxPriority[] = ['high', 'normal', 'low'];

export function LiveMailboxView({
  snapshot: snapshotOverride,
  events: eventsOverride,
}: LiveMailboxViewProps = {}): React.ReactElement {
  const storeSnapshot = useHqStore((s) => s.snapshot);
  const snapshot = snapshotOverride !== undefined ? snapshotOverride : storeSnapshot;
  const events = eventsOverride !== undefined ? eventsOverride : useHqStore.getState().events;

  const persisted = useHqLocalPrefs();
  const initialFilters = useMemo(() => {
    const mb = persisted.mailbox;
    return {
      types: new Set<HqMailboxMessageType>(mb.types as HqMailboxMessageType[]),
      priorities: new Set<HqMailboxPriority>(mb.priorities as HqMailboxPriority[]),
      projectIds: new Set<string>(),
      includeCompleted: mb.includeCompleted,
      query: mb.query,
    };
  }, [persisted.mailbox]);
  const [filters, dispatch] = useReducer(mailboxLiveFilterReducer, initialFilters);

  useEffect(() => {
    setHqMailboxPrefs({
      query: filters.query,
      types: Array.from(filters.types),
      priorities: Array.from(filters.priorities),
      includeCompleted: filters.includeCompleted,
    });
  }, [filters.query, filters.types, filters.priorities, filters.includeCompleted]);

  const projectOptions = useMemo(() => {
    const grouped = groupMailboxEvents(snapshot ?? null, events);
    return grouped.projects.map((p) => ({ projectId: p.projectId, count: p.messages.length }));
  }, [snapshot, events]);

  const feed = useMemo(
    () =>
      buildLiveFeedFromHq(snapshot ?? null, events, {
        types: Array.from(filters.types),
        priorities: Array.from(filters.priorities),
        projectIds: Array.from(filters.projectIds),
        includeCompleted: filters.includeCompleted,
        query: filters.query || undefined,
        limit: 500,
      }),
    [snapshot, events, filters],
  );

  const activeFilterCount =
    filters.types.size +
    filters.priorities.size +
    filters.projectIds.size +
    (filters.includeCompleted ? 0 : 1) +
    (filters.query.trim().length > 0 ? 1 : 0);

  return (
    <div>
      <div className="hq-card-title">
        Live mailbox feed · {feed.returned} of {feed.totalMatched} message
        {feed.totalMatched === 1 ? '' : 's'}
        {feed.truncated ? ' · refined to fit' : ''}
      </div>

      <div className="hq-card hq-mailbox-filterbar">
        <label className="hq-label" htmlFor="mailbox-live-query">
          Search
        </label>
        <input
          id="mailbox-live-query"
          className="hq-input"
          value={filters.query}
          onChange={(e) => dispatch({ type: 'set-query', value: e.target.value })}
          placeholder="subject / sender / recipient / body…"
        />

        <FilterSection title="Types">
          {MESSAGE_TYPES.map((type) => (
            <Chip
              key={type}
              selected={filters.types.has(type)}
              label={type}
              onClick={() => dispatch({ type: 'toggle-type', value: type })}
            />
          ))}
        </FilterSection>

        <FilterSection title="Priority">
          {PRIORITIES.map((priority) => (
            <Chip
              key={priority}
              selected={filters.priorities.has(priority)}
              label={priority}
              tone={priority === 'high' ? 'error' : priority === 'low' ? 'idle' : 'info'}
              onClick={() => dispatch({ type: 'toggle-priority', value: priority })}
            />
          ))}
        </FilterSection>

        {projectOptions.length > 0 && (
          <FilterSection title="Projects">
            {projectOptions.map((project) => (
              <Chip
                key={project.projectId}
                selected={filters.projectIds.has(project.projectId)}
                label={`${project.projectId} (${project.count})`}
                onClick={() => dispatch({ type: 'toggle-project', value: project.projectId })}
              />
            ))}
          </FilterSection>
        )}

        <div className="hq-row hq-mailbox-filter-actions">
          <label className="hq-check">
            <input
              type="checkbox"
              checked={filters.includeCompleted}
              onChange={(e) => dispatch({ type: 'set-include-completed', value: e.target.checked })}
            />
            include completed
          </label>
          <button
            type="button"
            className="hq-btn secondary"
            disabled={activeFilterCount === 0}
            onClick={() => dispatch({ type: 'clear-all' })}
          >
            Clear filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
      </div>

      {feed.entries.length === 0 ? (
        <div className="hq-empty">No mailbox activity matches the current filters.</div>
      ) : (
        <div className="hq-msg-list hq-live-feed">
          {feed.entries.map((e, index) => (
            <MessageRow
              key={e.key}
              flat={e.flat}
              defaultExpanded={index === 0 && filters.query.trim().length > 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="hq-filter-section">
      <div className="hq-msg-sublabel">{title}</div>
      <div className="hq-filter-chip-row">{children}</div>
    </div>
  );
}

function Chip({
  selected,
  label,
  onClick,
  tone = 'info',
}: {
  selected: boolean;
  label: string;
  onClick(): void;
  tone?: 'info' | 'error' | 'idle';
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`hq-filter-chip hq-pill ${tone}${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
