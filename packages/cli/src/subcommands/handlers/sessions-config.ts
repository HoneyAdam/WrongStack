import { color } from '@wrongstack/core';
import type { SubcommandDeps, SubcommandHandler } from '../index.js';
import { redactKeys } from './helpers.js';

export const sessionsCmd: SubcommandHandler = async (_args, deps) => {
  if (!deps.sessionStore) {
    deps.renderer.writeError('No session store available.');
    return 1;
  }
  const list = await deps.sessionStore.list(20);
  if (list.length === 0) {
    deps.renderer.write('No sessions found.\n');
    return 0;
  }
  for (const s of list)
    deps.renderer.write(
      `  ${s.id}  ${color.dim(s.startedAt)}  ${color.dim(`${s.tokenTotal} tok`)}  ${s.title}\n`,
    );
  return 0;
};

export const configCmd: SubcommandHandler = async (args, deps) => {
  const sub = args[0];
  if (!sub || sub === 'show') {
    deps.renderer.write(JSON.stringify(redactKeys(deps.config), null, 2) + '\n');
    return 0;
  }
  if (sub === 'edit') {
    const editor = process.env['EDITOR'] ?? 'vi';
    deps.renderer.write(`Run: ${editor} ${deps.paths.globalConfig}\n`);
    return 0;
  }
  deps.renderer.writeError(`Unknown config subcommand: ${sub}`);
  return 1;
};
