import type { SubcommandDeps, SubcommandHandler } from '../index.js';

export const pluginCmd: SubcommandHandler = async (args, deps) => {
  const sub = args[0];
  if (!sub || sub === 'list') {
    const plugins = deps.config.plugins ?? [];
    if (plugins.length === 0) {
      deps.renderer.write('No plugins configured.\n');
      return 0;
    }
    for (const p of plugins) {
      const name = typeof p === 'string' ? p : p.name;
      const enabled = typeof p === 'object' && p.enabled === false ? 'disabled' : 'enabled';
      deps.renderer.write(`  ${name}  ${enabled}\n`);
    }
    return 0;
  }
  deps.renderer.writeWarning(`plugin ${sub} not implemented (edit config.plugins manually).`);
  return 0;
};

export const usageCmd: SubcommandHandler = async (_args, deps) => {
  if (!deps.sessionStore) return 0;
  const list = await deps.sessionStore.list(100);
  let totalIn = 0;
  for (const s of list) totalIn += s.tokenTotal;
  deps.renderer.write(`Sessions: ${list.length}  total tokens: ${totalIn}\n`);
  return 0;
};
