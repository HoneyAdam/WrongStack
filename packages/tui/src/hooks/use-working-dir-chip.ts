import type { Context } from '@wrongstack/core';
import * as path from 'node:path';
import { useEffect, useState } from 'react';

export function formatWorkingDirChip(
  workingDir: string | undefined,
  projectRoot: string,
): string | undefined {
  if (!workingDir || workingDir === projectRoot) return undefined;
  const rel = path.relative(projectRoot, workingDir) || '.';
  if (rel === '.') return undefined;
  return rel.replaceAll(path.sep, '/');
}

/**
 * Derive and keep in sync the relative working-directory chip text shown in
 * the TUI status bar.
 */
export function useWorkingDirChip(ctx: Context, projectRoot: string): string | undefined {
  const [workingDirChip, setWorkingDirChip] = useState<string | undefined>(() =>
    formatWorkingDirChip(ctx.workingDir, projectRoot),
  );

  useEffect(() => {
    setWorkingDirChip(formatWorkingDirChip(ctx.workingDir, projectRoot));
    return ctx.onWorkingDirChanged((newDir) => {
      setWorkingDirChip(formatWorkingDirChip(newDir, projectRoot));
    });
  }, [ctx, projectRoot]);

  return workingDirChip;
}
