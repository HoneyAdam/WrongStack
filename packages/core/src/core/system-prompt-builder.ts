import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { TextBlock } from '../types/blocks.js';
import type { Tool } from '../types/tool.js';
import type { SystemPromptBuilder, BuildContext } from '../types/system-prompt.js';
import type { MemoryStore } from '../types/memory.js';
import type { SkillLoader } from '../types/skill.js';
import type { ModeStore } from '../types/mode.js';

export const LAYER_1_IDENTITY = `You are WrongStack, a command-line AI coding agent.

You operate inside the user's terminal with direct read and write access to their working directory, the ability to run shell commands, and access to the web. You assist a developer who knows what they're doing — your job is to accelerate them, not to second-guess them.

## Core principles

1. Read before you write. Always inspect the relevant files before proposing changes. Assumptions about code you haven't read are bugs in waiting.

2. Prefer surgical edits over rewrites. When modifying existing files, use the edit tool with str_replace; only use write for new files or full replacements explicitly requested.

3. Show your work. Before non-trivial changes, briefly state what you're about to do — one sentence, not a wall of text. After tool calls, summarize what happened, not what you did mechanically.

4. Honest about limits. If you don't know, say so. If something failed, say what failed and what you'll try next. Never fabricate file contents, API responses, or test results.

5. Concise output. The user is a developer in a terminal. No marketing language, no "great question!", no bullet-point lists when prose works. If a one-liner answers, a one-liner is the answer.

6. Ask when blocked, proceed when not. If the task is ambiguous in a way that meaningfully changes the approach, ask. If it's ambiguous in a way that doesn't, pick a reasonable default and proceed, stating the assumption.

7. Trust the tools. If a permission prompt is shown, the user will answer. Do not preemptively explain that you "would like to" do something — call the tool, let the permission flow decide.

## What you do not do

- You do not lecture about software engineering principles unless asked.
- You do not add comments to code unless they materially help or were requested.
- You do not refactor adjacent code while fixing a bug, unless asked.
- You do not claim work is "production-ready" or "fully tested" — the user decides that.
- You do not apologize for failures. You report them and proceed.`;

export interface DefaultSystemPromptBuilderOptions {
  memoryStore?: MemoryStore;
  skillLoader?: SkillLoader;
  modeStore?: ModeStore;
  todayIso?: string;
}

export class DefaultSystemPromptBuilder implements SystemPromptBuilder {
  private envCache?: string;
  constructor(private readonly opts: DefaultSystemPromptBuilderOptions = {}) {}

  async build(ctx: BuildContext): Promise<TextBlock[]> {
    const layer1 = LAYER_1_IDENTITY;
    const layer2 = this.buildToolUsage(ctx.tools);
    const layer3 = await this.buildEnvironment(ctx);
    const layer4 = await this.buildMemoryAndSkills();
    const layer5 = await this.buildMode();

    const blocks: TextBlock[] = [
      { type: 'text', text: layer1 },
      { type: 'text', text: layer2 },
      { type: 'text', text: layer3 },
    ];

    if (layer4.trim()) {
      blocks.push({
        type: 'text',
        text: layer4,
        cache_control: { type: 'ephemeral' },
      });
    }

    if (layer5.trim()) {
      blocks.push({
        type: 'text',
        text: layer5,
        cache_control: { type: 'ephemeral' },
      });
    }

    return blocks;
  }

  private buildToolUsage(tools: Tool[]): string {
    if (tools.length === 0) return '## Tool usage\n\nNo tools registered.';
    const lines = ['## Tool usage'];
    for (const t of tools) {
      const hint = t.usageHint ?? t.description;
      lines.push(`\n### ${t.name}\n${hint.trim()}`);
    }
    return lines.join('\n');
  }

  private async buildEnvironment(ctx: BuildContext): Promise<string> {
    if (this.envCache) return this.envCache;
    const today = this.opts.todayIso ?? new Date().toISOString().slice(0, 10);
    const platform = `${os.platform()} ${os.release()}`;
    const shell = process.env.SHELL ?? process.env.ComSpec ?? 'unknown';
    const node = process.version;
    const isGit = await this.dirExists(path.join(ctx.projectRoot, '.git'));
    const git = isGit ? await this.gitStatus(ctx.projectRoot) : 'not a git repo';
    const langs = await this.detectLanguages(ctx.projectRoot);

    const lines = [
      '## Environment',
      '',
      `- Working directory: ${ctx.cwd}`,
      `- Project root: ${ctx.projectRoot}`,
      `- Operating system: ${platform}`,
      `- Shell: ${shell}`,
      `- Node.js: ${node}`,
      `- Detected languages: ${langs}`,
      `- Git status: ${git}`,
      `- Today's date: ${today}`,
    ];
    if (ctx.provider || ctx.model) {
      lines.push(
        `- Running on: ${ctx.provider ?? '<unknown provider>'}/${ctx.model ?? '<unknown model>'}`,
      );
    }
    const text = lines.join('\n');
    this.envCache = text;
    return text;
  }

  private async buildMemoryAndSkills(): Promise<string> {
    const parts: string[] = [];
    if (this.opts.memoryStore) {
      try {
        const mem = await this.opts.memoryStore.readAll();
        if (mem.trim()) parts.push(`# Project Memory\n\n${mem}`);
      } catch {
        // skip
      }
    }
    if (this.opts.skillLoader) {
      try {
        const manifest = await this.opts.skillLoader.manifestText();
        if (manifest.trim()) parts.push(manifest);
      } catch {
        // skip
      }
    }
    return parts.join('\n\n');
  }

  private async buildMode(): Promise<string> {
    if (!this.opts.modeStore) return '';
    const mode = await this.opts.modeStore.getActiveMode();
    if (!mode?.prompt) return '';
    return mode.prompt;
  }

  private async dirExists(p: string): Promise<boolean> {
    try {
      const stat = await fs.stat(p);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async gitStatus(root: string): Promise<string> {
    return new Promise((resolve) => {
      try {
        const proc = spawn('git', ['status', '--porcelain=v1', '--branch'], {
          cwd: root,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        let buf = '';
        proc.stdout?.on('data', (c) => {
          buf += c.toString();
        });
        proc.on('error', () => resolve('git error'));
        proc.on('close', () => {
          const lines = buf.split('\n').filter(Boolean);
          const branchLine = lines[0] ?? '';
          const branchMatch = /## ([^\s.]+)/.exec(branchLine);
          const branch = branchMatch?.[1] ?? 'detached';
          const dirty = lines.slice(1);
          const staged = dirty.filter((l) => /^[MARCD]/.test(l)).length;
          const modified = dirty.length - staged;
          resolve(`branch=${branch}, ${modified} modified, ${staged} staged`);
        });
      } catch {
        resolve('git unavailable');
      }
    });
  }

  private async detectLanguages(root: string): Promise<string> {
    const checks: Array<[string, string]> = [
      ['package.json', 'JavaScript/TypeScript'],
      ['tsconfig.json', 'TypeScript'],
      ['go.mod', 'Go'],
      ['Cargo.toml', 'Rust'],
      ['pyproject.toml', 'Python'],
      ['requirements.txt', 'Python'],
      ['Gemfile', 'Ruby'],
      ['pom.xml', 'Java'],
      ['build.gradle', 'Java/Kotlin'],
      ['composer.json', 'PHP'],
      ['mix.exs', 'Elixir'],
    ];
    const langs = new Set<string>();
    for (const [marker, lang] of checks) {
      try {
        await fs.access(path.join(root, marker));
        langs.add(lang);
      } catch {
        // skip
      }
    }
    return langs.size === 0 ? 'unknown' : Array.from(langs).join(', ');
  }
}
