export interface ModuleSpecifier {
  specifier: string;
  typeOnly: boolean;
  syntax: string;
}

export function collectModuleSpecifiers(sourceText: string, fileName: string): ModuleSpecifier[];
export function stronglyConnectedComponents(
  nodes: Iterable<string>,
  adjacency: Map<string, Set<string>>,
): string[][];
export function globToRegExp(pattern: string): RegExp;
export function findNonCommandSlashImports<T extends { from: string; to: string }>(edges: T[]): T[];
export function validateHotspotBaseline(
  sourceMetrics: Array<{ file: string; lines: number; relativeImports: number }>,
  baseline: { thresholdLines: number; files: Record<string, { lines: number; relativeImports: number }> },
): {
  errors: string[];
  candidates: Array<{ file: string; lines: number; relativeImports: number }>;
};

export interface ArchitectureHealthReport {
  errors: string[];
  [key: string]: unknown;
}

export function buildArchitectureHealth(options: {
  repoRoot: string;
  registry: unknown;
  exceptions: unknown;
  hotspots: unknown;
  now?: Date;
}): Promise<ArchitectureHealthReport>;
export function renderArchitectureHealthMarkdown(report: ArchitectureHealthReport): string;
export function loadArchitectureInputs(repoRoot: string): Promise<{
  registry: unknown;
  exceptions: unknown;
  hotspots: unknown;
}>;
