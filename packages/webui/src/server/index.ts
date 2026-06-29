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
export { AutoPhaseWebSocketHandler } from './autophase-ws-handler.js';
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
export { handleGitChanges, handleGitDiff, handleGitInfo } from './git-handlers.js';
export type { CreateHttpServerOptions } from './http-server.js';
export { buildCspHeader, createHttpServer, injectWsPort } from './http-server.js';
export {
  defaultBaseDir,
  formatInstances,
  listInstances,
  registerInstance,
  registryPath,
  unregisterInstance,
  type WebUIInstanceRecord,
} from './instance-registry.js';
export {
  handleMcpAdd,
  handleMcpDisable,
  handleMcpDiscover,
  handleMcpEnable,
  handleMcpList,
  handleMcpRemove,
  handleMcpRestart,
  handleMcpSleep,
  handleMcpUpdate,
  handleMcpWake,
} from './mcp-handlers.js';
export {
  handleMemoryForget,
  handleMemoryList,
  handleMemoryRemember,
} from './memory-handlers.js';
export { browserOpenCommand, openBrowser } from './open-browser.js';
export { findFreePort, isPortFree } from './port-utils.js';
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
export {
  createProviderConfigIO,
  loadSavedProviders,
  saveProviders,
} from './provider-config-io.js';
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
export { SddBoardWebSocketHandler } from './sdd-board-ws-handler.js';
export { buildSddWizardDeps, type SddWizardWiringOptions } from './sdd-wizard-wiring.js';
export { type SddWizardDeps, SddWizardWebSocketHandler } from './sdd-wizard-ws-handler.js';
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
  handleSkillsUninstall,
  handleSkillsUpdate,
  type SkillsContext,
} from './skills-handlers.js';
export { SpecsWebSocketHandler } from './specs-ws-handler.js';
export {
  type ContextBreakdown,
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
export { WorktreeWebSocketHandler } from './worktree-ws-handler.js';
export {
  extractToken,
  hostHeaderOk,
  isLoopbackBind,
  isLoopbackHostname,
  tokenMatches,
  type VerifyClientInput,
  verifyClient,
} from './ws-auth.js';
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

export { startWebUI } from './start-webui.js';
