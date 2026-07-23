import {
  color,
  ensureProjectGitignore,
  ensureProjectIdentity,
  projectIdentityPath,
  readProjectIdentity,
  rekeyProjectIdentity,
} from '@wrongstack/core/utils';
import type { SubcommandHandler } from '../contracts.js';

export const projectCmd: SubcommandHandler = async (args, deps) => {
  const action =
    deps.flags?.['help'] === true || deps.flags?.['h'] === true
      ? 'help'
      : (args[0] ?? 'id').toLowerCase();
  const filePath = projectIdentityPath(deps.projectRoot);

  if (action === 'id' || action === 'show') {
    const identity = await readProjectIdentity(deps.projectRoot);
    if (!identity) {
      deps.renderer.write(
        `No committed project identity. Run ${color.cyan('wstack project init')}.\n`,
      );
      return 1;
    }
    deps.renderer.write(
      `${color.bold('Project ID:')} ${color.cyan(identity.projectId)}\n${color.dim(filePath)}\n`,
    );
    return 0;
  }

  if (action === 'init') {
    const result = await ensureProjectIdentity(deps.projectRoot);
    await ensureProjectGitignore(deps.projectRoot);
    deps.renderer.write(
      result.created
        ? `${color.green('Created')} ${filePath}\n${color.cyan(result.identity.projectId)}\n${color.dim('Commit this file so every clone and machine shares the same HQ project.')}\n`
        : `${color.dim('Project identity already exists:')} ${color.cyan(result.identity.projectId)}\n`,
    );
    return 0;
  }

  if (action === 'rekey') {
    if (deps.flags?.['yes'] !== true) {
      deps.renderer.write(
        `${color.amber('Rekey changes the HQ/Kanban namespace for this fork.')} Re-run with ${color.cyan('--yes')} or ${color.cyan('-y')} to confirm.\n`,
      );
      return 1;
    }
    const result = await rekeyProjectIdentity(deps.projectRoot);
    await ensureProjectGitignore(deps.projectRoot);
    if (result.previous) deps.renderer.write(color.dim(`Previous: ${result.previous.projectId}\n`));
    deps.renderer.write(
      `${color.green('New project ID:')} ${color.cyan(result.identity.projectId)}\n` +
        color.dim(`Commit ${filePath} to make this fork independent on every machine.\n`),
    );
    return 0;
  }

  deps.renderer.write(
    [
      'Usage:',
      '  wstack project id',
      '  wstack project init',
      '  wstack project rekey --yes|-y',
      '',
    ].join('\n'),
  );
  return action === 'help' || action === '--help' ? 0 : 1;
};
