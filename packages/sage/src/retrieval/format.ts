import { DEFAULT_PERSISTENCE, type Sage } from '../types.js';

export interface FormatMemoryHintsOptions {
  heading?: string | undefined;
  maxChars?: number | undefined;
}

export interface FormattedMemoryHints {
  text: string;
  memoryIds: string[];
}

export function formatMemoryHints(
  memories: Sage[],
  opts: FormatMemoryHintsOptions = {},
): string {
  return formatMemoryHintsDetailed(memories, opts).text;
}

/** Render whole memory lines and report exactly which records made the cut. */
export function formatMemoryHintsDetailed(
  memories: Sage[],
  opts: FormatMemoryHintsOptions = {},
): FormattedMemoryHints {
  if (memories.length === 0) return { text: '', memoryIds: [] };
  const heading = opts.heading ?? 'SAGE: related project knowledge';
  const maxChars = Math.max(0, Math.floor(opts.maxChars ?? 1200));
  if (maxChars === 0) return { text: '', memoryIds: [] };
  const lines = [`--- ${heading} ---`];
  const memoryIds: string[] = [];

  for (const memory of memories) {
    const persistence = memory.persistence ?? DEFAULT_PERSISTENCE;
    const labels = [
      memory.kind,
      persistence === 'permanent' ? 'permanent' : undefined,
      memory.importance >= 0.9 ? 'critical' : memory.importance >= 0.75 ? 'high' : undefined,
      memory.status !== 'active' ? memory.status : undefined,
    ].filter(Boolean);
    const anchor = formatPrimaryAnchor(memory);
    const tags = memory.tags.slice(0, 3);
    const metadata = [
      anchor ? `relation=${formatPrimaryRelation(memory)}` : undefined,
      tags.length > 0 ? `tags=${tags.join(',')}` : undefined,
    ].filter(Boolean);
    const suffix = `${anchor ? ` (${anchor})` : ''}${metadata.length > 0 ? ` [${metadata.join('; ')}]` : ''}`;
    const prefix = `- [${labels.join('][')}] `;
    let line = `${prefix}${memory.text}${suffix}`;
    const currentLength = lines.join('\n').length;
    if (currentLength + 1 + line.length > maxChars) {
      // If no item fits, keep one safely truncated item instead of slicing the
      // entire rendered block mid-label or mid-anchor. Otherwise stop at the
      // previous complete memory line.
      if (memoryIds.length > 0) break;
      const available = maxChars - currentLength - 1 - prefix.length - 1;
      if (available <= 0) break;
      line = `${prefix}${memory.text.slice(0, available).trimEnd()}…`;
    }
    lines.push(line);
    memoryIds.push(memory.id);
  }

  if (memoryIds.length === 0) return { text: '', memoryIds: [] };
  return { text: lines.join('\n'), memoryIds };
}

function formatPrimaryAnchor(memory: Sage): string {
  const anchor = memory.anchors.find((a) => a.path || a.symbol || a.command || a.role);
  if (!anchor) return '';
  if (anchor.symbol && anchor.path) return `${anchor.path}#${anchor.symbol}`;
  if (anchor.path) return anchor.path;
  if (anchor.symbol) return anchor.symbol;
  if (anchor.command) return anchor.command;
  if (anchor.role) return `agent:${anchor.role}`;
  return '';
}

function formatPrimaryRelation(memory: Sage): string {
  const anchor = memory.anchors.find(
    (item) => item.path || item.symbol || item.command || item.role,
  );
  if (!anchor) return 'related_to';
  switch (anchor.type) {
    case 'file':
    case 'test':
    case 'git':
      return 'about_file';
    case 'directory':
      return 'about_directory';
    case 'symbol':
      return 'about_symbol';
    case 'package':
      return 'about_package';
    case 'command':
      return 'about_command';
    case 'agent':
      return 'about_agent';
  }
}
