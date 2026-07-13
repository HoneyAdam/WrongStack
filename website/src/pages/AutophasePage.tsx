import { GitBranch, Play, RotateCcw, Target } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function AutophasePage() {
  return (
    <>
      <PageHero index="22" eyebrow="AutoPhase" title={<>Full autonomy{" "}<span className="text-brand">across worktrees.</span></>} description="AutoPhase runs autonomous phased workflows. Unlike SDD, it never pauses for review. Each phase runs in an isolated git worktree with checkpoint-based rollback." aside={<ExternalDoc path="docs/autophase.md">Open AutoPhase docs</ExternalDoc>} />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="Architecture" title="Worktree isolation and checkpoint recovery." description="Every phase runs in its own git worktree. If something goes wrong, checkpoint snapshots let you roll back to the last known-good state." />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {[
            { icon: GitBranch, title: 'Worktree per phase', body: 'Plan, implement, test, and review each run in isolated worktrees. No branch switching, no merge conflicts mid-phase. The working tree stays clean.' },
            { icon: RotateCcw, title: 'Checkpoint rollback', body: 'After each phase completes, a checkpoint snapshot is saved. If a later phase fails, roll back to the last checkpoint and adjust the plan.' },
            { icon: Play, title: 'Autonomous execution', body: 'Set a goal, define phases, and let AutoPhase run. It plans, implements, tests, reviews, and reports — all without interactive steering.' },
            { icon: Target, title: 'Goal tracking', body: 'Goals persist across phases and sessions via the Coordinator. Resume an interrupted AutoPhase run days later.' },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-line bg-card p-6">
              <Icon className="size-5 text-brand" /><h2 className="mt-4 text-lg font-black text-fg">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="02" eyebrow="Phase lifecycle" title="From goal to verified delivery — no human in the loop." description="Each AutoPhase run progresses through four standard phases. Between phases, checkpoints are written so a failed phase can roll back without losing prior work." />
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
            {[
              ['01', 'Plan', 'The agent reads the goal and produces a structured task breakdown with file targets, dependency order, and estimated risk per step.'],
              ['02', 'Implement', 'Each planned step executes in its own worktree. Code is written, files are created, refactors run — fully autonomous with tool access.'],
              ['03', 'Test', 'After implementation, the agent runs the project test suite, typecheck, and linters against the worktree. Failures trigger automatic retry or rollback.'],
              ['04', 'Review', 'A final review pass checks the diff for anti-patterns, security issues, and style violations. Results are written to the phase journal.'],
            ].map(([step, title, body]) => (
              <article key={step} className="bg-card p-7">
                <span className="font-mono text-xs font-black text-brand-2">{step}</span>
                <h2 className="mt-8 text-xl font-black text-fg">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="03" eyebrow="Usage" title="Commands and configuration." description="AutoPhase integrates with /goal for persistent missions and /coordinator for cross-session tracking." />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-card p-7">
            <h2 className="text-xl font-black text-fg">Starting a run</h2>
            <div className="mt-5 space-y-3">
              {[
                { cmd: '/goal set "refactor the auth module"', desc: 'Create a persistent goal. AutoPhase reads this as its mission statement.' },
                { cmd: '/autophase start', desc: 'Begin autonomous execution. Phases run sequentially without pausing for review.' },
                { cmd: '/autophase status', desc: 'Check current phase, progress, and any errors encountered so far.' },
                { cmd: '/autophase pause', desc: 'Suspend execution at the next phase boundary. Resume later with /autophase resume.' },
              ].map(({ cmd, desc }) => (
                <div key={cmd} className="rounded-lg border border-line bg-bg p-4">
                  <code className="font-mono text-sm font-black text-brand">{cmd}</code>
                  <p className="mt-1.5 text-xs leading-5 text-muted">{desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-card p-7">
            <h2 className="text-xl font-black text-fg">Recovery and rollback</h2>
            <div className="mt-5 space-y-3">
              {[
                { label: 'Per-phase checkpoints', body: 'After each phase, a checkpoint captures the worktree state. If the next phase fails, the agent rolls back to the last checkpoint instead of starting over.' },
                { label: 'Automatic retry', body: 'Test failures trigger up to 3 retries with adjusted approaches before the phase is marked failed.' },
                { label: 'Manual intervention', body: 'Pause AutoPhase at any time, inspect the worktree, make manual fixes, then resume.' },
                { label: 'Phase journal', body: 'Every phase writes structured results to the journal. Review with /autophase status for a full run history.' },
              ].map(({ label, body }) => (
                <div key={label} className="rounded-lg border border-line bg-bg p-4">
                  <h3 className="font-black text-sm text-fg">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <PageNext label="Ensemble" title="Parallel multi-agent reviews" body="Fan one task to multiple ACP agents for independent perspectives." href="/ensemble" />
    </>
  );
}
