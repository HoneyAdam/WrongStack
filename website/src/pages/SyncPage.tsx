import { ArrowUpDown, HardDrive } from 'lucide-react';
import { GitHubIcon } from '@/components/ui/github-icon';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function SyncPage() {
  return (
    <>
      <PageHero index="27" eyebrow="GitHub Sync" title={<>Same setup{" "}<span className="text-brand">on every machine.</span></>} description="Sync your WrongStack configuration — settings, skills, prompts, memory, and session history — through a GitHub repository." aside={<ExternalDoc path="docs/sync.md">Open Sync docs</ExternalDoc>} />
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="How it works" title="Push, pull, and never configure twice." />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {[
            { icon: GitHubIcon, title: 'Configure', body: 'Link a GitHub repository with /sync configure <repo-url>. WrongStack uses it as the sync target for all artifacts.' },
            { icon: ArrowUpDown, title: 'Push and pull', body: '/sync push uploads local changes. /sync pull downloads remote changes. Conflicts are detected and reported before overwriting.' },
            { icon: HardDrive, title: 'What syncs', body: 'Settings, installed skills, prompt libraries, Super Memory entries, and session history. Each artifact type can be selectively synced.' },
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
          <SectionIntro index="02" eyebrow="Commands" title="Push, pull, configure." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { cmd: '/sync configure <repo>', desc: 'Set the GitHub repository used for sync.' },
              { cmd: '/sync push', desc: 'Upload local changes. Shows a file-level diff of what will be synced.' },
              { cmd: '/sync pull', desc: 'Download remote changes. Conflicts are flagged before overwriting.' },
              { cmd: '/sync status', desc: 'Show last sync timestamps and pending changes per artifact type.' },
            ].map(({ cmd, desc }) => (<div key={cmd} className="rounded-xl border border-line bg-card p-5"><code className="font-mono text-sm font-black text-brand">{cmd}</code><p className="mt-2 text-xs leading-5 text-muted">{desc}</p></div>))}
          </div>
        </div>
      </section>
      <PageNext label="Checkpoints" title="Reversible file state" body="Snapshots that let you roll back file changes around risky edits." href="/checkpoints" />
    </>
  );
}
