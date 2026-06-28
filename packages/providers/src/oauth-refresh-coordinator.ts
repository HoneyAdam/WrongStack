/**
 * OAuthRefreshCoordinator — shared refresh state + single-flight machinery
 * for OAuth providers.
 *
 * All three OAuth providers in this package (`openai-codex`, `anthropic-oauth`,
 * `github-copilot`) implemented the same pattern by hand:
 *   1. Hold a refresh token, expiry, and `refreshFn` callable
 *   2. Wrap the refresh call in `createSingleFlightRefresh` so concurrent
 *      requests share one upstream call + one persistence callback
 *   3. Re-check the expiry before each request, refresh on 401
 *
 * The refresh-token storage LOCATION differs (Codex rotates its refresh
 * token on every refresh; Anthropic + Copilot do not), and the `onRefresh`
 * payload shape differs (Codex includes `accountId`), so this is a
 * composition helper, not a base class — each provider wires it up with
 * two callbacks that describe the host-specific pieces.
 *
 * Why composition instead of inheritance: the three providers extend
 * different base classes (`WireAdapter` for codex, `WireFormatProvider`
 * for the other two), so a shared base class would compete with
 * existing inheritance. Composition also keeps each provider's token
 * fields (`this.access`, `this.refresh`, `this.expiresAt`, …) where the
 * build headers/body methods can read them directly — moving the state
 * into a mixin would force every read site to go through getters.
 */

import { createSingleFlightRefresh } from './oauth-refresh.js';

/** Default skew applied to expiry checks — refresh this many ms before stated expiry. */
export const DEFAULT_REFRESH_SKEW_MS = 60_000;

export interface OAuthRefreshCoordinatorOptions<TTokens, TPayload> {
  /**
   * Initial refresh key — the value passed to `refreshFn` to mint a new
   * token pair. Most providers pass this from constructor credentials.
   * May be `undefined` for providers that mint the first token without a
   * refresh (e.g. Copilot starts with an empty copilot token and mints on
   * first request).
   */
  initialRefreshKey: string | undefined;
  /** Initial expiry in epoch ms. `undefined` means "refresh on every request". */
  initialExpiresAt: number | undefined;
  /** The upstream refresh call. */
  refreshFn: (refreshKey: string, signal?: AbortSignal) => Promise<TTokens>;
  /**
   * Persistence callback. Fires once per actual refresh (single-flighted),
   * with the host-shaped payload derived from the new tokens.
   */
  onRefresh?: ((payload: TPayload) => void) | undefined;
  /** Map the upstream's token shape into the host's payload shape. */
  formatPayload: (
    tokens: TTokens,
    derived: { accessToken: string; expiresAt: number; refreshKey?: string | undefined },
  ) => TPayload;
  /**
   * Project the upstream tokens into the access token + expiry pair this
   * coordinator tracks. `refreshKey` is only returned if the host rotates
   * it (Codex does; Anthropic + Copilot return the same key).
   */
  projectTokens: (tokens: TTokens) => {
    accessToken: string;
    expiresAt: number;
    refreshKey?: string | undefined;
  };
  /** Apply the projected values back to the host's mutable state. */
  applyTokens: (derived: {
    accessToken: string;
    expiresAt: number;
    refreshKey?: string | undefined;
  }) => void;
  /** How many ms before stated expiry we should proactively refresh. */
  refreshSkewMs?: number;
  /**
   * Human-readable label used in error messages when the refresh key is
   * missing — e.g. "Codex OAuth", "Anthropic OAuth", "GitHub Copilot".
   */
  label: string;
}

export class OAuthRefreshCoordinator<TTokens, TPayload> {
  /** Single-flight wrapper around the refresh call. */
  private readonly singleFlight: ReturnType<typeof createSingleFlightRefresh<TTokens>>;
  private readonly refreshFn: OAuthRefreshCoordinatorOptions<TTokens, TPayload>['refreshFn'];
  private readonly onRefresh: OAuthRefreshCoordinatorOptions<TTokens, TPayload>['onRefresh'];
  private readonly formatPayload: OAuthRefreshCoordinatorOptions<TTokens, TPayload>['formatPayload'];
  private readonly projectTokens: OAuthRefreshCoordinatorOptions<TTokens, TPayload>['projectTokens'];
  private readonly applyTokens: OAuthRefreshCoordinatorOptions<TTokens, TPayload>['applyTokens'];
  private readonly refreshSkewMs: number;
  private readonly label: string;

  /** Host-supplied function returning the CURRENT refresh key (may rotate). */
  private readonly getRefreshKey: () => string | undefined;

  /** Last refreshed expiry, in epoch ms. */
  private expiresAt: number | undefined;

  constructor(opts: OAuthRefreshCoordinatorOptions<TTokens, TPayload>) {
    this.refreshFn = opts.refreshFn;
    this.onRefresh = opts.onRefresh;
    this.formatPayload = opts.formatPayload;
    this.projectTokens = opts.projectTokens;
    this.applyTokens = opts.applyTokens;
    this.refreshSkewMs = opts.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
    this.label = opts.label;
    this.expiresAt = opts.initialExpiresAt;
    this.getRefreshKey = () => opts.initialRefreshKey;
    // We capture the single-flight work function in a closure that re-reads
    // `getRefreshKey()` on every invocation. That way a host that rotates
    // its refresh token mid-flight picks up the latest value when the
    // single-flight slot opens — the concurrent callers all share one
    // refresh, and that refresh uses the most-recent key the host has.
    this.singleFlight = createSingleFlightRefresh<TTokens>((signal) => this.performRefresh(signal));
  }

  /**
   * Update the cached expiry when the host pre-loads a token from
   * persistent storage. Used by the constructor's initial-state path
   * for providers that store their own expiry separately.
   */
  setExpiresAt(expiresAt: number | undefined): void {
    this.expiresAt = expiresAt;
  }

  /**
   * Returns true when the token is known-stale or never-seen (no expiry
   * recorded). Callers should refresh before the next request.
   */
  isStale(): boolean {
    if (this.expiresAt === undefined) return true;
    return Date.now() >= this.expiresAt - this.refreshSkewMs;
  }

  /**
   * No-op if a refresh key is unavailable, the cached expiry is still
   * fresh, OR a refresh is already in flight (which will mutate the
   * expiry once it resolves). Otherwise, kicks off a refresh.
   */
  async ensureFreshToken(signal: AbortSignal): Promise<void> {
    if (!this.getRefreshKey()) return;
    if (!this.isStale()) return;
    await this.doRefresh(signal);
  }

  /**
   * Force a refresh. Returns immediately if no refresh key is available;
   * otherwise coalesces with any in-flight refresh so concurrent callers
   * share one upstream call.
   */
  async doRefresh(signal: AbortSignal): Promise<void> {
    if (!this.getRefreshKey()) return;
    await this.singleFlight.refresh(signal);
  }

  /**
   * The single-flighted work function: call the upstream, mutate host
   * state, fire the persistence callback. Concurrent callers share one
   * execution — upstream hit once, host state mutates once, `onRefresh`
   * fires once per actual refresh. Always go through `singleFlight` so
   * `runRefresh` calls participate in the same single-flight slot as
   * `doRefresh` / `ensureFreshToken` (otherwise direct callers would race
   * past the coalescing and the upstream would be hit twice).
   */
  runRefresh(signal?: AbortSignal): Promise<TTokens> {
    return this.singleFlight.refresh(signal);
  }

  /**
   * Internal: the actual work performed inside the single-flight slot.
   * Always called via `singleFlight.refresh()` so concurrent callers share
   * one execution. Exposed as a method (not a closure) so the per-host
   * error message (`${this.label}: refresh key missing`) reads `this`.
   */
  private async performRefresh(signal?: AbortSignal): Promise<TTokens> {
    const refreshKey = this.getRefreshKey();
    if (!refreshKey) {
      throw new Error(`${this.label}: refresh key missing`);
    }
    const tokens = await this.refreshFn(refreshKey, signal);
    const derived = this.projectTokens(tokens);
    this.expiresAt = derived.expiresAt;
    this.applyTokens(derived);
    this.onRefresh?.(this.formatPayload(tokens, derived));
    return tokens;
  }
}