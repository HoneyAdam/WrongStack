export interface TestSkipDeclaration {
  file: string;
  kind: string;
  fingerprint: string;
}

export interface TestSkipBudget {
  schemaVersion: number;
  declarations: TestSkipDeclaration[];
}

export function collectSkipDeclarations(source: string, file: string): TestSkipDeclaration[];
export function validateSkipBudget(
  current: TestSkipDeclaration[],
  baseline: TestSkipBudget,
): string[];
