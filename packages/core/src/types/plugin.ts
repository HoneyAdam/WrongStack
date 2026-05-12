import type { Container } from '../kernel/container.js';
import type { EventBus } from '../kernel/events.js';
import type { Pipeline } from '../kernel/pipeline.js';
import type { Tool } from './tool.js';
import type { Provider, Request, Response } from './provider.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

export interface ToolRegistryView {
  register(t: Tool): void;
  unregister(name: string): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
}

export interface ProviderFactory {
  type: string;
  create(cfg: unknown): Provider;
}

export interface ProviderRegistryView {
  register(f: ProviderFactory): void;
  create(cfg: { type: string } & Record<string, unknown>): Provider;
  list(): string[];
}

export interface MCPRegistryView {
  start(cfg: unknown): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  list(): { name: string; state: string; toolCount: number }[];
}

export interface PluginPipelines {
  request: Pipeline<Request>;
  response: Pipeline<Response>;
  // biome-ignore lint/suspicious/noExplicitAny: pipelines are heterogeneous
  [k: string]: Pipeline<any>;
}

export interface PluginAPI {
  container: Container;
  pipelines: PluginPipelines;
  events: EventBus;
  tools: ToolRegistryView;
  providers: ProviderRegistryView;
  mcp: MCPRegistryView;
  config: Config;
  log: Logger;
}

export interface Plugin {
  name: string;
  version?: string;
  apiVersion: string;
  dependsOn?: string[];
  conflictsWith?: string[];
  setup(api: PluginAPI): void | Promise<void>;
  teardown?(api: PluginAPI): void | Promise<void>;
}
