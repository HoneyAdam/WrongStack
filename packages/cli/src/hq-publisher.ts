import {
  createHqPublisherFromEnv,
  resolveHqConfig,
  type CreateHqPublisherOptions,
  type HqPublisher,
  type HqSocketLike,
} from '@wrongstack/core';
import { WebSocket } from 'ws';

type CliHqPublisherOptions = Omit<CreateHqPublisherOptions, 'socketFactory'> & {
  socketFactory?: CreateHqPublisherOptions['socketFactory'];
};

export interface CliHqConnection {
  getPublisher(): HqPublisher | undefined;
  stop(): void;
}

export interface CliHqConnectionOptions extends CliHqPublisherOptions {
  onConnect?: ((publisher: HqPublisher) => void) | undefined;
  retryIntervalMs?: number | undefined;
}

function nodeWsSocketFactory(url: string): HqSocketLike {
  return new WebSocket(url) as unknown as HqSocketLike;
}

export function createCliHqPublisher(options: CliHqPublisherOptions): HqPublisher | undefined {
  return createHqPublisherFromEnv({
    ...options,
    socketFactory: options.socketFactory ?? nodeWsSocketFactory,
  });
}

function hqExplicitlyDisabled(options: CliHqPublisherOptions): boolean {
  const envEnabled = process.env['WRONGSTACK_HQ_ENABLED']?.trim();
  if (envEnabled !== undefined && envEnabled.length > 0) return envEnabled === '0';
  if (options.config?.enabled !== undefined) return options.config.enabled === false;
  return options.appConfig?.hq?.enabled === false;
}

function resolvedHqConnectionKey(options: CliHqPublisherOptions): string | undefined {
  if (options.config !== undefined) {
    return options.config.enabled === false
      ? undefined
      : `${options.config.url}\n${options.config.token ?? ''}`;
  }
  const config = resolveHqConfig({ config: options.appConfig?.hq });
  return config === undefined ? undefined : `${config.url}\n${config.token ?? ''}`;
}

export function startCliHqConnection(options: CliHqConnectionOptions): CliHqConnection {
  let publisher: HqPublisher | undefined;
  let publisherKey: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tryConnect = (): void => {
    const nextKey = resolvedHqConnectionKey(options);
    if (nextKey === undefined) return;
    if (publisher !== undefined && publisherKey === nextKey) return;

    publisher?.close();
    publisher = undefined;
    publisherKey = undefined;

    const next = createCliHqPublisher(options);
    if (next === undefined) return;
    publisher = next;
    publisherKey = nextKey;
    next.connect();
    options.onConnect?.(next);
  };

  tryConnect();
  if (!hqExplicitlyDisabled(options)) {
    timer = setInterval(tryConnect, options.retryIntervalMs ?? 2_500);
    timer.unref?.();
  }

  return {
    getPublisher: () => publisher,
    stop: () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      publisher?.close();
      publisher = undefined;
      publisherKey = undefined;
    },
  };
}
