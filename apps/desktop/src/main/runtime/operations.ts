/**
 * Runtime and project operations.
 * Handles project management, runtime lifecycle, and workspace operations.
 */
import * as fs from 'node:fs/promises';
import type { DesktopWebuiCommand } from '../../shared/types.js';
import type { IRuntimeManager, IAgentBridge } from '../state/types.js';
import { desktopSettingsWorkspaceRoot } from '../runtime-manager.js';

export interface RuntimeOperationsContext {
  getRuntimeManager(): IRuntimeManager;
  getAgentBridge(): IAgentBridge;
  broadcastState(): void;
  syncActiveWebuiView(): void;
  dispatchWebuiCommand(command: DesktopWebuiCommand): Promise<boolean>;
  chooseProjectRoot(kind: 'open' | 'register'): Promise<string | undefined>;
}

/**
 * Open a project, optionally at a specific path.
 */
export async function openProject(
  ctx: RuntimeOperationsContext,
  requestedRoot?: string,
): Promise<ReturnType<IRuntimeManager['snapshot']>> {
  let projectRoot = requestedRoot;
  if (!projectRoot) {
    projectRoot = await ctx.chooseProjectRoot('open');
  }
  if (!projectRoot) return ctx.getRuntimeManager().snapshot();

  await ctx.getRuntimeManager().openProject(projectRoot);
  ctx.syncActiveWebuiView();
  ctx.broadcastState();
  return ctx.getRuntimeManager().snapshot();
}

/**
 * Register a project (add to global registry without opening).
 */
export async function registerProject(
  ctx: RuntimeOperationsContext,
  requestedRoot?: string,
): Promise<ReturnType<IRuntimeManager['snapshot']>> {
  let projectRoot = requestedRoot;
  if (!projectRoot) {
    projectRoot = await ctx.chooseProjectRoot('register');
  }
  if (!projectRoot) return ctx.getRuntimeManager().snapshot();

  await ctx.getRuntimeManager().registerProject(projectRoot);
  ctx.broadcastState();
  return ctx.getRuntimeManager().snapshot();
}

/**
 * Unregister a project from the global registry.
 */
export async function unregisterProject(
  ctx: RuntimeOperationsContext,
  root: string,
): Promise<ReturnType<IRuntimeManager['snapshot']>> {
  if (!root || typeof root !== 'string') return ctx.getRuntimeManager().snapshot();
  await ctx.getRuntimeManager().unregisterProject(root);
  ctx.broadcastState();
  return ctx.getRuntimeManager().snapshot();
}

/**
 * Open a new session for an existing project.
 */
export async function openProjectSession(
  ctx: RuntimeOperationsContext,
  runtimeId?: string,
): Promise<ReturnType<IRuntimeManager['snapshot']>> {
  const snapshot = ctx.getRuntimeManager().snapshot();
  const runtime =
    (runtimeId ? snapshot.runtimes.find((candidate) => candidate.id === runtimeId) : undefined) ??
    snapshot.runtimes.find((candidate) => candidate.id === snapshot.activeRuntimeId);

  if (runtime?.kind !== 'project') {
    return openProject(ctx);
  }

  await ctx.getRuntimeManager().openProject(runtime.root, { forceNew: true });
  ctx.syncActiveWebuiView();
  ctx.broadcastState();
  return ctx.getRuntimeManager().snapshot();
}

/**
 * Open global settings workspace.
 */
export async function openSettings(
  ctx: RuntimeOperationsContext,
): Promise<ReturnType<IRuntimeManager['snapshot']>> {
  const snapshot = ctx.getRuntimeManager().snapshot();
  const active = snapshot.runtimes.find((runtime) => runtime.id === snapshot.activeRuntimeId);

  if (!active || active.kind === 'global-settings' || active.status !== 'running') {
    const root = desktopSettingsWorkspaceRoot();
    await fs.mkdir(root, { recursive: true });
    await ctx.getRuntimeManager().openProject(root, {
      name: 'Global Settings',
      kind: 'global-settings',
      touchRecent: false,
    });
    ctx.syncActiveWebuiView();
    ctx.broadcastState();
  }

  await ctx.dispatchWebuiCommand({ view: 'settings' });
  return ctx.getRuntimeManager().snapshot();
}

/**
 * Activate a runtime (make it the active runtime).
 */
export async function activateRuntime(
  ctx: RuntimeOperationsContext,
  id: string,
): Promise<ReturnType<IRuntimeManager['snapshot']>> {
  await ctx.getRuntimeManager().activateRuntime(id);
  ctx.syncActiveWebuiView();
  ctx.broadcastState();
  return ctx.getRuntimeManager().snapshot();
}

/**
 * Close a runtime.
 */
export async function closeRuntime(
  ctx: RuntimeOperationsContext,
  id: string,
): Promise<ReturnType<IRuntimeManager['snapshot']>> {
  ctx.getAgentBridge().close(id);
  await ctx.getRuntimeManager().closeRuntime(id);
  ctx.syncActiveWebuiView();
  ctx.broadcastState();
  return ctx.getRuntimeManager().snapshot();
}

/**
 * Restore the last workspace (called on app startup).
 */
export async function restoreLastWorkspace(ctx: RuntimeOperationsContext): Promise<void> {
  await ctx.getRuntimeManager().restoreLastWorkspace();
  ctx.syncActiveWebuiView();
  ctx.broadcastState();
}
