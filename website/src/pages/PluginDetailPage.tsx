import { ArrowRight, Blocks, GitBranch, Settings2, Webhook, Wrench } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';
import { pluginCatalog, pluginFromSlug, pluginSlug } from '@/data/runtime-catalog';
import { pluginDetails } from '@/data/plugin-details';
import { Link, useRouter } from '@/lib/router';

const riskStyles = {
  low: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
  medium: 'border-brand/25 bg-brand/10 text-brand',
  high: 'border-brand-2/25 bg-brand-2/10 text-brand-2',
} as const;

export function PluginDetailPage() {
  const { path } = useRouter();
  const pathParts = path.split('/').filter(Boolean);
  const slug = pathParts[pathParts.length - 1] ?? '';
  const plugin = pluginFromSlug(slug);
  if (!plugin) return null;
  const detail = pluginDetails[plugin.name];
  const position = pluginCatalog.findIndex((item) => item.name === plugin.name) + 1;
  const related = pluginCatalog
    .filter((item) => item.source === plugin.source && item.name !== plugin.name)
    .slice(0, 5);
  const hasTools = (detail?.tools.length ?? 0) > 0;
  const hasConfig = (detail?.configOptions.length ?? 0) > 0;
  const hasHooks = (detail?.hooks.length ?? 0) > 0;

  return (
    <>
      <PageHero
        index={`21.${String(position).padStart(2, '0')}`}
        eyebrow={`${plugin.source} plugin`}
        title={<span className="font-mono text-brand">{plugin.name}</span>}
        description={plugin.summary}
        aside={
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full border px-3 py-1.5 font-mono text-[10px] font-black uppercase ${riskStyles[plugin.risk]}`}
            >
              {plugin.risk} risk
            </span>
            <span className="rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[10px] font-black uppercase text-faint">
              {plugin.defaultState} by default
            </span>
            {detail?.version && (
              <span className="rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[10px] font-black uppercase text-faint">
                v{detail.version}
              </span>
            )}
          </div>
        }
      />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-32">
        <SectionIntro index="01" eyebrow="What it does" title={`Inside ${plugin.name}.`} />
        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_.72fr]">
          <article className="rounded-2xl border border-line bg-card p-6 sm:p-8">
            <Blocks className="size-5 text-brand" />
            <h2 className="mt-8 text-2xl font-black tracking-[-0.04em] text-fg">Behavior</h2>
            <p className="mt-4 text-base leading-8 text-muted">
              {detail?.longDescription ?? plugin.summary}
            </p>
            <p className="mt-4 text-sm leading-7 text-muted">
              Enable, disable and configure it with the{' '}
              <Link href="/commands/plugin" className="font-bold text-brand">
                /plugin
              </Link>{' '}
              command; options live under{' '}
              <code className="font-mono text-xs text-brand">plugins.{plugin.name}</code> in the
              project or user config.
            </p>
            {(detail?.apiVersion || (detail?.dependsOn?.length ?? 0) > 0) && (
              <div className="mt-6 flex flex-wrap gap-2">
                {detail?.apiVersion && (
                  <span className="rounded-full border border-line bg-bg px-3 py-1.5 font-mono text-[10px] font-bold text-faint">
                    kernel {detail.apiVersion}
                  </span>
                )}
                {detail?.dependsOn?.map((dep) => (
                  <span
                    key={dep}
                    className="rounded-full border border-line bg-bg px-3 py-1.5 font-mono text-[10px] font-bold text-faint"
                  >
                    needs {dep}
                  </span>
                ))}
              </div>
            )}
          </article>
          <aside className="space-y-6">
            {hasHooks && (
              <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <Webhook className="size-4 text-brand-2" />
                  <h2 className="text-lg font-black text-fg">Hooks &amp; events</h2>
                </div>
                <ul className="mt-5 space-y-2">
                  {detail?.hooks.map((hook) => (
                    <li key={hook} className="font-mono text-xs leading-6 text-muted">
                      {hook}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail?.example && (
              <div className="overflow-hidden rounded-2xl border border-line bg-ink">
                <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
                  <GitBranch className="size-4 text-brand" />
                  <span className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                    Config example
                  </span>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-xs leading-6 text-zinc-300">
                  {detail.example}
                </pre>
              </div>
            )}
          </aside>
        </div>
      </section>

      {hasTools && (
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
            <SectionIntro
              index="02"
              eyebrow="Registered tools"
              title="What the agent gains when this plugin is active."
            />
            <div className="mt-12 grid gap-5 lg:grid-cols-2">
              {detail?.tools.map((tool) => (
                <article key={tool.name} className="rounded-2xl border border-line bg-card p-6 sm:p-7">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-mono text-base font-black text-fg">{tool.name}</h3>
                    <div className="flex gap-2">
                      {tool.category && (
                        <span className="rounded-full border border-line bg-bg px-2.5 py-1 font-mono text-[10px] font-bold text-faint">
                          {tool.category}
                        </span>
                      )}
                      {tool.mutating !== undefined && (
                        <span className="rounded-full border border-line bg-bg px-2.5 py-1 font-mono text-[10px] font-bold text-faint">
                          {tool.mutating ? 'mutating' : 'read-only'}
                        </span>
                      )}
                    </div>
                  </div>
                  {tool.summary && (
                    <p className="mt-3 text-sm leading-6 text-muted">{tool.summary}</p>
                  )}
                  {tool.params && tool.params.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      {tool.params.map((param) => (
                        <div key={param.name} className="flex flex-wrap items-baseline gap-2 text-xs">
                          <code className="font-mono font-bold text-brand">{param.name}</code>
                          <code className="font-mono text-faint">{param.type}</code>
                          {param.description && (
                            <span className="text-muted">{param.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {hasConfig && (
        <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-32">
          <SectionIntro
            index={hasTools ? '03' : '02'}
            eyebrow="Configuration"
            title="Options validated by the plugin's schema."
            description="Every option is JSON-Schema validated at load time; invalid config is rejected before the plugin activates."
          />
          <div className="mt-12 overflow-hidden rounded-2xl border border-line">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-card font-mono text-[10px] font-black uppercase tracking-[0.14em] text-faint">
                    <th className="px-5 py-4">Option</th>
                    <th className="px-5 py-4">Type</th>
                    <th className="px-5 py-4">Default</th>
                    <th className="px-5 py-4">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {detail?.configOptions.map((option) => (
                    <tr key={option.name} className="border-b border-line bg-card last:border-b-0">
                      <td className="px-5 py-4 font-mono text-xs font-bold text-fg">
                        {option.name}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-brand">{option.type}</td>
                      <td className="px-5 py-4 font-mono text-xs text-muted">
                        {option.defaultValue ?? '—'}
                      </td>
                      <td className="px-5 py-4 leading-6 text-muted">
                        {option.description ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 lg:px-10">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <h2 className="text-2xl font-black tracking-[-0.04em] text-fg">
              More {plugin.source} plugins
            </h2>
            <div className="flex flex-wrap items-center gap-5">
              <Link
                href="/commands/plugin"
                className="group inline-flex items-center gap-2 text-sm font-black text-brand"
              >
                <Settings2 className="size-4" /> Manage with /plugin
              </Link>
              {plugin.source === 'Suite' && (
                <ExternalDoc path="packages/plugins/README.md">Plugin reference</ExternalDoc>
              )}
            </div>
          </div>
          {related.length > 0 && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item) => (
                <Link
                  key={item.name}
                  href={`/plugins/${pluginSlug(item.name)}`}
                  className="group rounded-2xl border border-line bg-card p-6 hover:border-brand"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="min-w-0 truncate font-mono text-base font-black text-fg">
                      {item.name}
                    </h3>
                    <Wrench className="size-4 shrink-0 text-faint" />
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{item.summary}</p>
                  <ArrowRight className="mt-6 size-4 text-faint transition-transform group-hover:translate-x-1 group-hover:text-brand" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <PageNext
        label="Plugin catalog"
        title="Browse all managed plugins"
        body="Search the complete catalog by source, default state and operational risk."
        href="/plugins"
      />
    </>
  );
}
