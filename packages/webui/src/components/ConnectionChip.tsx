import { cn } from '@/lib/utils';
import { getWSClient } from '@/lib/ws-client';
import type { WsStatus } from '@/lib/ws-client';
import { useConfigStore } from '@/stores';
import { Loader2, RotateCcw, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  wsStatus: WsStatus;
  wsConnected: boolean;
}

/**
 * Tiny status pill for the topbar. Renders four distinct visual states:
 *
 *   • open          — solid green Wi-Fi
 *   • connecting    — pulsing yellow spinner
 *   • reconnecting  — orange, attempt counter + live retry countdown,
 *                     click to retry immediately
 *   • closed        — red Wi-Fi-off, click to retry, tooltip shows error
 *
 * The countdown ticks live (every 500ms while `nextRetryAt` is in the
 * future) without forcing the whole topbar to re-render — we only re-run
 * the local timer effect.
 */
export function ConnectionChip({ wsStatus, wsConnected }: Props) {
  const wsUrl = useConfigStore((s) => s.wsUrl);
  const [now, setNow] = useState(Date.now());

  // Keep a live clock running only while we're between retries, otherwise
  // we'd burn one render every 500ms in a happy-path session.
  useEffect(() => {
    if (wsStatus.state !== 'reconnecting') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [wsStatus.state]);

  const retry = () => getWSClient(wsUrl).retryNow();

  if (wsStatus.state === 'open' && wsConnected) {
    return (
      <div
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 bg-green-500/10 text-green-600 dark:text-green-400"
        title="Backend connected"
      >
        <Wifi className="h-3 w-3" />
      </div>
    );
  }

  if (wsStatus.state === 'connecting') {
    return (
      <div
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
        title="Connecting to backend"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>connecting</span>
      </div>
    );
  }

  if (wsStatus.state === 'reconnecting') {
    const remaining = Math.max(0, Math.ceil((wsStatus.nextRetryAt - now) / 1000));
    return (
      <button
        type="button"
        onClick={retry}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium shrink-0',
          'bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20',
          'transition-colors',
        )}
        title={
          wsStatus.lastError
            ? `Reconnecting — last error: ${wsStatus.lastError}. Click to retry now.`
            : 'Reconnecting — click to retry now.'
        }
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>
          retry #{wsStatus.attempt} in {remaining}s
        </span>
      </button>
    );
  }

  // closed
  return (
    <button
      type="button"
      onClick={retry}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors"
      title={
        wsStatus.state === 'closed' && wsStatus.error
          ? `Disconnected: ${wsStatus.error}. Click to retry.`
          : 'Disconnected. Click to retry.'
      }
    >
      <WifiOff className="h-3 w-3" />
      <span className="flex items-center gap-0.5">
        offline
        <RotateCcw className="h-3 w-3 opacity-70" />
      </span>
    </button>
  );
}
