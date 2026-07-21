import type { WebSocket } from 'ws';
import { handleAutonomyRoute, type AutonomyRouteHandlers } from './autonomy-routes.js';
import { handleBrainRoute, type BrainRouteHandlers } from './brain-routes.js';
import { handleChronicleRoute, type ChronicleRouteContext } from './chronicle-routes.js';
import {
  handleClientTransportRoute,
  type ClientTransportRouteHandlers,
} from './client-transport-routes.js';
import { handleCompletionRoute, type CompletionRouteHandlers } from './completion-routes.js';
import { handleContentRoute, type ContentRouteContext } from './content-routes.js';
import { handleConversationRoute, type ConversationRouteHandlers } from './conversation-routes.js';
import { handleGoalRoute, type GoalRouteHandlers } from './goal-routes.js';
import {
  handleGoalSnapshotRoute,
  type GoalSnapshotRouteHandlers,
} from './goal-snapshot-routes.js';
import { handleHostRoute, type HostRouteHandlers } from './host-routes.js';
import {
  handleIntrospectionRoute,
  type IntrospectionRouteContext,
} from './introspection-routes.js';
import { handleKanbanHostRoute, type KanbanHostRouteHandlers } from './kanban-host-routes.js';
import { handleKanbanRoute, type KanbanRouteContext } from './kanban-routes.js';
import { handleMailboxRoute, type MailboxRouteHandlers } from './mailbox-routes.js';
import { handleMcpRoute, type McpRouteHandlers } from './mcp-routes.js';
import { handleMemoryRoute, type MemoryRouteContext } from './memory-routes.js';
import { handleModeRoute, type ModeRouteHandlers } from './mode-routes.js';
import { handlePrefsRoute, type PrefsRouteHandlers } from './prefs-routes.js';
import { handleProcessRoute, type ProcessRouteHandlers } from './process-routes.js';
import { handleProjectRoute, type ProjectRouteHandlers } from './project-routes.js';
import { handleProviderRoute, type ProviderRouteHandlers } from './provider-routes.js';
import { handleSddBoardRoute, type SddBoardRouteHandlers } from './sdd-board-routes.js';
import { handleSddWizardRoute, type SddWizardRouteHandlers } from './sdd-wizard-routes.js';
import { handleSessionRoute, type SessionRouteHandlers } from './session-routes.js';
import { handleShellGitRoute, type ShellGitRouteHandlers } from './shell-git-routes.js';
import { handleSpecsRoute, type SpecsRouteHandlers } from './specs-routes.js';
import type { WSClientMessage } from './types.js';
import { handleWorklistRoute, type WorklistRouteHandlers } from './worklist-routes.js';
import { handleWorktreeRoute, type WorktreeRouteHandlers } from './worktree-routes.js';

/** Host capabilities grouped by protocol family. Dispatch order lives here. */
export interface RouteFamilyTable {
  shellGit: ShellGitRouteHandlers;
  mailbox: MailboxRouteHandlers;
  mcp: McpRouteHandlers;
  provider: ProviderRouteHandlers;
  session: SessionRouteHandlers;
  project: ProjectRouteHandlers;
  mode: ModeRouteHandlers;
  prefs: PrefsRouteHandlers;
  brain: BrainRouteHandlers;
  worklist: WorklistRouteHandlers;
  process: ProcessRouteHandlers;
  host: HostRouteHandlers;
  clientTransport: ClientTransportRouteHandlers;
  conversation: ConversationRouteHandlers;
  completion: CompletionRouteHandlers;
  autonomy: AutonomyRouteHandlers;
  goalSnapshot: GoalSnapshotRouteHandlers;
  goal: GoalRouteHandlers;
  specs: SpecsRouteHandlers;
  sddBoard: SddBoardRouteHandlers;
  sddWizard: SddWizardRouteHandlers;
  worktree: WorktreeRouteHandlers;
  kanbanHost: KanbanHostRouteHandlers;
}

export interface RouteFamilyDispatcherOptions {
  routes: RouteFamilyTable;
  memory: MemoryRouteContext;
  content: ContentRouteContext;
  chronicle: ChronicleRouteContext;
  introspection: IntrospectionRouteContext;
  getKanbanContext: () => KanbanRouteContext;
  beforeDispatch?:
    | ((ws: WebSocket, message: WSClientMessage) => boolean | Promise<boolean>)
    | undefined;
  onUnknown: (ws: WebSocket, message: WSClientMessage) => void | Promise<void>;
}

export type RouteFamilyDispatcher = (
  ws: WebSocket,
  message: WSClientMessage,
) => Promise<void>;

export function createRouteFamilyDispatcher(
  options: RouteFamilyDispatcherOptions,
): RouteFamilyDispatcher {
  const { routes } = options;
  return async (ws, message) => {
    if (options.beforeDispatch && !(await options.beforeDispatch(ws, message))) return;
    if (await handleShellGitRoute(ws, message, routes.shellGit)) return;
    if (await handleMailboxRoute(ws, message, routes.mailbox)) return;
    if (await handleMcpRoute(ws, message, routes.mcp)) return;
    if (await handleProviderRoute(ws, message, routes.provider)) return;
    if (await handleSessionRoute(ws, message, routes.session)) return;
    if (await handleProjectRoute(ws, message, routes.project)) return;
    if (await handleModeRoute(ws, message, routes.mode)) return;
    if (await handlePrefsRoute(ws, message, routes.prefs)) return;
    if (await handleBrainRoute(ws, message, routes.brain)) return;
    if (await handleWorklistRoute(ws, message, routes.worklist)) return;
    if (await handleProcessRoute(ws, message, routes.process)) return;
    if (await handleHostRoute(ws, message, routes.host)) return;
    if (await handleClientTransportRoute(ws, message, routes.clientTransport)) return;
    if (await handleConversationRoute(ws, message, routes.conversation)) return;
    if (await handleCompletionRoute(ws, message, routes.completion)) return;
    if (await handleAutonomyRoute(ws, message, routes.autonomy)) return;
    if (await handleGoalSnapshotRoute(ws, message, routes.goalSnapshot)) return;
    if (await handleGoalRoute(ws, message, routes.goal)) return;
    if (await handleSpecsRoute(ws, message, routes.specs)) return;
    if (await handleSddBoardRoute(ws, message, routes.sddBoard)) return;
    if (await handleSddWizardRoute(ws, message, routes.sddWizard)) return;
    if (await handleWorktreeRoute(ws, message, routes.worktree)) return;
    if (await handleKanbanHostRoute(ws, message, routes.kanbanHost)) return;
    if (await handleMemoryRoute(options.memory, ws, message)) return;
    if (await handleContentRoute(options.content, ws, message)) return;
    if (await handleChronicleRoute(options.chronicle, ws, message)) return;
    if (await handleIntrospectionRoute(options.introspection, ws, message)) return;
    if (await handleKanbanRoute(ws, message, options.getKanbanContext())) return;
    await options.onUnknown(ws, message);
  };
}
