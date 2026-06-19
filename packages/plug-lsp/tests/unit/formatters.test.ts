import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/formatters/diagnostics.js';
import { formatLocations } from '../../src/formatters/location.js';

import { editsByPath, summarizeWorkspaceEdit } from '../../src/formatters/workspace-edit.js';
import { pathToUri } from '../../src/utils/uri.js';

const cwd = process.cwd();

describe('formatters', () => {
  it('formats diagnostics with sorting, filtering, truncation, and fallback severity', () => {
    const file = `${cwd}/src.ts`;
    const out = formatDiagnostics(
      new Map([
        [
          file,
          [
            diagnostic(2, 5, 2, 'warn\nmessage', 'ts', 100),
            diagnostic(1, 2, 1, 'error message'),
            diagnostic(4, 1, 99, 'unknown severity'),
          ],
        ],
      ]),
      {
        cwd,
        severityFilter: ['error', 'warning'],
        maxPerFile: 2,
        maxTotal: 1,
      },
    );

    expect(out).toContain('src.ts (2):');
    expect(out).toContain('L2:3 ERROR: error message');
    expect(out).toContain('L3:6 WARN ts(100): warn | message');
    expect(
      formatDiagnostics(new Map(), { cwd, severityFilter: ['error'], maxPerFile: 1, maxTotal: 1 }),
    ).toBe('No LSP diagnostics.');
  });

  it('formats locations and symbols', () => {
    const uri = pathToUri(`${cwd}/a.ts`);
    expect(formatLocations(null, cwd)).toBe('No locations found.');
    expect(
      formatLocations(
        [
          { uri, range: range(0, 0) },
          { targetUri: uri, targetSelectionRange: range(1, 2), targetRange: range(1, 2) },
          { uri, range: range(2, 3) },
        ],
        cwd,
        2,
      ),
    ).toContain('... truncated 1 more');
  });

  it('summarizes workspace edits from both change shapes', () => {
    const uri = pathToUri(`${cwd}/a.ts`);
    const edit = {
      changes: { [uri]: [{ range: range(0, 0), newText: 'x' }] },
      documentChanges: [
        { textDocument: { uri, version: 1 }, edits: [{ range: range(1, 0), newText: 'y' }] },
      ],
    };

    expect(
      editsByPath(edit).get(`${cwd}\\a.ts`) ?? editsByPath(edit).get(`${cwd}/a.ts`),
    ).toHaveLength(1);
    expect(summarizeWorkspaceEdit(edit, cwd)).toContain('Total: 1 edits across 1 files.');
    expect(summarizeWorkspaceEdit({}, cwd)).toBe('WorkspaceEdit contains no text edits.');
  });
});

function diagnostic(
  line: number,
  character: number,
  severity: number,
  message: string,
  source?: string,
  code?: number,
) {
  return { range: range(line, character), severity, message, source, code };
}

function range(line: number, character: number) {
  return { start: { line, character }, end: { line, character: character + 1 } };
}
