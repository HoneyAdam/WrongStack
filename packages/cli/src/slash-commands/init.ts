import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SlashCommand } from '@wrongstack/core';
import { detectProjectFacts, renderAgentsTemplate } from './helpers.js';
import type { SlashCommandContext } from './index.js';

export function buildInitCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'init',
    description: 'Scaffold .wrongstack/AGENTS.md in the current project.',
    async run(args, ctx) {
      const force = args.trim() === '--force';
      const dir = path.join(ctx.projectRoot, '.wrongstack');
      const file = path.join(dir, 'AGENTS.md');
      try {
        await fs.access(file);
        if (!force) {
          const msg = `AGENTS.md already exists at ${file}. Use "/init --force" to overwrite.`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
      } catch {
        /* proceed */
      }
      const detected = await detectProjectFacts(ctx.projectRoot);
      const body = renderAgentsTemplate(detected);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, body, 'utf8');
      if (detected.hints.length > 0) {
        const msg = `Wrote ${file}\nPre-filled: ${detected.hints.join(', ')}. Edit the file to add anything else worth remembering.`;
        opts.renderer.writeInfo(`Wrote ${file}`);
        opts.renderer.writeInfo(
          `Pre-filled: ${detected.hints.join(', ')}. Edit the file to add anything else worth remembering.`,
        );
        return { message: msg };
      }
      const msg = `Wrote ${file}\nNo project type auto-detected. Edit the file to add build/test commands and conventions.`;
      opts.renderer.writeInfo(`Wrote ${file}`);
      return { message: msg };
    },
  };
}
