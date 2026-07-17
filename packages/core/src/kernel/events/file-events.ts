/** Filesystem activity emitted by project watchers and deterministic workers. */
export interface FileEventMap {
  'file.activity': {
    filePath: string;
    operation: 'read' | 'write' | 'edit' | 'delete' | 'rename';
    phase: 'started' | 'completed' | 'changed';
    source: 'tool' | 'editor' | 'deterministic' | 'watcher' | 'external';
    at: number;
    sessionId?: string | undefined;
    traceId?: string | undefined;
    agentId?: string | undefined;
    agentName?: string | undefined;
    toolUseId?: string | undefined;
    toolName?: string | undefined;
    line?: number | undefined;
    endLine?: number | undefined;
  };
}
