/**
 * Red/green diff card for edit / write / patch tool calls — consumes the
 * shared `@wrongstack/tools/tool-diff` model (the same LCS/unified engine the
 * main WebUI's DiffView uses), so both surfaces render identical hunks.
 *
 * @module views/diff-view
 */
import {
  type DiffRow,
  diffFromToolInput,
  diffRowsFromToolInput,
} from '@wrongstack/tools/tool-diff';
import type React from 'react';
import { useMemo } from 'react';

const GUTTER: Record<DiffRow['kind'], string> = {
  add: '+',
  del: '-',
  ctx: ' ',
  meta: '@',
};

export function ToolDiffView({
  toolName,
  toolInput,
}: {
  toolName: string | undefined;
  toolInput: string | undefined;
}): React.ReactElement | null {
  const diff = useMemo(() => diffRowsFromToolInput(toolName, toolInput), [toolName, toolInput]);
  if (!diff) return null;
  const { caption, rows } = diff;
  if (rows === null) {
    return <div className="hq-tool-empty">diff too large to render — {caption}</div>;
  }
  const adds = rows.filter((r) => r.kind === 'add').length;
  const dels = rows.filter((r) => r.kind === 'del').length;
  return (
    <div className="hq-diff">
      <div className="hq-diff-stat">
        <span className="hq-diff-path" title={caption}>
          {caption}
        </span>
        <span className="hq-diff-add-count">+{adds}</span>
        <span className="hq-diff-del-count">-{dels}</span>
      </div>
      <pre className="hq-diff-body">
        {rows.map((r, i) => (
          <span key={i} className={`hq-diff-line ${r.kind}`}>
            <span className="hq-diff-gutter">{GUTTER[r.kind]}</span>
            {r.text || ' '}
          </span>
        ))}
      </pre>
    </div>
  );
}

/** True when this tool call carries a renderable file change (cheap check —
 * no LCS is computed until the card actually renders). */
export function hasToolDiff(toolName: string | undefined, toolInput: string | undefined): boolean {
  return diffFromToolInput(toolName, toolInput) !== null;
}
