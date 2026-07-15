import {
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  PanelRight,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ToolCallInfo } from './types.js';

interface ToolSidebarProps {
  agentId: string;
  agentName: string;
  calls: ToolCallInfo[];
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolSidebar({ agentId, agentName, calls }: ToolSidebarProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const runningCount = calls.filter((call) => call.status === 'running').length;

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`tool-sidebar-trigger${open ? ' active' : ''}`}
        aria-expanded={open}
        aria-controls="tool-sidebar"
        onClick={() => setOpen((current) => !current)}
      >
        <PanelRight size={14} aria-hidden="true" />
        <span>TOOLS</span>
        <b>{calls.length}</b>
        {runningCount > 0 && <i role="status" aria-label={`${runningCount} running tool calls`} />}
      </button>

      {open && (
        <aside
          id="tool-sidebar"
          className="tool-sidebar"
          aria-label={`${agentName} tool calls`}
          data-agent-id={agentId}
        >
          <header className="tool-sidebar-header">
            <div>
              <Wrench size={14} aria-hidden="true" />
              <span>TOOL CALLS</span>
              <b>{agentName}</b>
            </div>
            <button type="button" aria-label="Close tool calls" onClick={() => setOpen(false)}>
              <X size={15} aria-hidden="true" />
            </button>
          </header>
          <div className="tool-sidebar-list">
            {calls.length === 0 ? (
              <div className="tool-sidebar-empty">No tool calls for this agent yet.</div>
            ) : (
              calls.map((call) => {
                const isExpanded = expanded.includes(call.id);
                return (
                  <article className={`tool-sidebar-call ${call.status}`} key={call.id}>
                    <button
                      type="button"
                      className="tool-sidebar-call-trigger"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpanded((current) =>
                          current.includes(call.id)
                            ? current.filter((id) => id !== call.id)
                            : [...current, call.id],
                        )
                      }
                    >
                      {isExpanded ? (
                        <ChevronDown size={12} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={12} aria-hidden="true" />
                      )}
                      <code>{call.name}</code>
                      {call.status === 'running' ? (
                        <LoaderCircle size={12} className="spin" aria-label="Running" />
                      ) : call.status === 'done' ? (
                        <Check size={12} className="tool-sidebar-ok" aria-label="Done" />
                      ) : (
                        <X size={12} className="tool-sidebar-error" aria-label="Error" />
                      )}
                      <span>
                        {call.status === 'running'
                          ? 'Running'
                          : call.status === 'done'
                            ? `Done${call.durationMs != null ? ` · ${call.durationMs}ms` : ''}`
                            : 'Error'}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="tool-sidebar-call-detail">
                        {call.input !== undefined && (
                          <section>
                            <span>INPUT</span>
                            <pre>{displayValue(call.input)}</pre>
                          </section>
                        )}
                        {call.output !== undefined && (
                          <section>
                            <span>OUTPUT</span>
                            <pre>{call.output}</pre>
                          </section>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </aside>
      )}
    </>
  );
}
