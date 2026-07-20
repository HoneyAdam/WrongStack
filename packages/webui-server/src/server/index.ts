/**
 * @wrongstack/webui/server — public API barrel.
 *
 * Phase 1d of the god-module split: `startWebUI` and all server-internal
 * logic moved to `./start-webui.ts`. This file is now a pure re-export
 * surface so the CLI's embedded `--webui` mode and external consumers
 * import shared handlers, types, and utilities from one place.
 *
 * The package's `exports["./server"]` field points here.
 */

export { bootConfig, patchConfig } from './boot.js';
export type { BrainRouteHandlers } from './brain-routes.js';
export { handleBrainRoute } from './brain-routes.js';
export { setupWebUICodebaseIndexing } from './codebase-indexing.js';
export {
  type CodeMapFileTarget,
  type CodeMapOperation,
  extractCodeMapFileTargets,
  normalizeCodeMapFileTarget,
} from './codemap-telemetry.js';
export {
  type CollaborationHandlerOptions,
  CollaborationWebSocketHandler,
} from './collaboration-ws-handler.js';
export {
  type CompletionHandlerOptions,
  type CompletionItemKind,
  type CompletionSuggestion,
  createToolLspCompletionSource,
  handleCompletionRequest,
  type LspCompletionSource,
  type LspCompletionSourceRequest,
} from './completion-handlers.js';
export {
  type CustomContextMode,
  type CustomModeStore,
  createCustomModeStore,
} from './custom-context-modes.js';
export {
  type DesignContext,
  handleDesignList,
  handleDesignMaterialize,
  handleDesignSet,
  handleDesignState,
  handleDesignUse,
  handleDesignVerify,
} from './design-handlers.js';
export {
  createEternalSubscription,
  type EternalBroadcast,
  type EternalSubscribe,
  type EternalSubscription,
} from './eternal-iteration-broadcast.js';
export {
  handleFilesList,
  handleFilesRead,
  handleFilesTree,
  handleFilesWrite,
} from './file-handlers.js';
export { isHiddenEntry, rankFiles, SKIP_DIRS } from './file-picker.js';
export { handleGitChanges, handleGitDiff, handleGitInfo } from './git-handlers.js';
export { handleGoalGet } from './goal-handlers.js';
export type { GoalRouteHandlers } from './goal-routes.js';
// ── Additional re-exports for consumers/tests ──────────────────────────────
// Extracted server modules whose route handlers, validators, stores, and
// helpers are consumed directly (WebUI test suites migrated from the old
// packages/webui/src/server/* paths). Grouped by source module.
export { handleGoalRoute } from './goal-routes.js';
export { GoalWebSocketHandler } from './goal-ws-handler.js';
export type { WorklistContext } from './handlers/worklist-handlers.js';
export { handleWorklistMessage } from './handlers/worklist-handlers.js';
export {
  clearAnalyticsBuffer,
  getAnalyticsBuffer,
  handleApiAnalyticsGet,
  handleApiAnalyticsPost,
  handleApiAnalyticsSummary,
} from './http-server/analytics-handler.js';
export type { CreateHttpServerOptions } from './http-server.js';
export {
  buildCspHeader,
  createHttpServer,
  decodeSessionId,
  injectWsConfig,
  isInsideDist,
} from './http-server.js';
export {
  defaultBaseDir,
  formatInstances,
  isPidAlive,
  listInstances,
  registerInstance,
  registryPath,
  unregisterInstance,
  type WebUIInstanceRecord,
} from './instance-registry.js';
export type { KanbanBoardPage } from './kanban-routes.js';
export { paginateKanbanBoards } from './kanban-routes.js';
export { createShutdown, registerShutdownHandlers } from './lifecycle.js';
export { handleMailboxMessages } from './mailbox-handlers.js';
export type { MailboxRouteHandlers } from './mailbox-routes.js';
export { handleMailboxRoute } from './mailbox-routes.js';
export {
  handleMcpAdd,
  handleMcpDisable,
  handleMcpDiscover,
  handleMcpEnable,
  handleMcpList,
  handleMcpPromptGet,
  handleMcpPrompts,
  handleMcpRemove,
  handleMcpResourceRead,
  handleMcpResources,
  handleMcpRestart,
  handleMcpSleep,
  handleMcpUpdate,
  handleMcpWake,
} from './mcp-handlers.js';
export { handleMcpRoute } from './mcp-routes.js';
export {
  handleMemoryList,
  handleSuperMemoryBackfillRecoverable,
  handleSuperMemoryCandidateResolve,
  handleSuperMemoryDelete,
  handleSuperMemoryForFile,
  handleSuperMemoryGet,
  handleSuperMemoryGraph,
  handleSuperMemoryList,
  handleSuperMemoryListPage,
  handleSuperMemoryRecover,
  handleSuperMemoryRemember,
  handleSuperMemoryUpdate,
} from './memory-handlers.js';
export type { ModeRouteHandlers } from './mode-routes.js';
export { handleModeRoute } from './mode-routes.js';
export { resolveProviderCatalogForModels, resolveProviderModelMetadata } from './model-catalog.js';
export { browserOpenCommand, openBrowser } from './open-browser.js';
export { isPathInside, resolveWorkingDirInsideProject } from './path-containment.js';
export type { PendingConfirm } from './pending-confirms.js';
export {
  resolveAllPendingConfirms,
  resolveYoloEligiblePendingConfirms,
} from './pending-confirms.js';
export {
  findFreePort,
  getSurfaceDefaultPorts,
  isPortFree,
  SURFACE_DEFAULT_PORTS,
  type SurfaceKind,
  surfaceLabel,
} from './port-utils.js';
export { persistPrefsToConfig } from './pref-helpers.js';
export { handlePrefsRoute } from './prefs-routes.js';
export {
  handleProcessKill,
  handleProcessKillAll,
  handleProcessList,
} from './process-handlers.js';
export type { ProjectRouteHandlers } from './project-routes.js';
export { handleProjectRoute } from './project-routes.js';
export {
  ensureProjectDataDir,
  loadManifest,
  projectsJsonPath,
  saveManifest,
} from './projects-manifest.js';
export {
  handlePromptsContent,
  handlePromptsCreate,
  handlePromptsFavorite,
  handlePromptsList,
  handlePromptsRecent,
  handlePromptsSearch,
  handlePromptsUsed,
  type PromptsContext,
} from './prompts-handlers.js';
export { loadSavedProviders, saveProviders } from './provider-config-io.js';
export { createProviderConfigIO } from './provider-config-standalone.js';
export type { SavedProviderView } from './provider-handlers.js';
export { createProviderHandlers, projectSavedProviders } from './provider-handlers.js';
export {
  addProvider,
  deleteKey,
  type KeyOpResult,
  maskedKey,
  normalizeKeys,
  type ProvidersRecord,
  removeProvider,
  setActiveKey,
  upsertKey,
  writeKeysBack,
} from './provider-keys.js';
export type { ProviderRouteHandlers } from './provider-routes.js';
export { handleProviderRoute } from './provider-routes.js';
export type { ProviderStore } from './provider-store.js';
export { createConfigWriteLock, createProviderStore } from './provider-store.js';
export { handleSddBoardRoute } from './sdd-board-routes.js';
export { SddBoardWebSocketHandler } from './sdd-board-ws-handler.js';
export { handleSddWizardRoute } from './sdd-wizard-routes.js';
export {
  buildSddWizardDeps,
  type SddWizardWiringOptions,
  type StartSddRunFromGraphConfig,
  type StartSddRunFromGraphDeps,
  startSddRunFromGraph,
} from './sdd-wizard-wiring.js';
export { type SddWizardDeps, SddWizardWebSocketHandler } from './sdd-wizard-ws-handler.js';
export {
  type SessionHistoryWireEntry,
  toSessionHistoryEntries,
  toSessionHistoryEntry,
} from './session-history.js';
export type { SessionRouteHandlers } from './session-routes.js';
export { handleSessionRoute } from './session-routes.js';
export { setupEvents, statusProjectHashFromWatchFilename } from './setup-events.js';
export type { ShellGitRouteHandlers } from './shell-git-routes.js';
export { handleShellGitRoute } from './shell-git-routes.js';
export {
  handleShellOpen,
  type ShellOpenRequest,
  type ShellOpenResult,
  type ShellOpenTarget,
} from './shell-open.js';
export {
  handleSkillsContent,
  handleSkillsCreate,
  handleSkillsEdit,
  handleSkillsExport,
  handleSkillsInstall,
  handleSkillsList,
  handleSkillsUninstall,
  handleSkillsUpdate,
  type SkillsContext,
} from './skills-handlers.js';
export { handleSpecsRoute } from './specs-routes.js';
export { SpecsWebSocketHandler } from './specs-ws-handler.js';
export { startWebUI } from './start-webui.js';
export { TerminalWebSocketHandler } from './terminal-ws-handler.js';
export {
  type ContextBreakdown,
  estimateContextBreakdown,
  estimateTokens,
  type MessageTokenEntry,
  messagePreview,
  messageTokens,
  stringifyContent,
  type ToolTokenEntry,
} from './token-estimator.js';
export type {
  BackendServices,
  ConnectedClient,
  WebUIOptions,
  WSClientMessage,
  WSServerMessage,
} from './types.js';
export { computeUsageCost, getCostRates } from './usage-cost.js';
export { WorktreeWebSocketHandler } from './worktree-ws-handler.js';
export {
  extractToken,
  extractTokenFromCookie,
  hostHeaderOk,
  isLoopbackBind,
  isLoopbackHostname,
  isWildcardBind,
  tokenMatches,
  type VerifyClientInput,
  verifyClient,
} from './ws-auth.js';
export {
  validateAutonomySwitchPayload,
  validateBrainAskPayload,
  validateBrainRiskPayload,
  validateContextModeCreatePayload,
  validateContextModeDeletePayload,
  validateContextModeSwitchPayload,
  validateContextModeUpdatePayload,
  validateGitDiffPayload,
  validateMailboxAgentsPayload,
  validateMailboxMessagesPayload,
  validateMailboxPurgePayload,
  validateModelSwitchPayload,
  validateModeSwitchPayload,
  validatePlanTemplateUsePayload,
  validatePrefsUpdatePayload,
  validateProcessKillPayload,
  validateProjectsAddPayload,
  validateProjectsSelectPayload,
  validateShellOpenPayload,
  validateSkillsCreatePayload,
  validateSkillsEditPayload,
  validateWorkingDirSetPayload,
} from './ws-payload-validation.js';
export {
  broadcast,
  buildWebUIAccessUrl,
  envFlag,
  errMessage,
  generateAuthToken,
  hostForBrowserUrl,
  resolveAuthToken,
  send,
  sendResult,
} from './ws-utils.js';
export { createZipBuffer, readZipEntries, type ZipEntryInput } from './zip.js';
