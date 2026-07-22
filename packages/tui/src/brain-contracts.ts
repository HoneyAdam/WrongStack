export type BrainRiskLevel = 'off' | 'low' | 'medium' | 'high' | 'all';

export interface BrainLogEntry {
  kind: string;
  question: string;
  outcome: string;
  age: string;
}
