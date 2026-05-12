import type { Permission } from './tool.js';
import type { WireFamily } from './models-registry.js';

export interface ContextConfig {
  warnThreshold: number;
  softThreshold: number;
  hardThreshold: number;
  maxSessionTokens?: number;
  maxDailyTokens?: number;
  preserveK: number;
  eliseThreshold: number;
}

export interface ToolsConfig {
  defaultExecutionStrategy: 'parallel' | 'sequential' | 'smart';
  maxIterations: number;
  iterationTimeoutMs: number;
  sessionTimeoutMs: number;
  perIterationOutputCapBytes: number;
}

export interface ProviderConfig {
  type: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  model?: string;
  quirks?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  /**
   * Optional wire-family override. When present, the provider can be
   * constructed without consulting the models.dev catalog — useful for
   * self-hosted endpoints, internal proxies, or for working offline.
   */
  family?: WireFamily;
  /** Custom env var names to probe when `apiKey` is missing. */
  envVars?: string[];
  /** Optional list of models the user wants visible for this provider. */
  models?: string[];
}

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  allowedTools?: string[];
  permission?: Permission;
  startupTimeoutMs?: number;
}

export interface LogConfig {
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  file?: string;
}

export interface PluginConfig {
  name: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
}

/**
 * Optional subsystems that the CLI can boot without. The core flow
 * (provider + agent loop + bundled tools + session) always works; these
 * just add capabilities. `--no-features` flips all of these off, which
 * is the minimum viable WrongStack: a single provider, a fixed config,
 * no network calls at startup.
 */
export interface FeaturesConfig {
  /** Load MCP servers declared in `mcpServers`. */
  mcp: boolean;
  /** Load + initialise npm plugins declared in `plugins`. */
  plugins: boolean;
  /** Register `remember` / `forget` tools backed by memory store. */
  memory: boolean;
  /** Fetch the models.dev catalog at startup. When false, the provider
   *  must declare its `family` explicitly in `providers[<id>]`. */
  modelsRegistry: boolean;
  /** Discover + load skills from disk. */
  skills: boolean;
}

export interface Config {
  version: 1;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  providers?: Record<string, ProviderConfig>;
  context: ContextConfig;
  tools: ToolsConfig;
  mcpServers?: Record<string, MCPServerConfig>;
  plugins?: (string | PluginConfig)[];
  log: LogConfig;
  features: FeaturesConfig;
  yolo?: boolean;
  cwd?: string;
}

export interface ConfigLoader {
  load(opts?: { cliFlags?: Partial<Config>; cwd?: string }): Promise<Config>;
}
