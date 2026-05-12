import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SkillLoader, SkillManifest } from '../types/skill.js';
import type { WstackPaths } from '../utils/wstack-paths.js';

export interface SkillLoaderOptions {
  paths: WstackPaths;
  bundledDir?: string;
}

/**
 * Discovery order (later layers shadow earlier ones at boot, but we walk
 * highest priority first and skip names already seen):
 *   1. Project-committed:  <project>/.wrongstack/skills/
 *   2. User-global:        ~/.wrongstack/skills/
 *   3. Bundled with build: packages/core/skills/
 */
export class DefaultSkillLoader implements SkillLoader {
  private readonly dirs: { dir: string; source: SkillManifest['source'] }[];
  private cache?: SkillManifest[];

  constructor(opts: SkillLoaderOptions) {
    this.dirs = [
      { dir: opts.paths.inProjectSkills, source: 'project' },
      { dir: opts.paths.globalSkills, source: 'user' },
    ];
    if (opts.bundledDir) {
      this.dirs.push({ dir: opts.bundledDir, source: 'bundled' });
    }
  }

  async list(): Promise<SkillManifest[]> {
    if (this.cache) return this.cache;
    const found: SkillManifest[] = [];
    const seen = new Set<string>();
    for (const { dir, source } of this.dirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const skillFile = path.join(dir, e.name, 'SKILL.md');
          try {
            const raw = await fs.readFile(skillFile, 'utf8');
            const meta = parseFrontmatter(raw);
            if (!meta.name || !meta.description) continue;
            if (seen.has(meta.name)) continue;
            seen.add(meta.name);
            found.push({
              name: meta.name,
              description: meta.description,
              version: meta.version,
              path: skillFile,
              source,
            });
          } catch {
            // skip malformed skill
          }
        }
      } catch {
        // directory may not exist
      }
    }
    this.cache = found;
    return found;
  }

  async find(name: string): Promise<SkillManifest | undefined> {
    const all = await this.list();
    return all.find((s) => s.name === name);
  }

  async manifestText(): Promise<string> {
    const skills = await this.list();
    if (skills.length === 0) return '';
    const lines = ['## Available skills'];
    for (const s of skills) {
      lines.push(`- **${s.name}** — ${s.description.replace(/\n/g, ' ').trim()}`);
      lines.push(`  Path: ${s.path}`);
    }
    return lines.join('\n');
  }

  async readBody(name: string): Promise<string> {
    const m = await this.find(name);
    if (!m) throw new Error(`Skill "${name}" not found`);
    return fs.readFile(m.path, 'utf8');
  }
}

interface Frontmatter {
  name?: string;
  description?: string;
  version?: string;
}

function parseFrontmatter(raw: string): Frontmatter {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return {};
  const block = raw.slice(4, end);
  const out: Frontmatter = {};
  let key: keyof Frontmatter | null = null;
  let value: string[] = [];
  const flush = () => {
    if (key) {
      out[key] = value.join('\n').trim();
    }
    key = null;
    value = [];
  };
  for (const line of block.split('\n')) {
    const m = /^([a-zA-Z_]+):\s*(\|?)\s*(.*)$/.exec(line);
    if (m) {
      flush();
      key = (m[1] ?? '') as keyof Frontmatter;
      const pipe = m[2];
      const rest = m[3] ?? '';
      if (pipe === '|') {
        value = [];
      } else if (rest) {
        value = [rest];
      } else {
        value = [];
      }
    } else if (key) {
      value.push(line.replace(/^\s+/, ''));
    }
  }
  flush();
  return out;
}
