import type { SuperMemory } from '../types.js';

export interface FormatMemoryHintsOptions {
  heading?: string | undefined;
  maxChars?: number | undefined;
}

export function formatMemoryHints(
  memories: SuperMemory[],
  opts: FormatMemoryHintsOptions = {},
): string {
  if (memories.length === 0) return '';
  const heading = opts.heading ?? 'Super Memory: related project knowledge';
  const maxChars = opts.maxChars ?? 1200;
  const lines = [`--- ${heading} ---`];

  for (const memory of memories) {
    const labels = [
      memory.kind,
      memory.importance >= 0.9 ? 'critical' : memory.importance >= 0.75 ? 'high' : undefined,
      memory.status !== 'active' ? memory.status : undefined,
    ].filter(Boolean);
    const anchor = formatPrimaryAnchor(memory);
    const suffix = anchor ? ` (${anchor})` : '';
    lines.push(`- [${labels.join('][')}] ${memory.text}${suffix}`);
    if (lines.join('\n').length >= maxChars) break;
  }

  const rendered = lines.join('\n');
  if (rendered.length <= maxChars) return rendered;
  return `${rendered.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n- ...`;
}

function formatPrimaryAnchor(memory: SuperMemory): string {
  const anchor = memory.anchors.find((a) => a.path || a.symbol || a.command);
  if (!anchor) return '';
  if (anchor.symbol && anchor.path) return `${anchor.path}#${anchor.symbol}`;
  if (anchor.path) return anchor.path;
  if (anchor.symbol) return anchor.symbol;
  if (anchor.command) return anchor.command;
  return '';
}
