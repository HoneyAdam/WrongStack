import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export function modePrompt(id: string): string {
  for (const dir of modePromptDirCandidates()) {
    try {
      return readFileSync(path.join(dir, `${id}.md`), 'utf8').trimEnd();
    } catch {
      // try next candidate
    }
  }
  return '';
}

function modePromptDirCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../instructions/modes'),
    path.resolve(here, '../instructions/modes'),
    path.resolve(here, 'instructions/modes'),
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
