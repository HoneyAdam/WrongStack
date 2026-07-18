import { describe, expect, it } from 'vitest';
import {
  formatBoundarySelectors,
  parseBoundarySelectors,
} from '../../src/components/KanbanBoundaryEditor';

describe('KanbanBoundaryEditor selector grammar', () => {
  it('round-trips file, package, directory, and glob selectors', () => {
    const selectors = parseBoundarySelectors(
      [
        'package:read_write:packages/webui',
        'file:read:README.md',
        'glob:write:packages/webui/src/**/*.tsx',
      ].join('\n'),
    );
    expect(formatBoundarySelectors(selectors)).toBe(
      [
        'package:read_write:packages/webui',
        'file:read:README.md',
        'glob:write:packages/webui/src/**/*.tsx',
      ].join('\n'),
    );
  });

  it('reports malformed selector lines', () => {
    expect(() => parseBoundarySelectors('folder:write:src')).toThrow(/unknown kind/);
    expect(() => parseBoundarySelectors('directory:execute:src')).toThrow(/unknown access/);
    expect(() => parseBoundarySelectors('directory:write')).toThrow(/kind:access:path/);
  });
});
