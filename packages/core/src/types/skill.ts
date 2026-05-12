export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  path: string;
  source: 'project' | 'user' | 'bundled';
}

export interface SkillLoader {
  list(): Promise<SkillManifest[]>;
  find(name: string): Promise<SkillManifest | undefined>;
  manifestText(): Promise<string>;
  readBody(name: string): Promise<string>;
}
