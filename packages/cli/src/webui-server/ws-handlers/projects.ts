import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Context } from '@wrongstack/core';
import { projectSlug, resolveProjectDir, wstackGlobalRoot } from '@wrongstack/core';
import { DefaultSessionStore } from '@wrongstack/core/storage';
import type { WebSocket } from 'ws';
import type { WsCommon } from './index.js';

/**
 * PR 5l of Issue #30: projects ws-handlers.
 *
 * Extracted from the inline `handleMessage` switch in webui-server.ts.
 * Backs the Projects panel: list registered projects, register a new
 * folder, and switch the live agent to a different project in-process.
 *
 * `projects.select` is the heaviest handler in the file — it re-roots the
 * agent context, finalizes the leaving session writer, starts a fresh
 * per-project session, rebuilds the system prompt, and broadcasts a reset
 * session.start so every client re-renders. The host-specific pieces
 * (system-prompt rebuild, in-flight abort, opts mutation, session.start
 * payload) are passed as explicit callbacks rather than captured, so the
 * handler has no hidden dependencies and is unit-testable.
 */

export interface ProjectsContext extends WsCommon {
  /** Global config path (`~/.wrongstack/config.json`); roots the manifest. */
  globalConfigPath: string | undefined;
}

export interface ProjectSwitchContext extends ProjectsContext {
  /** Live agent context — re-rooted in place on switch. */
  agentCtx: Context;
  /** Startup session id, used as the fallback when the live writer is absent. */
  startupSessionId: string;
  /** Re-root the host `opts.projectRoot` (read at call time by other handlers). */
  setProjectRoot: (root: string) => void;
  /** Swap the host `opts.sessionStore` to the new per-project store. */
  setSessionStore: (store: DefaultSessionStore) => void;
  /** Abort any in-flight run (module-scope + per-socket controllers) before re-rooting. */
  abortActiveRun: (ws: WebSocket) => void;
  /** Let the host re-point crash-recovery state at the swapped writer. */
  onSessionSwapped?: ((id: string) => void) | undefined;
  /** Rebuild the system prompt for the new project root (best-effort; host owns the builder deps). */
  rebuildSystemPrompt: (root: string) => Promise<void>;
  /** Build a session.start payload for the reset broadcast. */
  buildSessionStart: (overrides: {
    reset?: boolean;
    clearedSessionId?: string;
  }) => Promise<unknown>;
}

/** Send a success/failure result message (mirrors the host `sendResult`). */
function sendResult(ctx: WsCommon, ws: WebSocket, success: boolean, message: string): void {
  ctx.send(ws, { type: 'key.operation_result', payload: { success, message } });
}

export async function handleProjectsList(ctx: ProjectsContext, ws: WebSocket): Promise<void> {
  // Read the project manifest from ~/.wrongstack/projects.json
  const projectsBase = ctx.globalConfigPath
    ? path.resolve(path.dirname(ctx.globalConfigPath))
    : wstackGlobalRoot();
  const manifestPath = path.join(projectsBase, 'projects.json');
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as {
      projects: Array<{ name: string; root: string; slug: string; lastSeen?: string }>;
    };
    ctx.send(ws, {
      type: 'projects.list',
      payload: { projects: manifest.projects ?? [] },
    });
  } catch {
    ctx.send(ws, { type: 'projects.list', payload: { projects: [] } });
  }
}

export async function handleProjectsAdd(
  ctx: ProjectsContext,
  ws: WebSocket,
  payload: { root: string; name?: string | undefined },
): Promise<void> {
  // Register a folder in the project manifest (Projects panel "Add").
  const { root: addRoot, name: addName } = payload;
  try {
    const resolved = path.resolve(addRoot);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`Not a directory: ${resolved}`);

    const { loadManifest, saveManifest, ensureProjectDataDir } = await import(
      '../../slash-commands/project-utils.js'
    );
    const manifest = await loadManifest(ctx.globalConfigPath);
    const existing = manifest.projects.find((p) => path.resolve(p.root) === resolved);
    if (existing) {
      ctx.send(ws, {
        type: 'projects.added',
        payload: {
          name: existing.name,
          root: existing.root,
          slug: existing.slug,
          message: `Already registered as "${existing.name}"`,
        },
      });
      return;
    }
    const name = addName?.trim() || path.basename(resolved);
    const slug = projectSlug(resolved);
    await ensureProjectDataDir(slug, ctx.globalConfigPath);
    const now = new Date().toISOString();
    manifest.projects.push({ name, root: resolved, slug, lastSeen: now, createdAt: now });
    await saveManifest(manifest, ctx.globalConfigPath);
    ctx.send(ws, {
      type: 'projects.added',
      payload: { name, root: resolved, slug, message: `Registered project "${name}"` },
    });
  } catch (err) {
    ctx.send(ws, {
      type: 'projects.added',
      payload: {
        name: path.basename(addRoot),
        root: addRoot,
        slug: '',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

export async function handleProjectsSelect(
  ctx: ProjectSwitchContext,
  ws: WebSocket,
  payload: { root: string; name?: string | undefined },
): Promise<void> {
  // In-process project switch: re-root everything the handlers read at
  // call time (opts.projectRoot, agent ctx, session store), finalize the
  // old session writer, start a fresh session in the new project, and
  // broadcast a reset session.start so every client re-renders.
  const { root, name: projectName } = payload;
  try {
    const resolved = path.resolve(root);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) {
      ctx.send(ws, {
        type: 'projects.selected',
        payload: {
          root,
          name: projectName ?? path.basename(root),
          message: `Cannot switch: not a directory: ${resolved}`,
        },
      });
      return;
    }

    // Manifest: bump lastSeen, or auto-register an unknown root.
    const { loadManifest, saveManifest } = await import('../../slash-commands/project-utils.js');
    const manifest = await loadManifest(ctx.globalConfigPath);
    const entry = manifest.projects.find((p) => path.resolve(p.root) === resolved);
    const displayName = projectName?.trim() || entry?.name || path.basename(resolved);
    if (entry) {
      entry.lastSeen = new Date().toISOString();
    } else {
      manifest.projects.push({
        name: displayName,
        root: resolved,
        slug: projectSlug(resolved),
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    }
    await saveManifest(manifest, ctx.globalConfigPath);

    // Abort any in-flight run — its context is about to be re-rooted.
    ctx.abortActiveRun(ws);

    const agentCtx = ctx.agentCtx;
    const oldSessionId = agentCtx.session?.id ?? ctx.startupSessionId;

    // Finalize the writer we are leaving. Usage captured before the
    // counter reset below (the closure runs after it).
    const oldWriter = agentCtx.session;
    const oldUsage = agentCtx.tokenCounter.total();
    if (oldWriter) {
      void (async () => {
        await oldWriter
          .append({ type: 'session_end', ts: new Date().toISOString(), usage: oldUsage })
          .catch(() => undefined);
        await oldWriter.close().catch(() => undefined);
      })();
    }

    // Re-root: every handler resolves opts.projectRoot / ctx at call time
    // (files.*, mailbox.*, goal, …), so mutating these re-roots them all.
    ctx.setProjectRoot(resolved);
    agentCtx.cwd = resolved;
    agentCtx.projectRoot = resolved;

    // Rebuild the system prompt for the NEW project (best-effort — a
    // failure leaves the prior prompt rather than breaking the switch).
    await ctx.rebuildSystemPrompt(resolved);

    // Fresh per-project session store + session.
    const globalRoot = ctx.globalConfigPath
      ? path.dirname(ctx.globalConfigPath)
      : wstackGlobalRoot();
    const newSessionsDir = path.join(resolveProjectDir(resolved, globalRoot), 'sessions');
    await fs.mkdir(newSessionsDir, { recursive: true });
    const newStore = new DefaultSessionStore({ dir: newSessionsDir });
    ctx.setSessionStore(newStore);
    const newWriter = await newStore.create({
      id: '',
      title: '',
      model: agentCtx.model,
      provider: (agentCtx.provider as { id?: string }).id ?? '',
    });
    agentCtx.session = newWriter;
    ctx.onSessionSwapped?.(newWriter.id);
    agentCtx.state.replaceMessages([]);
    agentCtx.state.replaceTodos([]);
    agentCtx.readFiles.clear();
    agentCtx.fileMtimes.clear();
    agentCtx.tokenCounter.reset();

    ctx.send(ws, {
      type: 'projects.selected',
      payload: {
        root: resolved,
        name: displayName,
        message: `Switched to ${displayName}`,
      },
    });
    // Full-state broadcast so ALL clients re-root their panels.
    const switchedP = await ctx.buildSessionStart({
      reset: true,
      clearedSessionId: oldSessionId,
    });
    ctx.broadcast({ type: 'session.start', payload: switchedP });
  } catch (err) {
    sendResult(ctx, ws, false, err instanceof Error ? err.message : String(err));
  }
}
