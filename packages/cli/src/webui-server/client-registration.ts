import type { HqClientCapability } from '@wrongstack/core';
import { createWebuiClientPresence } from '@wrongstack/webui-server';
import { createHqCommandDispatcher, type HqCommandController } from '../hq-command-controller.js';
import { startCliHqConnection } from '../hq-publisher.js';

export interface WebuiHqControlHooks {
  interruptLeader: () => boolean;
  allowRunCommand: () => boolean;
  spawnAgent?: HqCommandController['spawnAgent'];
  killFleet?: HqCommandController['killFleet'];
  terminateAgent?: HqCommandController['terminateAgent'];
}

export interface WebuiClientRegistrationDeps {
  projectRoot: string | undefined;
  appConfig: import('@wrongstack/core').Config | undefined;
  events: import('@wrongstack/core').EventBus;
  hqSessionId: string;
  getSessionId: () => string;
  hqControl?: WebuiHqControlHooks | undefined;
}

export interface WebuiClientRegistration {
  register(): Promise<string | null>;
  unregister(): void;
}

export function createWebuiClientRegistration(
  deps: WebuiClientRegistrationDeps,
): WebuiClientRegistration {
  const control = deps.hqControl;
  return createWebuiClientPresence({
    projectRoot: deps.projectRoot,
    appConfig: deps.appConfig,
    events: deps.events,
    hqSessionId: deps.hqSessionId,
    getSessionId: deps.getSessionId,
    startHqConnection: (options) =>
      startCliHqConnection({
        ...options,
        capabilities: options.capabilities as HqClientCapability[],
      }),
    ...(control
      ? {
          createCommandHandler: (mailbox) =>
            createHqCommandDispatcher({
              steerMailbox: mailbox,
              interruptLeader: control.interruptLeader,
              allowRunCommand: control.allowRunCommand,
              sessionTag: deps.getSessionId,
              ...(control.spawnAgent ? { spawnAgent: control.spawnAgent } : {}),
              ...(control.killFleet ? { killFleet: control.killFleet } : {}),
              ...(control.terminateAgent ? { terminateAgent: control.terminateAgent } : {}),
            }),
        }
      : {}),
  });
}
