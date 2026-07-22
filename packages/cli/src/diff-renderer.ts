import { color } from '@wrongstack/core/utils';

export function renderDiff(diff: string): string {
  if (!diff) return '';
  const lines = diff.split('\n');
  return lines
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return color.bold(line);
      if (line.startsWith('@@')) return color.cyan(line);
      if (line.startsWith('+')) return color.green(line);
      if (line.startsWith('-')) return color.red(line);
      return color.dim(line);
    })
    .join('\n');
}
