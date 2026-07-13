/**
 * WebUI client registration — presence + HQ telemetry for the CLI bridge.
 *
 * Registers the WebUI instance as a client in the project's global mailbox so
 * other TUIs, WebUIs, and REPLs on the same project can see it as "online",
 * starts the HQ connection (with the session-telemetry bridge attached on
 * connect), and heartbeats more frequently than agents do (15s vs 30s).
 *
 * PR 10 of Issue #30: extracted from `webui-server.ts`.
 */
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { Config, EventBus, HqClientCapability } from '@wrongstack/core';
import { GlobalMailbox, resolveProjectDir, wstackGlobalRoot } from '@wrongstack/core';
import { createHqCommandDispatcher, type HqCommandController } from '../hq-command-controller.js';
import { startCliHqConnection, type CliHqConnection } from '../hq-publisher.js';

const CLIENT_HEARTBEAT_MS = 15_000;

/**
 * The control hooks the WebUI can offer HQ. When present, the WebUI client
 * advertises `control.receive` and dispatches HQ commands (steer/btw/queue/
 * broadcast via its mailbox, abort via the run controller) exactly like the
 * CLI/TUI — so two-way control works for the WebUI client too, not just
 * terminal surfaces. Omitted → telemetry-only (the previous behaviour).
 */
export interface WebuiHqControlHooks {
  /** Abort the WebUI's active agent run. Returns true if a run was aborted. */
  interruptLeader: () => boolean;
  /** Whether raw shell execution is explicitly opted-in by the operator. */
  allowRunCommand: () => boolean;
  /** Optional: spawn a role subagent. */
  spawnAgent?: HqCommandController['spawnAgent'];
  /** Optional: stop the entire fleet. */
  killFleet?: HqCommandController['killFleet'];
  /** Optional: terminate one subagent by id. */
  terminateAgent?: HqCommandController['terminateAgent'];
}

export interface WebuiClientRegistrationDeps {
  projectRoot: string | undefined;
  /** Full app config, used for HQ client publishing settings. */
  appConfig: Config | undefined;
  events: EventBus;
  /** Stable session id recorded in HQ telemetry (the writer at startup). */
  hqSessionId: string;
  /** Live session id — session.resume swaps it, so it is read per heartbeat. */
  getSessionId: () => string;
  /** When provided, the WebUI becomes HQ-controllable (two-way control). */
  hqControl?: WebuiHqControlHooks | undefined;
}

export interface WebuiClientRegistration {
  /** Fire-and-forget registration; resolves to the client id (or null). */
  register(): Promise<string | null>;
  /** Stop heartbeats and tear down the HQ connection/telemetry bridge. */
  unregister(): void;
}

export function createWebuiClientRegistration(
  deps: WebuiClientRegistrationDeps,
): WebuiClientRegistration {
  let webuiClientId: string | null = null;
  let webuiMailbox: GlobalMailbox | undefined;
  let webuiHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let stopWebuiHqBridge: (() => void) | undefined;
  let webuiHqConnection: CliHqConnection | undefined;

  const register = async (): Promise<string | null> => {
    if (!deps.projectRoot) return null;
    try {
      const projectRoot = deps.projectRoot;
      const projectDir = resolveProjectDir(projectRoot, wstackGlobalRoot());
      // Build the mailbox BEFORE the HQ connection so the command controller
      // (which delivers steer/broadcast through it) can be wired into the
      // connection's onCommand handler. The publisher getter is lazy, so the
      // forward reference to `webuiHqConnection` is safe.
      const mailbox = new GlobalMailbox(projectDir, deps.events, () =>
        webuiHqConnection?.getPublisher(),
      );
      webuiMailbox = mailbox;

      // Two-way control: when the host supplied control hooks, advertise
      // `control.receive` and dispatch HQ commands through the same
      // controller the CLI/TUI use (steer/btw/queue/broadcast via mailbox,
      // abort via the run controller). Without hooks the WebUI stays
      // telemetry-only.
      const hqControl = deps.hqControl;
      const capabilities: HqClientCapability[] = [
        'telemetry.publish',
        'mailbox.summary',
        'fleet.summary',
        'session.summary',
      ];
      let onCommand: ReturnType<typeof createHqCommandDispatcher> | undefined;
      if (hqControl !== undefined) {
        capabilities.push('control.receive');
        const controller: HqCommandController = {
          steerMailbox: mailbox,
          interruptLeader: hqControl.interruptLeader,
          allowRunCommand: hqControl.allowRunCommand,
          sessionTag: () => deps.getSessionId(),
          ...(hqControl.spawnAgent !== undefined ? { spawnAgent: hqControl.spawnAgent } : {}),
          ...(hqControl.killFleet !== undefined ? { killFleet: hqControl.killFleet } : {}),
          ...(hqControl.terminateAgent !== undefined
            ? { terminateAgent: hqControl.terminateAgent }
            : {}),
        };
        onCommand = createHqCommandDispatcher(controller);
      }

      webuiHqConnection = startCliHqConnection({
        clientKind: 'webui',
        projectRoot,
        projectName: path.basename(projectRoot),
        appConfig: deps.appConfig,
        capabilities,
        ...(onCommand !== undefined ? { onCommand } : {}),
        onConnect: (publisher) => {
          stopWebuiHqBridge?.();
          stopWebuiHqBridge = undefined;
          void import('@wrongstack/core')
            .then(({ startSessionTelemetryBridge }) => {
              stopWebuiHqBridge = startSessionTelemetryBridge({
                publisher,
                events: deps.events,
                sessionId: deps.hqSessionId,
                projectRoot,
                projectName: path.basename(projectRoot),
                startedAt: new Date().toISOString(),
              });
            })
            .catch(() => {
              // telemetry optional
            });
        },
      });
      webuiClientId = `webui@${crypto.randomUUID().slice(0, 8)}`;
      const projectName = path.basename(projectRoot);
      await mailbox.registerClient({
        clientId: webuiClientId,
        sessionId: deps.getSessionId(),
        name: `WebUI [${projectName}]`,
        source: 'webui',
        pid: process.pid,
      });

      webuiHeartbeatTimer = setInterval(() => {
        mailbox
          .clientHeartbeat({
            clientId: webuiClientId!,
            sessionId: deps.getSessionId(),
          })
          .catch(() => {
            // best-effort — ignore heartbeat failures during shutdown
          });
      }, CLIENT_HEARTBEAT_MS);
      webuiHeartbeatTimer.unref();

      return webuiClientId;
    } catch {
      // best-effort — client registration errors should not block WebUI startup
      return null;
    }
  };

  const unregister = (): void => {
    if (webuiHeartbeatTimer) {
      clearInterval(webuiHeartbeatTimer);
      webuiHeartbeatTimer = null;
    }
    if (stopWebuiHqBridge) {
      stopWebuiHqBridge();
      stopWebuiHqBridge = undefined;
    }
    webuiHqConnection?.stop();
    webuiHqConnection = undefined;
    const clientId = webuiClientId;
    webuiClientId = null;
    const mailbox = webuiMailbox;
    webuiMailbox = undefined;
    if (mailbox && clientId) void mailbox.deregisterClient(clientId).catch(() => undefined);
  };

  return { register, unregister };
}
