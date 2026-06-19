import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toast } from '../../src/components/Toaster';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toasterSrc = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/Toaster.tsx'),
  'utf8',
);

describe('Toaster', () => {
  // Regression: Toaster.tsx used to `import { randomUUID } from 'node:crypto'`,
  // which Vite bundles as an empty stub in the browser → every toast threw
  // `Ti.randomUUID is not a function` (surfaced when adding an MCP server).
  it('does not import from node:crypto (browser-unsafe)', () => {
    expect(toasterSrc).not.toMatch(/import\s+[^;]*from\s+['"]node:crypto['"]/);
  });

  it('pushes toasts without throwing and returns a unique id', () => {
    const id1 = toast.success('hello');
    const id2 = toast.error('world');
    expect(typeof id1).toBe('string');
    expect(id1).toMatch(/^toast_/);
    expect(id1).not.toBe(id2);
    toast.dismiss(id1);
    toast.dismiss(id2);
  });

  it('fires every variant without throwing', () => {
    expect(() => {
      toast.success('a');
      toast.error('b');
      toast.warn('c');
      toast.info('d');
      toast.undoable('e', () => {});
    }).not.toThrow();
  });
});
