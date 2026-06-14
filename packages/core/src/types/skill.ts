export interface SkillManifest {
  name: string;
  description: string;
  version?: string | undefined;
  path: string;
  source: 'project' | 'user' | 'bundled';
}

/** Parsed skill entry for structured rendering in system prompt. */
export interface SkillEntry {
  name: string;
  /** "Use when..." trigger condition — one-liner */
  trigger: string;
  /** Comma-separated scope items */
  scope: string[];
  source: SkillManifest['source'];
  path: string;
}

export interface SkillLoader {
  list(): Promise<SkillManifest[]>;
  /** Structured entries with trigger/scope for system prompt rendering. */
  listEntries(): Promise<SkillEntry[]>;
  find(name: string): Promise<SkillManifest | undefined>;
  manifestText(): Promise<string>;
  readBody(name: string): Promise<string>;
  /**
   * Read the token-saving compact variant of a skill body.
   * Tries `SKILL.save.md` first (hand-crafted compact version), falls back
   * to auto-compacting the full `SKILL.md` body.
   */
  readSaveBody(name: string): Promise<string>;
  /** Clear the internal cache so the next list/find re-reads from disk. */
  invalidateCache(): void;
}
