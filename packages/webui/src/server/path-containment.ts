import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ToolValidationError } from '@wrongstack/core';

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function resolveWorkingDirInsideProject(projectRoot: string, inputPath: string): Promise<string> {
  const resolved = path.resolve(projectRoot, inputPath);

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new ToolValidationError({
      message: `Directory not found or not accessible: ${resolved}`,
      field: 'path',
    });
  }
  if (!stat.isDirectory()) {
    throw new ToolValidationError({
      message: `Directory not found or not accessible: ${resolved}`,
      field: 'path',
    });
  }

  const [realProjectRoot, realResolved] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(resolved),
  ]);

  if (!isPathInside(realProjectRoot, realResolved)) {
    throw new ToolValidationError({
      message: `Path must stay inside the project root: ${projectRoot}`,
      field: 'path',
    });
  }

  return resolved;
}
