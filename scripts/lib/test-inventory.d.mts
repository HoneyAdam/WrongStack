export interface RuntimeTestAssignment {
  file: string;
  projects: string[];
}

export interface RuntimeTestProjectResult {
  projectId: string;
  expected: number;
  collected: number;
  missing: string[];
  unexpected: string[];
}

export function parseVitestFileList(repoRoot: string, stdout: string): string[];
export function validateRuntimeTestInventory(
  runtimeAssignments: RuntimeTestAssignment[],
  collectedByProject: Map<string, string[]>,
  projectIds: string[],
): { errors: string[]; projects: RuntimeTestProjectResult[] };
