import {
  assessHqExposure,
  ensureHqFirstRunAuthFile,
  HqInsecureExposureError,
  resolveHqDataDir,
  type EnsureHqFirstRunAuthResult,
} from '@wrongstack/core';
import { resolveAuditActor } from './audit-actor.js';

export interface HqPreflightOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  password?: string;
  tokenTtlMs?: number;
  requireBrowserAuth?: boolean;
  allowInsecureOpen?: boolean;
}

export interface HqPreflightResult {
  host: string;
  port: number;
  dataDir: string;
  firstRunAuth: EnsureHqFirstRunAuthResult;
}

/** Resolves startup inputs and enforces exposure/auth policy before binding a socket. */
export async function prepareHqServerStart(
  options: HqPreflightOptions,
  defaults: { host: string; port: number },
): Promise<HqPreflightResult> {
  const host = options.host ?? defaults.host;
  const port = options.port ?? defaults.port;
  const dataDir = resolveHqDataDir(options.dataDir);
  const firstRunAuth = await ensureHqFirstRunAuthFile(dataDir, {
    warn: (message) =>
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'hq.auth_load_failed',
          message,
          timestamp: new Date().toISOString(),
        }),
      ),
    actor: resolveAuditActor(),
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(options.tokenTtlMs !== undefined ? { tokenTtlMs: options.tokenTtlMs } : {}),
  });
  const { authFile } = firstRunAuth;
  if (
    options.requireBrowserAuth &&
    (authFile.browserTokens ?? []).length === 0 &&
    authFile.passwordHash === undefined
  ) {
    throw new HqInsecureExposureError(
      'HQ public relay requires browser authentication. Set --password or create a browser token first.',
    );
  }
  const exposure = assessHqExposure({
    host,
    hasBrowserTokens: (authFile.browserTokens ?? []).length > 0,
    hasPassword: authFile.passwordHash !== undefined,
    allowInsecure: options.allowInsecureOpen,
  });
  if (exposure.kind === 'refuse') throw new HqInsecureExposureError(exposure.message);
  if (exposure.kind === 'warn') {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'hq.insecure_exposure',
        message: exposure.message,
        host,
        timestamp: new Date().toISOString(),
      }),
    );
  }
  return { host, port, dataDir, firstRunAuth };
}
