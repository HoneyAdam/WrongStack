import { Bookmark, FileText, Layers3, Library, Search, Wand2 } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function PromptsPage() {
  return (
    <>
      <PageHero index="17" eyebrow="Prompts library" title={<>Reusable steering{" "}<span className="text-brand">at your fingertips.</span></>} description="The prompts library stores reusable prompt templates across three layers. Search, favorite, and insert them into the agent context — with variable rendering and AI-assisted authoring." aside={<ExternalDoc path="docs/prompts/README.md">Open Prompts docs</ExternalDoc>} />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="Three layers" title="Bundled, user, or project — the right scope for every prompt." description="Prompts merge by slug across three layers. Project overrides user; user overrides bundled. The shipped dataset stays immutable." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-3">
          {[
            { icon: Library, title: 'Bundled', body: '50+ prompts ship with WrongStack. Code review templates, refactoring checklists, architecture decision records, debugging workflows. Always available.' },
            { icon: Layers3, title: 'User', body: 'Store personal prompts in ~/.wrongstack/prompts. They follow you across every project. Perfect for your coding style and workflow preferences.' },
            { icon: FileText, title: 'Project', body: 'Project prompts live in .wrongstack/prompts. Share team conventions, onboarding guides, and repo-specific workflows via version control.' },
          ].map(({ icon: Icon, title, body }) => (
            <article key={title} className="bg-card p-7">
              <Icon className="size-5 text-brand" />
              <h2 className="mt-8 text-xl font-black text-fg">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="02" eyebrow="Commands" title="Three commands for the full workflow." />
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {[
              { icon: Search, cmd: '/prompts', desc: 'List all prompts across layers. Filter by source, search by title or tag. Favorite the ones you use most.' },
              { icon: Bookmark, cmd: '/prompt', desc: 'Search and insert a prompt by slug. Variables render at insertion time. Favorited prompts appear first in search results.' },
              { icon: Wand2, cmd: '/prompt-gen', desc: 'Author a new prompt with model assistance. Describe what you want, and the model drafts the structure, variables, and metadata.' },
            ].map(({ icon: Icon, cmd, desc }) => (
              <article key={cmd} className="rounded-2xl border border-line bg-card p-7">
                <Icon className="size-5 text-brand" />
                <code className="mt-5 block font-mono text-sm font-black text-brand">{cmd}</code>
                <p className="mt-3 text-sm leading-7 text-muted">{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="03" eyebrow="Prompts in practice" title="From template to agent steering in one command." description="A prompt is more than static text. Variables let you customize each insertion. Favorites keep your most-used templates one keystroke away." />
        <div className="mt-12 overflow-hidden rounded-2xl border border-line bg-ink">
          <div className="border-b border-white/10 px-6 py-4">
            <span className="font-mono text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Example: security review prompt</span>
          </div>
          <div className="p-6 font-mono text-sm leading-7 text-zinc-300">
            <span className="text-zinc-600">---</span><br />
            <span className="text-zinc-500">slug</span><span className="text-zinc-600">: </span><span className="text-amber-300">security-review</span><br />
            <span className="text-zinc-500">title</span><span className="text-zinc-600">: </span><span className="text-amber-300">Security code review</span><br />
            <span className="text-zinc-500">variables</span><span className="text-zinc-600">: </span><span className="text-zinc-300">[module, severity]</span><br />
            <span className="text-zinc-600">---</span><br /><br />
            <span className="text-zinc-400">Review the </span><span className="text-brand">{'{{module}}'}</span><span className="text-zinc-400"> module for OWASP Top 10 vulnerabilities. Focus on injection, broken auth, and sensitive data exposure. Report findings at </span><span className="text-brand">{'{{severity}}'}</span><span className="text-zinc-400"> severity or higher.</span>
          </div>
        </div>
      </section>

      <PageNext label="SDD workflow" title="Spec-driven development from idea to verified code" body="Define a spec, let the agent plan, implement, and verify in structured phases." href="/sdd" />
    </>
  );
}
