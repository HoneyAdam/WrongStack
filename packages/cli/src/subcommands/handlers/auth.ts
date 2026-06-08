import { color } from '@wrongstack/core';
import { parseAuthFlags } from '../../arg-parser.js';
import { runAuthDirect, runAuthMenu, type AuthMenuDeps } from '../../auth-menu/index.js';
import { loadConfigProviders, maskedKey, normalizeKeys } from '../../provider-config-utils.js';
import type { SubcommandHandler } from '../index.js';

export const authCmd: SubcommandHandler = async (args, deps) => {
  const flags = parseAuthFlags(args);
  const menuDeps: AuthMenuDeps = {
    renderer: deps.renderer,
    reader: deps.reader,
    modelsRegistry: deps.modelsRegistry,
    vault: deps.vault,
    globalConfigPath: deps.paths.globalConfig,
  };

  // No args → interactive menu
  if (flags.positional.length === 0) {
    return runAuthMenu(menuDeps);
  }

  const first = flags.positional[0]!;

  // `wstack auth list` / `wstack auth ls` — quick listing
  if (first === 'list' || first === 'ls') {
    return runAuthList(menuDeps);
  }

  // `wstack auth <provider>` — direct add
  return runAuthDirect(menuDeps, {
    providerId: first,
    label: flags.label,
    family: flags.family,
    baseUrl: flags.baseUrl,
    envVars: flags.envVars,
  });
};

/** Quick read-only listing of all saved providers and their keys. */
async function runAuthList(deps: AuthMenuDeps): Promise<number> {
  let providers: Record<string, unknown>;
  try {
    providers = await loadConfigProviders(deps.globalConfigPath, deps.vault);
  } catch (err) {
    deps.renderer.writeError(`Could not read config: ${(err as Error).message}`);
    return 1;
  }

  const ids = Object.keys(providers).sort();

  if (ids.length === 0) {
    deps.renderer.write(
      `${color.dim('No providers configured.')}\n` +
        `${color.dim('Run')} ${color.bold('wstack auth')} ${color.dim('to add one.')}\n`,
    );
    return 0;
  }

  deps.renderer.write(`\n${color.bold('Saved providers')} ${color.dim(`(${ids.length})`)}\n\n`);

  for (const id of ids) {
    const cfg = providers[id] as {
      type?: string;
      family?: string;
      baseUrl?: string;
      activeKey?: string;
      apiKeys?: { label: string; apiKey: string; createdAt: string }[];
      apiKey?: string;
      models?: string[];
    } | undefined;
    if (!cfg) continue;

    const keys = normalizeKeys(cfg as Parameters<typeof normalizeKeys>[0]);
    const active = cfg.activeKey ?? keys[0]?.label;
    const famTag = cfg.family ? `${cfg.family}` : color.amber('no-family');
    const aliasHint =
      cfg.type && cfg.type !== id ? color.dim(` (→ ${cfg.type})`) : '';
    const modelHint =
      cfg.models && cfg.models.length > 0
        ? color.dim(` [${cfg.models.length} models]`)
        : '';

    deps.renderer.write(`  ${color.bold(id)}${aliasHint}\n`);
    deps.renderer.write(
      `    family:  ${famTag}  baseUrl: ${cfg.baseUrl ?? color.dim('unset')}${modelHint}\n`,
    );

    if (keys.length === 0) {
      deps.renderer.write(`    ${color.amber('no keys')}\n`);
    } else {
      deps.renderer.write(`    ${color.dim(`${keys.length} key${keys.length === 1 ? '' : 's'}:`)}\n`);
      for (const k of keys) {
        const marker = k.label === active ? color.green('●') : color.dim('○');
        deps.renderer.write(
          `      ${marker} ${k.label.padEnd(18)} ${maskedKey(k.apiKey)}  ${color.dim(k.createdAt)}\n`,
        );
      }
    }
    deps.renderer.write('\n');
  }

  deps.renderer.write(
    color.dim(`Manage: wstack auth   Add key: wstack auth <provider>\n`),
  );
  return 0;
}
