import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

export interface SimpleUiDistDeps {
  resolvePackageJson?: (id: string) => string;
  exists?: (file: string) => boolean;
}

/** Resolve the independent SimpleUI frontend and fail closed if it is unbuilt. */
export function resolveSimpleUiDistDir(deps: SimpleUiDistDeps = {}): string {
  const requireFromHere = createRequire(import.meta.url);
  const resolvePackageJson =
    deps.resolvePackageJson ?? ((id: string) => requireFromHere.resolve(id));
  const exists = deps.exists ?? existsSync;

  let packageJson: string;
  try {
    packageJson = resolvePackageJson('@wrongstack/simpleui/package.json');
  } catch {
    throw new Error(
      'SimpleUI package could not be resolved. Install workspace dependencies and rebuild the CLI.',
    );
  }

  const distDir = path.join(path.dirname(packageJson), 'dist');
  if (!exists(path.join(distDir, 'index.html'))) {
    throw new Error(
      'SimpleUI frontend is not built. Run `pnpm --filter @wrongstack/simpleui build`.',
    );
  }
  return distDir;
}
