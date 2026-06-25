import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  type Agent,
  type AgentFactory,
  type EventBus,
  SddBoardStore,
  SddInterviewDriver,
  SddRunRegistry,
  SpecStore,
  startSddRun,
  TaskGraphStore,
  WorktreeManager,
} from '@wrongstack/core';
import type { SddWizardDeps } from './sdd-wizard-ws-handler.js';

export interface SddWizardWiringOptions {
  /** Leader agent — seeds the run's default factory + project context. */
  agent: Agent;
  /** Shared EventBus — the board projector emits sdd.board.snapshot on it. */
  events: EventBus;
  projectRoot: string;
  /** Per-task agent factory: CLI's director-backed one, or the runtime light one. */
  subagentFactory: AgentFactory;
  /** Persisted-store directories (from resolveWstackPaths). */
  paths: {
    projectSpecs: string;
    projectTaskGraphs: string;
    projectSddBoards: string;
    projectDir: string;
  };
}

/**
 * Build the {@link SddWizardDeps} shared by both webui servers from a single
 * per-task `subagentFactory`. The factory drives BOTH the interview agent (an
 * isolated turn off the main chat bus) and the real multi-agent run, so each
 * server only has to supply the right factory for its process.
 */
export function buildSddWizardDeps(opts: SddWizardWiringOptions): SddWizardDeps {
  const registry = new SddRunRegistry();
  let interviewSeq = 0;

  return {
    makeDriver: () =>
      new SddInterviewDriver({
        specStore: new SpecStore({ baseDir: opts.paths.projectSpecs }),
        graphStore: new TaskGraphStore({ baseDir: opts.paths.projectTaskGraphs }),
        sessionPath: path.join(opts.paths.projectDir, 'sdd-wizard-session.json'),
      }),

    runInterviewTurn: async (prompt: string): Promise<string> => {
      // Fresh isolated agent per turn — the AISpecBuilder prompt is
      // self-contained (it re-embeds the full Q&A), so no shared context is
      // needed and the interview never pollutes the user's main chat.
      const result = await opts.subagentFactory({
        id: `sdd-interview-${interviewSeq++}`,
        role: 'executor',
        name: 'Spec Architect',
        disabledTools: ['delegate'],
        // The interview only asks questions / drafts a spec — it must NOT edit
        // the repo. Restrict to the read-only capability floor so any write the
        // model attempts is denied (the execute phase is where writes happen).
        allowedCapabilities: ['fs.read', 'net.outbound'],
      });
      try {
        const res = await result.agent.run([{ type: 'text', text: prompt }]);
        return res.finalText ?? '';
      } finally {
        // Call the factory's cleanup (per-turn subagent session writer, etc.) —
        // here we drive the factory directly, not via makeAgentSubagentRunner,
        // so its finally-block dispose won't fire for us.
        await result.dispose?.();
      }
    },

    startRun: async (driver, { parallelSlots, defaultModel, defaultProvider, fallbackModels }) => {
      const graph = driver.getGraph();
      const tracker = driver.getTracker();
      if (!graph || !tracker) {
        throw new Error('No task graph to run — finish the interview first.');
      }

      // Per-task git-worktree isolation (gated to git repos; disable with
      // WRONGSTACK_SDD_WORKTREES=0). Mirrors the CLI /sdd execute path.
      let worktrees: WorktreeManager | undefined;
      if (process.env['WRONGSTACK_SDD_WORKTREES'] !== '0') {
        const inGit =
          spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
            cwd: opts.projectRoot,
            encoding: 'utf8',
            windowsHide: true,
          }).stdout?.trim() === 'true';
        if (inGit) worktrees = new WorktreeManager({ projectRoot: opts.projectRoot, events: opts.events });
      }

      const boardStore = new SddBoardStore({ baseDir: opts.paths.projectSddBoards });
      const handle = startSddRun({
        tracker,
        graph,
        agent: opts.agent,
        projectRoot: opts.projectRoot,
        events: opts.events,
        subagentFactory: opts.subagentFactory,
        worktrees,
        boardStore,
        registry,
        parallelSlots,
        defaultModel,
        defaultProvider,
        fallbackModels,
      });
      // The board surfaces progress (events + disk); we don't block the wizard
      // on completion. Swallow rejections so a failed run can't crash the server.
      void handle.completion.catch(() => {});
      return { runId: handle.runId };
    },
  };
}
