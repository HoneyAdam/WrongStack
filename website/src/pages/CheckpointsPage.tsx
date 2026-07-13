import { Camera, RotateCcw, Shield } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function CheckpointsPage() {
  return (
    <>
      <PageHero index="28" eyebrow="Checkpoints" title={<>Rewind file state{" "}<span className="text-brand">safely.</span></>} description="Checkpoints capture file state snapshots before risky edits. If something goes wrong, roll back to the last checkpoint — no git reset, no lost work." aside={<ExternalDoc path="docs/checkpoints.md">Open Checkpoints docs</ExternalDoc>} />
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="How they work" title="Snapshot, edit, verify, rollback." />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {[
            { icon: Camera, title: 'Snapshot', body: 'Before the agent makes a multi-file edit, it captures the current state of affected files. Snapshots are lightweight — only changed files are stored.' },
            { icon: Shield, title: 'Edit safely', body: 'The agent proceeds with its edits. The checkpoint stays on disk as a safety net. Multiple checkpoints can coexist for multi-step operations.' },
            { icon: RotateCcw, title: 'Rollback', body: 'If the result is wrong, restore from the checkpoint. Files return to their pre-edit state. The agent can then try a different approach.' },
          ].map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-2xl border border-line bg-card p-7">
              <Icon className="size-5 text-brand" /><h2 className="mt-8 text-xl font-black text-fg">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="02" eyebrow="How they work" title="Checkpoints integrate with the session writer and AutoPhase." description="The agent creates checkpoints automatically before risky multi-file edits. You can also trigger them manually." />
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-card p-7">
              <h2 className="text-xl font-black text-fg">Automatic checkpoints</h2>
              <p className="mt-3 text-sm leading-7 text-muted">Before the agent runs SDD phases, AutoPhase worktree operations, or batch refactors, it snapshots affected files. If the operation fails, files revert to the checkpoint state — no git reset needed.</p>
            </div>
            <div className="rounded-2xl border border-line bg-card p-7">
              <h2 className="text-xl font-black text-fg">Session integration</h2>
              <p className="mt-3 text-sm leading-7 text-muted">Checkpoints are linked to session events. The session writer records checkpoint creation and restoration. The session log becomes auditable — you can see exactly when and why a rollback occurred.</p>
            </div>
          </div>
        </div>
      </section>
      <PageNext label="Commit workflow" title="Generated conventional commits" body="Stage changes and create well-formed commit messages automatically." href="/commit-workflow" />
    </>
  );
}
