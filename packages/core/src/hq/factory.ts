import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import { GlobalMailbox } from '../coordination/global-mailbox.js';
import type { EventBus } from '../kernel/events.js';
import type { HqClientConfig } from '../types/config.js';
import { hqAuthFilePath, readHqRuntimeFileSync, resolveHqDataDir, type HqAuthFile } from './auth-store.js';
import type { HqClientCapability, HqClientIdentity, HqProjectIdentity, HqRedactionPolicy } from './protocol.js';
import { HqPublisher, type HqPublisherCommandHandler, type HqSocketFactory } from './publisher.js';

export interface HqPublisherEnvConfig {
  url: string;
  token?: string;
  enabled?: boolean;
  rawContent?: boolean;
  projectAlias?: string;
  /**
   * Same-machine auto-discovery mode: no explicit URL was configured, so the
   * publisher should re-resolve the endpoint from `<dataDir>/runtime.json`
   * (+ the first client token in `auth.json`) before every connect attempt.
   * This lets every client on the machine attach to a `wstack --hq` that is
   * already running, starts later, or restarts on a different port.
   */
  discover?: boolean;
  /** Resolved HQ data dir the discovery reads from. */
  dataDir?: string;
}

/**
 * Discover a locally running `wstack --hq` endpoint: reads the runtime
 * marker (pid-liveness-checked) and the first client token. Returns
 * `undefined` when no live HQ is advertised on this machine.
 */
export function discoverLocalHqEndpoint(options: {
  dataDir?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
} = {}): { url: string; token?: string | undefined } | undefined {
  const dataDir = resolveHqDataDir(options.dataDir, options.env ?? process.env);
  const runtime = readHqRuntimeFileSync(dataDir);
  if (runtime === undefined) return undefined;
  const token = readFirstClientTokenFromAuthFile(dataDir);
  return { url: runtime.url, ...(token ? { token } : {}) };
}

function readFirstClientTokenFromAuthFile(dataDir: string): string | undefined {
  try {
    const raw = fs.readFileSync(hqAuthFilePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as HqAuthFile;
    return parsed.clientTokens?.find((t) => t.token.trim().length > 0)?.token;
  } catch {
    return undefined;
  }
}

export function resolveHqConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HqPublisherEnvConfig | undefined {
  return resolveHqConfig({ env });
}

export function resolveHqConfig(options: {
  env?: NodeJS.ProcessEnv | undefined;
  config?: HqClientConfig | undefined;
} = {}): HqPublisherEnvConfig | undefined {
  const env = options.env ?? process.env;
  const fileConfig = options.config;
  const envUrl = env['WRONGSTACK_HQ_URL']?.trim();
  const envToken = env['WRONGSTACK_HQ_TOKEN']?.trim();
  const configUrl = fileConfig?.url?.trim();
  const configToken = fileConfig?.token?.trim();
  const envEnabledRaw = env['WRONGSTACK_HQ_ENABLED']?.trim();
  const enabled = envEnabledRaw !== undefined && envEnabledRaw.length > 0
    ? envEnabledRaw !== '0'
    : fileConfig?.enabled;
  const dataDir = resolveHqDataDir(fileConfig?.dataDir, env);
  const token = envToken || configToken || readFirstClientTokenFromAuthFile(dataDir);
  const runtimeUrl = readHqRuntimeFileSync(dataDir)?.url.trim();
  const url = envUrl || configUrl;

  if (!url) {
    if (enabled === false) return undefined;
    // No explicit endpoint → same-machine auto-discovery (default ON).
    // The publisher re-resolves runtime.json + auth.json before every
    // connect attempt, so an HQ started AFTER this client — or restarted on
    // another port — is attached to automatically. While no HQ is running
    // the publisher stays dormant (bounded queue, cheap file poll).
    // Opt out with WRONGSTACK_HQ_ENABLED=0 or config `hq.enabled: false`.
    return {
      url: runtimeUrl || 'http://127.0.0.1:3499',
      enabled: true,
      discover: true,
      dataDir,
      ...(token ? { token } : {}),
    };
  }

  const rawContentEnv = env['WRONGSTACK_HQ_RAW_CONTENT']?.trim();
  const projectAliasEnv = env['WRONGSTACK_HQ_PROJECT_ALIAS']?.trim();
  return {
    url,
    ...(token ? { token } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(rawContentEnv ? { rawContent: rawContentEnv === '1' } : fileConfig?.rawContent !== undefined ? { rawContent: fileConfig.rawContent } : {}),
    ...(projectAliasEnv ? { projectAlias: projectAliasEnv } : fileConfig?.projectAlias ? { projectAlias: fileConfig.projectAlias } : {}),
  };
}

function stableMachineId(): string {
  // Stable per *physical machine*, NOT per process — every terminal on the
  // same computer must share one machineId so HQ groups them under a single
  // machine node. (Process identity already lives in clientId via the pid.)
  return createHash('sha256').update(hostname()).digest('hex').slice(0, 12);
}

function deriveProjectId(projectRoot: string): string {
  return createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
}

export interface CreateHqPublisherOptions {
  clientKind: HqClientIdentity['kind'];
  projectRoot: string;
  projectName?: string;
  machineId?: string;
  hostnameOverride?: string;
  socketFactory?: HqSocketFactory;
  config?: HqPublisherEnvConfig;
  appConfig?: { hq?: HqClientConfig | undefined } | undefined;
  redactionPolicy?: Partial<HqRedactionPolicy>;
  /** Forwarded to the HqPublisher constructor (Phase 4 control plane). */
  capabilities?: readonly HqClientCapability[];
  /** Forwarded to the HqPublisher constructor (Phase 4 control plane). */
  onCommand?: HqPublisherCommandHandler;
  /** Dormant discovery re-check interval override (tests / tight loops). */
  discoveryPollMs?: number;
}

export function createHqPublisherFromEnv(options: CreateHqPublisherOptions): HqPublisher | undefined {
  const config = options.config ?? resolveHqConfig({ config: options.appConfig?.hq });
  if (!config || config.enabled === false) return undefined;

  const machineId = options.machineId ?? stableMachineId();
  const host = options.hostnameOverride ?? hostname();
  const projectName = options.projectName ?? config.projectAlias ?? (basename(options.projectRoot) || 'unknown');

  const client: HqClientIdentity = {
    clientId: `${machineId}:${options.clientKind}:${process.pid}`,
    kind: options.clientKind,
    machineId,
    ...(host ? { hostname: host } : {}),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  const project: HqProjectIdentity = {
    projectId: deriveProjectId(options.projectRoot),
    projectRoot: options.projectRoot,
    projectName,
    machineId,
    workspaceKind: 'git',
  };

  const redactionPolicy: Partial<HqRedactionPolicy> | undefined =
    options.redactionPolicy || config.rawContent !== undefined
      ? {
          ...(config.rawContent !== undefined ? { rawContent: config.rawContent } : {}),
          ...(options.redactionPolicy ?? {}),
        }
      : undefined;

  const discoveryDataDir = config.dataDir;
  return new HqPublisher({
    url: config.url,
    ...(config.token ? { token: config.token } : {}),
    client,
    project,
    ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}),
    ...(redactionPolicy !== undefined ? { redactionPolicy } : {}),
    ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
    ...(options.onCommand !== undefined ? { onCommand: options.onCommand } : {}),
    // Auto-discovery: re-read the local HQ runtime marker + client token on
    // every connect attempt so late-started/restarted HQs are picked up.
    ...(config.discover
      ? { resolveEndpoint: () => discoverLocalHqEndpoint({ dataDir: discoveryDataDir }) }
      : {}),
    ...(options.discoveryPollMs !== undefined ? { discoveryPollMs: options.discoveryPollMs } : {}),
  });
}

export interface CreateGlobalMailboxOptions {
  projectDir: string;
  events?: EventBus;
  hqPublisher?: HqPublisher;
}

export function createGlobalMailbox(options: CreateGlobalMailboxOptions): GlobalMailbox {
  return new GlobalMailbox(options.projectDir, options.events, options.hqPublisher);
}
