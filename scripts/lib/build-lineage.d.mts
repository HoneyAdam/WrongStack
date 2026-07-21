export interface BuildArtifactFingerprint {
  bytes: number;
  sha256: string;
}

export interface BuildManifest {
  schemaVersion: number;
  scope: string[];
  excludedPaths: string[];
  files: Record<string, BuildArtifactFingerprint>;
  [key: string]: unknown;
}

export function collectScopedDistFiles(
  repoRoot: string,
  workspaceRoots?: string[],
): Promise<string[]>;
export function createBuildManifest(
  repoRoot: string,
  files: string[],
  metadata?: Record<string, unknown>,
): Promise<BuildManifest>;
export function validateBuildManifest(
  repoRoot: string,
  manifest: BuildManifest,
  actualFiles: string[],
): Promise<string[]>;
