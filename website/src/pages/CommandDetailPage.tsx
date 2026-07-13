import { ArrowRight, Check, Command, Copy, Layers3, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';
import { commandFromSlug, commandSlug, commands } from '@/data/content';
import { commandGuidance } from '@/data/deep-dives';
import { Link, useRouter } from '@/lib/router';

const commandDeepGuides: Partial<Record<string, { href: string; label: string }>> = {
  '/mode': { href: '/modes', label: 'Compare all 19 session modes' },
  '/fleet': { href: '/agent-roster', label: 'Browse all 51 built-in roster roles' },
  '/spawn': { href: '/agent-roster', label: 'Choose a specialist role' },
  '/agents': { href: '/agent-roster', label: 'Understand the roster and lifecycle phases' },
  '/director': { href: '/agent-roster', label: 'See the Director’s complete roster' },
  '/delegate': { href: '/agent-roster', label: 'Compare explicit roles and smart dispatch' },
  '/supervisor': { href: '/agent-roster', label: 'See which workers the Supervisor watches' },
};

export function CommandDetailPage() {
  const { path } = useRouter();
  const pathParts = path.split('/').filter(Boolean);
  const slug = pathParts[pathParts.length - 1] ?? '';
  const command = commandFromSlug(slug);
  const [copied, setCopied] = useState(false);

  if (!command) return null;
  const guidance = commandGuidance[command.category];
  const position = commands.findIndex((item) => item.name === command.name) + 1;
  const related = commands
    .filter((item) => item.category === command.category && item.name !== command.name)
    .slice(0, 5);
  const examples = command.usage ?? [command.name, `/help ${command.name.slice(1)}`];
  const deepGuide = commandDeepGuides[command.name];

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <>
      <PageHero
        index={`04.${String(position).padStart(2, '0')}`}
        eyebrow={`${command.category} command`}
        title={<span className="font-mono text-brand">{command.name}</span>}
        description={command.summary}
        aside={
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[10px] font-black uppercase text-faint">
              {command.origin}
            </span>
            <span className="rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[10px] font-black uppercase text-faint">
              REPL + TUI
            </span>
          </div>
        }
      />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-32">
        <SectionIntro
          index="01"
          eyebrow="Purpose"
          title={`What ${command.name} is for`}
          description={guidance.intent}
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_.72fr]">
          <article className="rounded-2xl border border-line bg-card p-6 sm:p-8">
            <Command className="size-5 text-brand" />
            <h2 className="mt-8 text-2xl font-black tracking-[-0.04em] text-fg">Behavior</h2>
            <p className="mt-4 text-base leading-8 text-muted">{command.summary}</p>
            <p className="mt-4 text-sm leading-7 text-muted">
              The REPL parses the command name before a provider request is built. It dispatches
              through the shared slash-command registry, so the same behavior is available from the
              plain REPL and command-aware TUI surfaces.
            </p>
            {command.note && (
              <div className="mt-6 rounded-xl border border-brand/15 bg-brand/5 p-4 text-sm leading-6 text-muted">
                {command.note}
              </div>
            )}
            {deepGuide && (
              <Link
                href={deepGuide.href}
                className="group mt-6 inline-flex items-center gap-2 text-sm font-black text-brand"
              >
                {deepGuide.label}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            )}
          </article>
          <aside className="overflow-hidden rounded-2xl border border-line bg-ink text-zinc-300">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <span className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                Quick reference
              </span>
              <TerminalSquare className="size-4 text-brand" />
            </div>
            {[
              ['Command', command.name],
              ['Category', command.category],
              ['Owner', command.origin],
              ['Index', `${position} / ${commands.length}`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-[90px_1fr] border-b border-white/10 px-5 py-4 last:border-b-0"
              >
                <span className="text-xs text-zinc-600">{label}</span>
                <code className="font-mono text-xs text-zinc-300">{value}</code>
              </div>
            ))}
          </aside>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro
            index="02"
            eyebrow="Usage"
            title="Start with the smallest useful invocation."
            description="Use the built-in help command whenever you need the live version's exact subcommands and argument shape."
          />
          <div className="mt-12 overflow-hidden rounded-2xl border border-line bg-ink">
            {examples.map((example, index) => (
              <div
                key={example}
                className="group flex items-center gap-4 border-b border-white/10 px-5 py-5 last:border-b-0 sm:px-7"
              >
                <span className="font-mono text-brand">❯</span>
                <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm text-zinc-200">
                  {example}
                </code>
                <button
                  type="button"
                  onClick={() => copy(example)}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-600 hover:bg-white/5 hover:text-white"
                  aria-label={`Copy ${example}`}
                >
                  <Copy className="size-3.5" />
                </button>
                <span className="hidden font-mono text-[9px] text-zinc-700 sm:block">
                  0{index + 1}
                </span>
              </div>
            ))}
          </div>
          {copied && (
            <p className="mt-3 text-right text-xs font-semibold text-emerald-500">
              Copied to clipboard.
            </p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro
          index="03"
          eyebrow="Operating pattern"
          title="Before, during and after the command."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-3">
          {[
            ['Before', guidance.before],
            ['During', guidance.during],
            ['After', guidance.after],
          ].map(([label, body], index) => (
            <article key={label} className="bg-card p-7">
              <span className="font-mono text-xs font-black text-brand-2">0{index + 1}</span>
              <h2 className="mt-8 text-xl font-black text-fg">{label}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{body}</p>
            </article>
          ))}
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <p className="text-sm leading-6 text-muted">
            <strong className="text-fg">Live help is authoritative:</strong> run{' '}
            <code className="font-mono text-xs text-brand">/help {command.name.slice(1)}</code> to
            see the exact command contract installed in your current version.
          </p>
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <Layers3 className="size-5 text-brand" />
            <h2 className="text-2xl font-black tracking-[-0.04em] text-fg">
              Related {command.category.toLowerCase()} commands
            </h2>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {related.map((item) => (
              <Link
                key={item.name}
                href={`/commands/${commandSlug(item.name)}`}
                className="group rounded-xl border border-line bg-card p-4 hover:border-brand"
              >
                <code className="font-mono text-sm font-black text-brand">{item.name}</code>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{item.summary}</p>
                <ArrowRight className="mt-5 size-3.5 text-faint transition-transform group-hover:translate-x-1 group-hover:text-brand" />
              </Link>
            ))}
          </div>
          <div className="mt-8">
            <ExternalDoc path="docs/slash/README.md">
              Open the canonical slash-command index
            </ExternalDoc>
          </div>
        </div>
      </section>
      <PageNext
        label="Command atlas"
        title={`Browse all ${commands.length} commands`}
        body="Search by intent, filter by category and open another dedicated reference page."
        href="/commands"
      />
    </>
  );
}
