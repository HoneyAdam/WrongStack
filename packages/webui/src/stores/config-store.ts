import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// Config Store
// ============================================

export interface ConfigState {
  provider: string;
  model: string;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  wsUrl: string;
  wsConnected: boolean;
  /** Fine-grained connection state from the WS client. Drives the topbar's
   *  reconnect indicator. */
  wsStatus:
    | { state: 'connecting' }
    | { state: 'open' }
    | { state: 'closed'; error?: string | undefined }
    | { state: 'reconnecting'; attempt: number; nextRetryAt: number; lastError?: string | undefined };
  theme: 'light' | 'dark' | 'system';
  autoConnect: boolean;
  /** Play a soft synthesized chime when run.result lands with status=done.
   *  Off by default — opt-in via the Command Palette. Persisted so the
   *  preference survives reloads. Actual playback only fires after the
   *  user has interacted with the page (Web Audio autoplay policy). */
  soundOnComplete: boolean;

  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setConfig: (
    config: Partial<Omit<ConfigState, 'setProvider' | 'setModel' | 'setConfig' | 'setTheme'>>,
  ) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setWsConnected: (connected: boolean) => void;
  setWsStatus: (s: ConfigState['wsStatus']) => void;
  setSoundOnComplete: (on: boolean) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      wsUrl: (() => {
        if (typeof window === 'undefined' || !window.location?.hostname) {
          return 'ws://127.0.0.1:3457';
        }
        const h = window.location.hostname.toLowerCase();
        if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') {
          return 'ws://127.0.0.1:3457';
        }
        return `ws://${window.location.hostname}:3457`;
      })(),
      wsConnected: false,
      wsStatus: { state: 'connecting' },
      theme: 'system',
      autoConnect: true,
      soundOnComplete: false,
      setProvider: (provider) => set({ provider }),
      setModel: (model) => set({ model }),
      setConfig: (config) => set(config),
      setTheme: (theme) => set({ theme }),
      setWsConnected: (connected) => set({ wsConnected: connected }),
      setWsStatus: (wsStatus) => set({ wsStatus, wsConnected: wsStatus.state === 'open' }),
      setSoundOnComplete: (on) => set({ soundOnComplete: on }),
    }),
    {
      name: 'wrongstack-config',
    },
  ),
);
