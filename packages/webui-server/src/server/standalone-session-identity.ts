import * as path from 'node:path';
import type { EventBus } from '@wrongstack/core/kernel';
import type { Config, Logger, SessionStore } from '@wrongstack/core/types';
import {
  AgentStatusTracker,
  FleetNotifier,
  getSessionRegistry,
  RecoveryLock,
  type SessionRegistry,
} from '@wrongstack/core/storage';
import { WebSocket } from 'ws';

export interface StandaloneSessionIdentityPaths {
  globalRoot: string;
  projectRoot: string;
  projectSlug: string;
  projectSessions: string;
}

export interface StandaloneSessionIdentityOptions {
  config: Config;
  events: EventBus;
  logger: Logger;
  paths: StandaloneSessionIdentityPaths;
  workingDir: string;
  initialSessionId: string;
  sessionStore?: SessionStore | undefined;
  sessionRegistry?: SessionRegistry | undefined;
  /** Embedded hosts can keep ownership of their existing recovery lock. */
  manageRecoveryLock?: boolean | undefined;
  /** Test/embedding escape hatch; production defaults to enabled. */
  enableHqTelemetry?: boolean | undefined;
}

export interface StandaloneSessionIdentityLifecycle {
  readonly statusTracker: AgentStatusTracker | undefined;
  activate(sessionId: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Own the cross-surface identity associated with the standalone WebUI's live
 * session writer. Session routes call {@link activate} after swapping writers;
 * shutdown calls {@link stop}. Transitions are serialized and every optional
 * external surface is fail-soft, while identity selection itself stays live.
 */
export async function createStandaloneSessionIdentityLifecycle(
  opts: StandaloneSessionIdentityOptions,
): Promise<StandaloneSessionIdentityLifecycle> {
  const { paths, events, logger } = opts;
  const registry = opts.sessionRegistry ?? getSessionRegistry(paths.globalRoot);
  const fleetNotifier = new FleetNotifier({
    baseDir: paths.globalRoot,
    projectRoot: paths.projectRoot,
    selfPid: process.pid,
  });
  let activeSessionId = opts.initialSessionId;
  let stopped = false;
  let transition = Promise.resolve();

  const statusTracker = new AgentStatusTracker({
    events,
    registry,
    sessionId: () => activeSessionId,
    onUpdate: () => fleetNotifier.notify(),
  });

  const register = async (sessionId: string): Promise<void> => {
    try {
      await registry.register({
        sessionId,
        projectSlug: paths.projectSlug,
        projectRoot: paths.projectRoot,
        projectName: path.basename(paths.projectRoot),
        workingDir: opts.workingDir,
        clientType: 'webui',
        pid: process.pid,
        startedAt: new Date().toISOString(),
        agents: statusTracker.getAgents(),
      });
      fleetNotifier.notify();
    } catch (err) {
      logger.debug?.(`WebUI session registry update failed: ${errorMessage(err)}`);
    }
  };

  await register(activeSessionId);
  statusTracker.start();

  const recoveryLock =
    opts.manageRecoveryLock === false
      ? undefined
      : new RecoveryLock({ dir: paths.projectSessions, sessionStore: opts.sessionStore });
  let ownsRecoveryLock = false;
  if (recoveryLock) {
    try {
      await recoveryLock.write(activeSessionId);
      ownsRecoveryLock = true;
    } catch {
      // Another live surface or an abandoned-session candidate owns active.json.
      // Never replace it blindly; registry tracking remains authoritative.
    }
  }

  let stopHqBridges = (): void => {};
  let closeHqPublisher = (): void => {};
  let restartHqBridges = (_sessionId: string): void => {};
  if (opts.enableHqTelemetry !== false) {
    try {
      const core = await import('@wrongstack/core/hq');
      const publisher = core.createHqPublisherFromEnv({
        clientKind: 'webui',
        projectRoot: paths.projectRoot,
        projectName: path.basename(paths.projectRoot),
        appConfig: opts.config as never as Parameters<
          typeof core.createHqPublisherFromEnv
        >[0]['appConfig'],
        socketFactory: (url: string) =>
          new WebSocket(url) as unknown as import('@wrongstack/core/hq').HqSocketLike,
      });
      if (publisher) {
        publisher.connect();
        closeHqPublisher = () => publisher.close();
        restartHqBridges = (sessionId: string) => {
          stopHqBridges();
          const stops: Array<() => void> = [];
          const add = (start: () => () => void): void => {
            try {
              stops.push(start());
            } catch {
              /* optional bridge */
            }
          };
          add(() =>
            core.startSessionTelemetryBridge({
              publisher,
              events,
              sessionId,
              projectRoot: paths.projectRoot,
              projectName: path.basename(paths.projectRoot),
              globalRoot: paths.globalRoot,
              initialAgents: statusTracker.getAgents(),
              startedAt: new Date().toISOString(),
            }),
          );
          add(() =>
            core.startFleetTelemetryBridge({
              events,
              publisher,
              runId: sessionId,
              sessionId,
            }),
          );
          add(() => core.startBrainTelemetryBridge({ events, publisher, sessionId }));
          add(() => core.startWorktreeTelemetryBridge({ events, publisher, sessionId }));
          add(() =>
            core.startToolTelemetryBridge({
              events,
              publisher,
              projectRoot: paths.projectRoot,
              sessionId,
            }),
          );
          add(() => core.startCostTelemetryBridge({ events, publisher, sessionId }));
          stopHqBridges = () => {
            for (const stop of stops.splice(0)) {
              try {
                stop();
              } catch {
                /* best effort */
              }
            }
          };
        };
        restartHqBridges(activeSessionId);
      }
    } catch (err) {
      logger.debug?.(`WebUI HQ telemetry unavailable: ${errorMessage(err)}`);
    }
  }

  const repointRecovery = async (sessionId: string): Promise<void> => {
    if (!recoveryLock) return;
    try {
      if (ownsRecoveryLock) await recoveryLock.clear();
      await recoveryLock.write(sessionId);
      ownsRecoveryLock = true;
    } catch {
      ownsRecoveryLock = false;
    }
  };

  const activate = async (sessionId: string): Promise<void> => {
    if (stopped || sessionId === activeSessionId) return;
    transition = transition.then(async () => {
      if (stopped || sessionId === activeSessionId) return;
      activeSessionId = sessionId;
      await register(sessionId);
      await repointRecovery(sessionId);
      try {
        restartHqBridges(sessionId);
      } catch (err) {
        logger.debug?.(`WebUI HQ session swap failed: ${errorMessage(err)}`);
      }
    });
    await transition;
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await transition.catch(() => undefined);
    statusTracker.stop();
    stopHqBridges();
    closeHqPublisher();
    fleetNotifier.dispose();
    try {
      await registry.markClosing();
      await registry.unregister();
    } catch {
      /* best effort */
    }
    if (recoveryLock && ownsRecoveryLock) {
      await recoveryLock.clear().catch(() => undefined);
      ownsRecoveryLock = false;
    }
  };

  return { statusTracker, activate, stop };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
