import * as fs from 'node:fs/promises';
import { ToolValidationError } from '@wrongstack/core/types';
import { atomicWrite, unifiedDiff } from '@wrongstack/core/utils';
import type { Context } from '@wrongstack/core/agent';
import type { Tool } from '@wrongstack/core/types';
import { checkSyntax } from './_syntax-check.js';
import { safeResolveReal, sha256hex } from './_util.js';

interface WriteInput {
  path: string;
  content: string;
}

interface WriteOutput {
  path: string;
  bytes_written: number;
  created: boolean;
  diff?: string | undefined;
  /**
   * Parse errors found in the written content (TS/JS/JSON only). The file is
   * on disk as written — fix these with a follow-up edit now.
   */
  syntax_errors?: string[] | undefined;
  note?: string | undefined;
}

export const writeTool: Tool<WriteInput, WriteOutput> = {
  name: 'write',
  category: 'Filesystem',
  description:
    'Write or completely overwrite a file on disk. ' +
    'This is a high-privilege operation. For modifying existing files, you should almost always prefer the `edit` tool instead, ' +
    'because `edit` is safer and works on the last-read version of the file.',
  usageHint:
    'RULES FOR CORRECT USAGE:\n' +
    '- Use `write` primarily for **new files** or when you want to replace the entire content.\n' +
    '- For any existing file, strongly prefer `edit` (it requires a prior `read` in the same session and is more precise).\n' +
    '- You MUST have called `read` on the file earlier in the conversation before using `write` on an existing path (the system enforces this for safety).\n' +
    '- The path is resolved relative to the project root and protected against escaping the workspace.',
  selection: {
    doNotUseWhen: 'making a precise change to part of an existing file.',
    useInstead: ['edit'],
  },
  permission: 'confirm',
  mutating: true,
  timeoutMs: 5_000,
  capabilities: ['fs.write'],
  icon: 'file',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path from project root. Must not escape the project.',
      },
      content: {
        type: 'string',
        description: 'The complete new content of the file.',
      },
    },
    required: ['path', 'content'],
  },
  async execute(input, ctx, opts) {
    return writeFile(input, ctx, opts?.signal);
  },
  async *executeStream(input, ctx, opts) {
    const prepared = await prepareWrite(input, ctx);
    if (!prepared.existed) {
      for (const line of input.content.split('\n')) {
        yield { type: 'partial_output', text: `${line}\n`, data: { livePreview: true } };
      }
    }
    yield { type: 'final', output: await finishWrite(input, ctx, prepared, opts?.signal) };
  },
};

type PreparedWrite = {
  absPath: string;
  existed: boolean;
  prev: string;
};

async function writeFile(
  input: WriteInput,
  ctx: Context,
  signal?: AbortSignal | undefined,
): Promise<WriteOutput> {
  return finishWrite(input, ctx, await prepareWrite(input, ctx), signal);
}

async function prepareWrite(input: WriteInput, ctx: Context): Promise<PreparedWrite> {
  if (!input?.path) {
    throw new ToolValidationError({
      message: 'write: path is required',
      field: 'path',
    });
  }
  if (input.content === undefined) {
    throw new ToolValidationError({
      message: 'write: content is required',
      field: 'content',
    });
  }
  const absPath = await safeResolveReal(input.path, ctx);

  let existed = false;
  let prev = '';
  try {
    const stat = await fs.stat(absPath);
    existed = stat.isFile();
    if (existed) {
      if (!ctx.hasRead(absPath)) {
        // User approved this write (confirm → yes/always) but ctx has no
        // read record. The model may call write without a prior explicit
        // read. Read the file now so we can compute the diff and honor
        // the user's intent to overwrite. Tag as 'write' (NOT 'user') so
        // this internal read-for-diff does not widen the permission bypass
        // — the user never saw the old content (P1 #1).
        prev = await fs.readFile(absPath, 'utf8');
        ctx.recordRead(absPath, stat.mtimeMs, 'write', sha256hex(prev));
      } else {
        prev = await fs.readFile(absPath, 'utf8');
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  return { absPath, existed, prev };
}

async function finishWrite(
  input: WriteInput,
  ctx: Context,
  prepared: PreparedWrite,
  signal?: AbortSignal | undefined,
): Promise<WriteOutput> {
  // Last exit before mutating the filesystem: a run aborted during
  // prepare/diff must not leave a fresh write behind. (atomicWrite itself
  // is all-or-nothing, so past this point the file is old or new — never
  // partial.)
  signal?.throwIfAborted();
  await atomicWrite(prepared.absPath, input.content);

  const diff = prepared.existed
    ? unifiedDiff(prepared.prev, input.content, { fromFile: input.path, toFile: input.path })
    : `+++ ${input.path}\n+ (new file, ${input.content.split('\n').length} lines)`;

  const stat = await fs.stat(prepared.absPath);
  // Tag as 'write' so the permission bypass does not auto-approve a later
  // write to this path — the user approved THIS write, not future ones
  // (P1 #1).
  ctx.recordRead(prepared.absPath, stat.mtimeMs, 'write', sha256hex(input.content));

  // Record for session rewind
  ctx.session.recordFileChange({
    path: prepared.absPath,
    action: prepared.existed ? 'modified' : 'created',
    before: prepared.existed ? prepared.prev : null,
    after: input.content,
  });

  // Post-write syntax validation (TS/JS/JSON). The file stays on disk as
  // written — errors come back in the same turn so the model fixes them
  // before the user ever opens a broken file.
  const syntax = await checkSyntax(
    prepared.absPath,
    input.content,
    prepared.existed ? prepared.prev : undefined,
  ).catch(() => undefined);
  const hasSyntaxErrors = syntax !== undefined && syntax.errors.length > 0;

  return {
    path: prepared.absPath,
    bytes_written: Buffer.byteLength(input.content, 'utf8'),
    created: !prepared.existed,
    diff,
    syntax_errors: hasSyntaxErrors ? syntax.errors : undefined,
    note: hasSyntaxErrors
      ? syntax.preExisting
        ? 'Syntax check: the file still has parse errors (they pre-date this write) — see syntax_errors.'
        : `Syntax check: the written content has ${syntax.errors.length} parse error(s) — fix them now, see syntax_errors.`
      : undefined,
  };
}
