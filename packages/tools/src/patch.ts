import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Tool } from '@wrongstack/core';
import { safeResolve } from './_util.js';

interface PatchInput {
  patch: string;
  directory?: string;
  strip?: number;
  dry_run?: boolean;
}

interface PatchOutput {
  applied: number;
  rejected: number;
  files: string[];
  dry_run: boolean;
  message: string;
}

export const patchTool: Tool<PatchInput, PatchOutput> = {
  name: 'patch',
  description:
    'Apply a unified diff patch to files. Writes .orig and .rej files on failure.',
  usageHint:
    'Set `patch` (the diff text). `directory` defaults to cwd. `strip` removes leading path components. `dry_run` previews.',
  permission: 'confirm',
  mutating: true,
  timeoutMs: 30_000,
  inputSchema: {
    type: 'object',
    properties: {
      patch: { type: 'string', description: 'Unified diff patch content' },
      directory: { type: 'string', description: 'Root directory for patch (default: cwd)' },
      strip: { type: 'integer', description: 'Strip leading path components (default: 1)' },
      dry_run: { type: 'boolean', description: 'Preview without applying' },
    },
    required: ['patch'],
  },
  async execute(input, ctx, opts) {
    if (!input?.patch) throw new Error('patch: patch content is required');

    const dir = input.directory ? safeResolve(input.directory, ctx) : ctx.cwd;
    const strip = input.strip ?? 1;
    const dryRun = input.dry_run ?? false;

    const patchFile = path.join(dir, `.wstack_patch_${Date.now()}.diff`);
    await fs.writeFile(patchFile, input.patch, 'utf8');

    const args = [
      '-p' + strip,
      '--merge',
      ...(dryRun ? ['--dry-run'] : []),
      '-i', patchFile,
    ];

    const result = await runPatch(args, dir, opts.signal);
    await fs.unlink(patchFile).catch(() => {});

    if (result.exitCode !== 0 && !dryRun) {
      return {
        applied: 0,
        rejected: 1,
        files: [],
        dry_run: dryRun,
        message: `patch failed: ${result.stderr || result.stdout}`,
      };
    }

    return {
      applied: result.stdout.includes('patching file') ? 1 : 0,
      rejected: 0,
      files: extractPatchedFiles(result.stdout),
      dry_run: dryRun,
      message: result.stdout || 'patch applied',
    };
  },
};

function runPatch(args: string[], cwd: string, signal: AbortSignal): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn('patch', args, { cwd, signal, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    child.on('error', (e) => resolve({ exitCode: 1, stdout: '', stderr: e.message }));
  });
}

function extractPatchedFiles(output: string): string[] {
  const files: string[] = [];
  const re = /patching file (.+)/gi;
  for (const m of output.matchAll(re)) {
    if (m[1]) files.push(m[1]);
  }
  return files;
}