import { readFileSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export function agentPrompt(id: string): string {
  const fileName = `${id}.md`;
  for (const dir of agentPromptDirCandidates()) {
    try {
      return readFileSync(path.join(dir, fileName), 'utf8').trimEnd();
    } catch {
      // try next candidate
    }
  }
  return '';
}

function agentPromptDirCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const explicitDir = process.env['WRONGSTACK_AGENT_INSTRUCTIONS_DIR'];
  const globalRoot = process.env['WRONGSTACK_HOME'] || path.join(os.homedir(), '.wrongstack');
  const candidates = [
    ...(explicitDir ? [path.resolve(explicitDir)] : []),
    path.join(globalRoot, 'instructions', 'agents'),
    path.resolve(here, '../../../../instructions/agents'),
    path.resolve(here, '../../../instructions/agents'),
    path.resolve(here, '../../instructions/agents'),
    path.resolve(here, '../instructions/agents'),
    path.resolve(here, 'instructions/agents'),
  ];
  return candidates.sort((a, b) => Number(!isDirectory(a)) - Number(!isDirectory(b)));
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}
