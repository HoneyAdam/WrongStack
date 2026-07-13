export interface WorktreeEventMap {
  /**
   * Git-worktree lifecycle, emitted by WorktreeManager. AutoPhase allocates one
   * worktree per phase so parallelizable phases run isolated, then merges them
   * back sequentially. The WebUI/TUI subscribe to render live swim-lanes/DAG.
   */
  'worktree.allocated': {
    sessionId?: string | undefined;
    handleId: string;
    ownerId: string;
    ownerLabel: string;
    slug: string;
    dir: string;
    branch: string;
    baseBranch: string;
  };
  'worktree.committed': {
    sessionId?: string | undefined;
    handleId: string;
    ownerId: string;
    branch: string;
    committed: boolean;
    insertions: number;
    deletions: number;
    files: number;
    sha?: string | undefined;
  };
  'worktree.merged': {
    sessionId?: string | undefined;
    handleId: string;
    ownerId: string;
    branch: string;
    baseBranch: string;
    squash: boolean;
  };
  'worktree.conflict': {
    sessionId?: string | undefined;
    handleId: string;
    ownerId: string;
    branch: string;
    conflictFiles: string[];
  };
  'worktree.released': {
    sessionId?: string | undefined;
    handleId: string;
    ownerId: string;
    branch: string;
    kept: boolean;
  };
  'worktree.failed': {
    sessionId?: string | undefined;
    handleId: string;
    ownerId: string;
    branch?: string | undefined;
    error: string;
  };
}
