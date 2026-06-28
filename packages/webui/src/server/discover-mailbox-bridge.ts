import { resolveProjectDir, wstackGlobalRoot } from '@wrongstack/core';
import { readLiveLock } from '@wrongstack/core/coordination';

export interface MailboxBridgeParams {
  projectRoot: string;
  config: { features?: { mailboxBridge?: 'auto' | 'off' | undefined } } | undefined;
  logger: {
    debug: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
  };
  ctx: { meta: Record<string, unknown> };
}

/**
 * Attempt to discover and join a running mailbox bridge server.
 *
 * Checks the project's live-lock file for an active bridge instance.
 * When found, stores the bridge URL and token in ctx.meta so the
 * backend services can use it. When absent or unhealthy, logs a
 * message and continues without external-agent connectivity.
 */
export async function discoverMailboxBridgeForWebui(params: MailboxBridgeParams): Promise<void> {
  const mode = params.config?.features?.mailboxBridge ?? 'auto';
  if (mode === 'off') return;

  const projectDir = resolveProjectDir(params.projectRoot, wstackGlobalRoot());
  const result = await readLiveLock(projectDir);
  switch (result.kind) {
    case 'live': {
      params.logger.debug('webui joined existing mailbox bridge', {
        url: result.lock.url,
        lockPath: projectDir,
      });
      params.ctx.meta['mailboxBridge'] = {
        url: result.lock.url,
        token: result.lock.token,
        lockPath: projectDir,
        childPid: null,
        source: 'joined',
      };
      break;
    }
    case 'probe-failed': {
      params.logger.warn(
        'mailbox bridge present but /healthz unreachable; webui will start without external-agent connectivity',
        { url: result.lock.url, lockPath: projectDir },
      );
      params.ctx.meta['mailboxBridge'] = {
        url: result.lock.url,
        token: result.lock.token,
        lockPath: projectDir,
        childPid: null,
        source: 'unhealthy',
      };
      break;
    }
    case 'absent': {
      params.logger.info(
        'no mailbox bridge running; webui will start without external-agent connectivity. Run `wstack mailbox serve` or a CLI surface to bring one up.',
        { projectDir },
      );
      break;
    }
  }
}
