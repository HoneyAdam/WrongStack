/**
 * Rich tool-result renderers for the HQ Console — a direct port of the main
 * WebUI's `ToolResult` shape detection at HQ's smaller surface:
 *   - Read output with leading `N→` line numbers → no-wrap numbered block
 *   - bash/shell output → stdout + exit-code footer (non-zero = red)
 *   - valid JSON → pretty-printed, collapsible (auto-expand when short)
 *   - everything else → wrapped monospace with auto-collapse for long bodies
 *
 * @module views/tool-result
 */
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { CopyButton } from '../lib/copy-button.js';

/** Long-output gate: bodies beyond this auto-collapse to a peek. */
const LONG_OUTPUT_THRESHOLD = 25;
const LONG_PEEK_LINES = 12;

function CollapsibleText({
  text,
  isError,
  wrap,
  framed = true,
}: {
  text: string;
  isError?: boolean | undefined;
  /** false = `whitespace-pre` (numbered output), true = wrap long lines. */
  wrap: boolean;
  /** Render its own border/background (off when nested in a bash frame). */
  framed?: boolean;
}): React.ReactElement {
  const lines = useMemo(() => text.split('\n'), [text]);
  const isLong = lines.length > LONG_OUTPUT_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);
  const shown = expanded ? text : lines.slice(0, LONG_PEEK_LINES).join('\n');
  return (
    <div className={`hq-result${framed ? '' : ' bare'}`}>
      <pre className={`hq-result-pre ${wrap ? 'wrap' : 'nowrap'}${isError ? ' err' : ''}`}>
        {shown}
      </pre>
      {isLong && (
        <button type="button" className="hq-result-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? (
            <>
              <ChevronsUp size={12} /> collapse to {LONG_PEEK_LINES} lines
            </>
          ) : (
            <>
              <ChevronsDown size={12} /> show all {lines.length} lines (+
              {lines.length - LONG_PEEK_LINES} more)
            </>
          )}
        </button>
      )}
    </div>
  );
}

interface Shape {
  kind: 'numbered' | 'json' | 'bash' | 'plain';
  value?: unknown;
  stdout?: string | undefined;
  exitCode?: number | undefined;
  duration?: string | undefined;
}

/** Mirror of the WebUI's shape detection (`ToolResult.tsx detectShape`). */
export function detectShape(toolName: string | undefined, result: string): Shape {
  const trimmed = result.trim();
  if (/^\s*\d+→/m.test(result.slice(0, 200))) return { kind: 'numbered' };
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) return { kind: 'json', value: parsed };
    } catch {
      /* fall through */
    }
  }
  const isBashTool = !!toolName && /^(bash|shell|exec|run|powershell)/i.test(toolName);
  const exitMatch = result.match(/(?:^|\n)\s*(?:\[?exit(?:\s*code)?\]?\s*[:=]?\s*)(\d+)\s*$/i);
  const durMatch = result.match(/(?:^|\s)(\d+\s*ms|\d+\.\d+s)\s*$/i);
  if (isBashTool || exitMatch) {
    let stdout = result;
    if (exitMatch) stdout = result.slice(0, exitMatch.index).trimEnd();
    return {
      kind: 'bash',
      stdout,
      exitCode: exitMatch ? Number(exitMatch[1]) : undefined,
      duration: durMatch?.[1],
    };
  }
  return { kind: 'plain' };
}

function JsonResult({
  value,
  isError,
}: {
  value: unknown;
  isError?: boolean | undefined;
}): React.ReactElement {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  const lineCount = pretty.split('\n').length;
  const [expanded, setExpanded] = useState(lineCount < 30);
  return (
    <div className={`hq-result${isError ? ' err-frame' : ''}`}>
      <button type="button" className="hq-result-jsonbar" onClick={() => setExpanded((v) => !v)}>
        <span className="hq-result-jsonbar-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>JSON · {lineCount} lines</span>
        </span>
        <span>{expanded ? 'collapse' : 'expand'}</span>
      </button>
      {expanded && <pre className={`hq-result-pre nowrap${isError ? ' err' : ''}`}>{pretty}</pre>}
    </div>
  );
}

/** Pick + render the right view for a tool's textual result. */
export function ToolResultView({
  toolName,
  result,
  isError,
}: {
  toolName: string | undefined;
  result: string;
  isError?: boolean | undefined;
}): React.ReactElement {
  const shape = useMemo(() => detectShape(toolName, result), [toolName, result]);

  if (shape.kind === 'json') return <JsonResult value={shape.value} isError={isError} />;
  if (shape.kind === 'numbered')
    return <CollapsibleText text={result} isError={isError} wrap={false} />;
  if (shape.kind === 'bash') {
    return (
      <div className="hq-result hq-result-bash">
        {shape.stdout !== undefined && shape.stdout !== '' && (
          <CollapsibleText text={shape.stdout} isError={isError} wrap framed={false} />
        )}
        {(shape.exitCode !== undefined || shape.duration !== undefined) && (
          <div
            className={`hq-result-exit${shape.exitCode !== undefined && shape.exitCode !== 0 ? ' bad' : ''}`}
          >
            {shape.exitCode !== undefined && <span>exit code {shape.exitCode}</span>}
            {shape.duration !== undefined && <span>{shape.duration}</span>}
          </div>
        )}
      </div>
    );
  }
  return <CollapsibleText text={result} isError={isError} wrap />;
}

export { CollapsibleText, CopyButton };
