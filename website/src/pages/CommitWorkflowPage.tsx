// No lucide imports needed — icons referenced via content.ts
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function CommitWorkflowPage() {
  return (
    <>
      <PageHero index="29" eyebrow="Commit workflow" title={<>Conventional commits{" "}<span className="text-brand">without the typing.</span></>} description="The agent reads your diff and generates a well-formed conventional commit message — type, scope, summary, and body. You review before it commits." aside={<ExternalDoc path="docs/slash/commit.md">Open Commit docs</ExternalDoc>} />
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="The git command family" title="From working tree to remote push." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { cmd: '/commit', desc: 'Stage files, generate a conventional commit message from the diff, and commit. Review before confirming.' },
            { cmd: '/git status', desc: 'Check working tree state — modified, staged, untracked files.' },
            { cmd: '/git diff', desc: 'Review changes before committing. Supports file globs.' },
            { cmd: '/gitcheck', desc: 'Silent check for uncommitted changes. Ideal for pre-flight automation.' },
            { cmd: '/push', desc: 'Push the current branch to its configured remote.' },
            { cmd: '/gitid', desc: 'Inspect or set git user.name and user.email for commit attribution.' },
          ].map(({ cmd, desc }) => (
            <div key={cmd} className="rounded-xl border border-line bg-card p-5">
              <code className="font-mono text-sm font-black text-brand">{cmd}</code>
              <p className="mt-2 text-xs leading-5 text-muted">{desc}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="02" eyebrow="Conventional commits" title="Generated messages follow the spec." description="The agent reads your diff and produces a conventional commit: type, optional scope, summary, and body. You review before it commits." />
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-card p-7">
              <h2 className="text-xl font-black text-fg">Commit types</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                {['feat','fix','docs','refactor','test','chore','perf','ci','build','style','revert'].map((t) => (<span key={t} className="rounded-full border border-line bg-bg px-3 py-1 font-mono text-xs text-brand">{t}</span>))}
              </div>
              <p className="mt-4 text-sm leading-7 text-muted">Each type maps to a semantic version bump. feat → minor, fix → patch, BREAKING CHANGE in body → major.</p>
            </div>
            <div className="rounded-2xl border border-line bg-card p-7">
              <h2 className="text-xl font-black text-fg">Dry-run and review</h2>
              <p className="mt-3 text-sm leading-7 text-muted">Run /commit --dry-run to see the generated message without committing. The agent never commits without your review. You can edit the message inline before confirming.</p>
            </div>
          </div>
        </div>
      </section>
      <PageNext label="Command atlas" title="Browse all 92 operator commands" body="Search by intent, filter by category and open dedicated reference pages." href="/commands" />
    </>
  );
}
