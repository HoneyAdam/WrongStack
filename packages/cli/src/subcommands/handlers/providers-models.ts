import { type WireFamily, color } from '@wrongstack/core';
import type { SubcommandHandler } from '../index.js';

export const providersCmd: SubcommandHandler = async (args, deps) => {
  const showAll = args.includes('--all');
  const showUnsupported = args.includes('--unsupported');
  try {
    const all = await deps.modelsRegistry.listProviders();
    const byFamily: Record<WireFamily, typeof all> = {
      anthropic: [],
      openai: [],
      'openai-compatible': [],
      google: [],
      unsupported: [],
    };
    for (const p of all) byFamily[p.family].push(p);
    const families: WireFamily[] = showUnsupported
      ? ['unsupported']
      : showAll
        ? ['anthropic', 'openai', 'google', 'openai-compatible', 'unsupported']
        : ['anthropic', 'openai', 'google', 'openai-compatible'];
    for (const family of families) {
      const list = byFamily[family];
      if (list.length === 0) continue;
      deps.renderer.write(`\n${color.bold(family)} (${list.length}):\n`);
      for (const p of list) {
        const envFound = p.envVars.some((v) => process.env[v]);
        const marker = envFound ? color.green('●') : color.dim('○');
        const envHint = p.envVars[0] ? color.dim(`[${p.envVars[0]}]`) : '';
        const note = family === 'unsupported' ? color.dim('(needs plugin)') : '';
        deps.renderer.write(
          `  ${marker} ${p.id.padEnd(20)} ${p.name.padEnd(28)} ${envHint} ${note}\n`,
        );
      }
    }
    deps.renderer.write(
      `\n${color.dim(`Current: ${deps.config.provider ?? '<unset>'} / ${deps.config.model ?? '<unset>'}. Use --all to include unsupported families.`)}\n`,
    );
    return 0;
  } catch (err) {
    deps.renderer.writeError(
      `Failed to list providers: ${err instanceof Error ? err.message : err}`,
    );
    return 1;
  }
};

/** Parse `--key value` flags from a flat args array. */
function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const name = a.slice(2);
        if (i + 1 < args.length && !args[i + 1]!.startsWith('--')) {
          flags[name] = args[++i] ?? '';
        } else {
          flags[name] = true;
        }
      }
    }
  }
  return flags;
}

const DEFAULT_PER_PAGE = 15;

export const modelsCmd: SubcommandHandler = async (args, deps) => {
  const sub = args[0];
  if (sub === 'refresh') {
    deps.renderer.writeInfo('Refreshing models.dev cache…');
    try {
      const payload = await deps.modelsRegistry.refresh();
      deps.renderer.writeInfo(
        `Cached ${Object.keys(payload).length} providers to ${deps.paths.modelsCache}`,
      );
      return 0;
    } catch (err) {
      deps.renderer.writeError(`Refresh failed: ${err instanceof Error ? err.message : err}`);
      return 1;
    }
  }

  const flags = parseFlags(args);
  const search = typeof flags['search'] === 'string' ? flags['search'].toLowerCase() : '';
  const perPage =
    Number(flags['per-page']) > 0 ? Number(flags['per-page']) : DEFAULT_PER_PAGE;
  const page = Math.max(1, Number(flags['page']) || 1);

  // Use first positional arg as provider if given, else fall back to configured default.
  // Flags (--search, --page) filter/paginate the list — they don't change the provider.
  const providerId = sub ?? deps.config.provider ?? '';
  if (!providerId) {
    deps.renderer.writeError('Usage: wstack models <provider> [--search <term>] [--page N] [--per-page N]');
    return 1;
  }

  let lookupId = providerId;
  const savedAlias = deps.config.providers?.[providerId];
  if (savedAlias?.type && savedAlias.type !== providerId) lookupId = savedAlias.type;
  const provider = await deps.modelsRegistry.getProvider(lookupId);
  if (!provider) {
    deps.renderer.writeError(
      lookupId !== providerId
        ? `Alias "${providerId}" points at catalog id "${lookupId}" which is not in the cache.`
        : `Provider "${providerId}" not in catalog.`,
    );
    return 1;
  }
  if (lookupId !== providerId)
    deps.renderer.write(
      color.dim(`(showing catalog models for "${lookupId}" via alias "${providerId}")\n`),
    );
  deps.renderer.write(`${color.bold(provider.name)} ${color.dim(`(${provider.id})`)}\n`);
  if (provider.doc) deps.renderer.write(color.dim(`Docs: ${provider.doc}\n`));

  const userModels = deps.config.providers?.[providerId]?.models;
  const catalogById = new Map(provider.models.map((m) => [m.id, m]));
  const allSorted =
    userModels && userModels.length > 0
      ? userModels.map((id) => catalogById.get(id) ?? { id, name: id })
      : [...provider.models].sort((a, b) =>
          (b.release_date ?? '').localeCompare(a.release_date ?? ''),
        );

  if (userModels && userModels.length > 0)
    deps.renderer.write(color.dim(`(${userModels.length} model(s) from your saved config)\n`));

  const filtered = search
    ? allSorted.filter((m) => m.id.toLowerCase().includes(search))
    : allSorted;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const actualPage = Math.min(page, totalPages);
  const start = (actualPage - 1) * perPage;
  const pageItems = filtered.slice(start, start + perPage);
  const end = Math.min(start + pageItems.length, total);

  // Header
  const pageHint =
    totalPages > 1
      ? color.cyan(`[page ${actualPage}/${totalPages}]`)
      : '';
  const searchHint = search
    ? color.yellow(` (filtered: "${search}" — ${total} match${total === 1 ? '' : 'es'})`)
    : color.dim(` (${total} model${total === 1 ? '' : 's'})`);
  deps.renderer.write(`${pageHint}${searchHint}\n`);

  if (pageItems.length === 0) {
    deps.renderer.write(color.dim('(no models match)\n'));
  } else {
    if (start > 0)
      deps.renderer.write(color.dim(`  ${String.fromCharCode(8593)} ${start} above\n`));
    for (const m of pageItems) {
      const caps: string[] = [];
      if ('tool_call' in m && m.tool_call) caps.push('tools');
      if ('reasoning' in m && m.reasoning) caps.push('reasoning');
      if ('modalities' in m && m.modalities?.input?.includes('image')) caps.push('vision');
      const ctx = 'limit' in m && m.limit?.context ? `${(m.limit.context / 1000).toFixed(0)}k` : '?';
      const cost =
        'cost' in m && m.cost?.input !== undefined ? `${m.cost.input}/${m.cost.output ?? '?'}` : '';
      deps.renderer.write(
        `  ${m.id.padEnd(40)} ${color.dim(ctx.padStart(6))}  ${color.dim(cost.padEnd(14))} ${color.dim(caps.join(','))}\n`,
      );
    }
    if (end < total)
      deps.renderer.write(color.dim(`  ${String.fromCharCode(8595)} ${total - end} below\n`));
  }

  // Navigation footer
  const navLines: string[] = [];
  if (totalPages > 1) {
    if (actualPage > 1) navLines.push(`--page ${actualPage - 1} (prev)`);
    if (actualPage < totalPages) navLines.push(`--page ${actualPage + 1} (next)`);
  }
  navLines.push('--search <term> (filter)');
  deps.renderer.write(color.dim(`\n${navLines.join(' · ')}\n`));

  const age = await deps.modelsRegistry.ageSeconds();
  deps.renderer.write(
    color.dim(
      `Cache age: ${isFinite(age) ? `${Math.round(age / 60)}m` : 'never fetched'}. Run \`wstack models refresh\` to update.\n`,
    ),
  );
  return 0;
};
