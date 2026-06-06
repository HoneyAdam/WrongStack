import type {
  Agent,
  Context,
  EventBus,
  ExtensionRegistry,
  PluginAPI,
  ProviderRegistry,
  SessionWriter,
  SlashCommandRegistry,
  ToolRegistry,
} from '@wrongstack/core';
import type { WrongStackPack } from './pack.js';

export interface RuntimeHost {
  agent: Agent;
  context: Context;
  events: EventBus;
  tools: ToolRegistry;
  providers: ProviderRegistry;
  slashCommands: SlashCommandRegistry;
  session: SessionWriter;
  extensions?: ExtensionRegistry | undefined;
  shutdown(): Promise<void>;
}

export interface RuntimeHostParts {
  agent: Agent;
  context: Context;
  events: EventBus;
  tools: ToolRegistry;
  providers: ProviderRegistry;
  slashCommands: SlashCommandRegistry;
  session: SessionWriter;
  extensions?: ExtensionRegistry | undefined;
  shutdown?: (() => void | Promise<void>) | undefined;
}

export function createRuntimeHostFromParts(parts: RuntimeHostParts): RuntimeHost {
  return {
    agent: parts.agent,
    context: parts.context,
    events: parts.events,
    tools: parts.tools,
    providers: parts.providers,
    slashCommands: parts.slashCommands,
    session: parts.session,
    extensions: parts.extensions,
    async shutdown() {
      await parts.shutdown?.();
    },
  };
}

export interface ApplyPackOptions {
  owner?: string | undefined;
  api?: PluginAPI | undefined;
}

export interface AppliedPack {
  pack: WrongStackPack;
  owner: string;
  teardown(): Promise<void>;
}

export async function applyWrongStackPack(
  host: Pick<RuntimeHost, 'tools' | 'providers' | 'slashCommands'> & {
    extensions?: ExtensionRegistry | undefined;
  },
  pack: WrongStackPack,
  opts: ApplyPackOptions = {},
): Promise<AppliedPack> {
  const owner = opts.owner ?? pack.name;
  const unregisterExtensions: Array<() => void> = [];

  if (pack.tools) {
    host.tools.registerAllOrThrow([...pack.tools], owner);
  }
  if (pack.providers) {
    host.providers.registerAll([...pack.providers]);
  }
  if (pack.slashCommands) {
    host.slashCommands.registerAll([...pack.slashCommands], owner);
  }
  if (pack.extensions && host.extensions) {
    for (const ext of pack.extensions) {
      unregisterExtensions.push(host.extensions.register(ext));
    }
  }
  if (pack.setup) {
    if (!opts.api) {
      throw new Error(`Pack "${pack.name}" defines setup() but no PluginAPI was provided`);
    }
    await pack.setup(opts.api);
  }

  return {
    pack,
    owner,
    async teardown() {
      for (const unregister of unregisterExtensions.reverse()) {
        unregister();
      }
      if (pack.teardown) {
        if (!opts.api) {
          throw new Error(`Pack "${pack.name}" defines teardown() but no PluginAPI was provided`);
        }
        await pack.teardown(opts.api);
      }
    },
  };
}

export async function applyWrongStackPacks(
  host: Pick<RuntimeHost, 'tools' | 'providers' | 'slashCommands'> & {
    extensions?: ExtensionRegistry | undefined;
  },
  packs: readonly WrongStackPack[],
  opts: ApplyPackOptions = {},
): Promise<AppliedPack[]> {
  const applied: AppliedPack[] = [];
  try {
    for (const pack of packs) {
      applied.push(await applyWrongStackPack(host, pack, opts));
    }
    return applied;
  } catch (err) {
    // Roll back already-mounted packs. Surface teardown failures via
    // process.emitWarning so they don't mask the original error but
    // remain visible — a silent teardown failure can leave state
    // half-initialized in ways that make the next run fail mysteriously.
    for (const mounted of applied.reverse()) {
      await mounted.teardown().catch((teardownErr) => {
        const detail = teardownErr instanceof Error ? teardownErr.message : String(teardownErr);
        process.emitWarning(
          `Pack teardown during error rollback failed: ${detail}`,
          'PackRollbackWarning',
        );
      });
    }
    throw err;
  }
}
