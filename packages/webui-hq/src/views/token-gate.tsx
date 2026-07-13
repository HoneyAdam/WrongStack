/**
 * Token gate — full-screen token/password entry shown when the HQ server runs
 * in browser-token or password mode and this tab has no (valid) credential.
 *
 * Before this screen existed, a token-less navigation got a bare JSON 401
 * (the shell itself was gated) and a wrong/expired token looked like an
 * endless "reconnecting…". The shell is now served publicly; every byte of
 * telemetry still flows through the gated `/api/*` + `/ws/*` channels.
 *
 * Submitting persists the token to sessionStorage (see `lib/auth.ts`) and
 * reloads so the WS singleton and all views restart authenticated. Password
 * login sets an HttpOnly session cookie on the server; the reload sends it
 * automatically for both HTTP and WebSocket requests.
 */
import { useEffect, useState } from 'react';
import { clearHqToken, setHqToken } from '../lib/auth.js';

interface AuthStatus {
  tokenMode: boolean;
  passwordMode: boolean;
  loggedIn: boolean;
}

export function TokenGate({ hadToken }: { hadToken: boolean }): React.ReactElement {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as AuthStatus;
      })
      .then(setStatus)
      .catch(() => setStatusError('Could not load HQ auth status.'));
  }, []);

  const showToken = status?.tokenMode ?? true;
  const showPassword = status?.passwordMode ?? false;
  const defaultTab = showPassword && !showToken ? 'password' : 'token';
  const [tab, setTab] = useState<'token' | 'password'>(defaultTab);

  if (statusError) {
    return (
      <div className="hq-token-gate">
        <div className="hq-token-card">
          <div className="hq-brand">WrongStack HQ</div>
          <div className="hq-token-title">Auth status unavailable</div>
          <p className="hq-token-text">{statusError}</p>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="hq-token-gate">
        <div className="hq-token-card">
          <div className="hq-brand">WrongStack HQ</div>
          <div className="hq-token-title">Checking auth mode…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="hq-token-gate">
      <div className="hq-token-card">
        <div className="hq-brand">WrongStack HQ</div>
        {showToken && showPassword ? (
          <div className="hq-token-tabs">
            <button
              className={'hq-token-tab' + (tab === 'token' ? ' active' : '')}
              onClick={() => setTab('token')}
            >
              Browser token
            </button>
            <button
              className={'hq-token-tab' + (tab === 'password' ? ' active' : '')}
              onClick={() => setTab('password')}
            >
              Password
            </button>
          </div>
        ) : null}
        {tab === 'token' || !showPassword ? (
          <TokenForm hadToken={hadToken} />
        ) : (
          <PasswordForm />
        )}
      </div>
    </div>
  );
}

function TokenForm({ hadToken }: { hadToken: boolean }): React.ReactElement {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const token = value.trim();
    if (token.length === 0) return;
    setHqToken(token);
    window.location.reload();
  };

  return (
    <>
      <div className="hq-token-title">Browser token required</div>
      <p className="hq-token-text">
        {hadToken
          ? 'The saved token was rejected — it may have been revoked or the server was reset. Paste a current browser token.'
          : 'This HQ server runs in token mode. Paste the browser token printed at startup (the ?token= value in the URL wstack --hq shows).'}
      </p>
      {error ? <p className="hq-token-error">{error}</p> : null}
      <input
        className="hq-token-input"
        type="password"
        placeholder="browser token"
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') submit();
        }}
      />
      <button className="hq-token-submit" onClick={submit} disabled={value.trim().length === 0}>
        Connect
      </button>
      <p className="hq-token-hint">
        Manage tokens with <code>wstack hq token list</code> / <code>wstack hq token create</code>{' '}
        — they live in <code>~/.wrongstack/hq/auth.json</code>.
      </p>
    </>
  );
}

function PasswordForm(): React.ReactElement {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const password = value;
    if (password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        let msg = 'Login failed.';
        try {
          const body = (await res.json()) as { error?: { message?: string } | string };
          const err = body.error;
          if (typeof err === 'string') msg = err;
          else if (typeof err?.message === 'string') msg = err.message;
        } catch {
          /* ignore */
        }
        setError(msg);
        setBusy(false);
        return;
      }
      // Ensure no stale Authorization header overrides the session cookie.
      clearHqToken();
      window.location.reload();
    } catch {
      setError('Network error. Is the HQ server running?');
      setBusy(false);
    }
  };

  return (
    <>
      <div className="hq-token-title">Password required</div>
      <p className="hq-token-text">
        This HQ server is protected by a password. Enter it to open the dashboard.
      </p>
      {error ? <p className="hq-token-error">{error}</p> : null}
      <input
        className="hq-token-input"
        type="password"
        placeholder="password"
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') void submit();
        }}
      />
      <button
        className="hq-token-submit"
        onClick={() => void submit()}
        disabled={value.length === 0 || busy}
      >
        {busy ? 'Logging in…' : 'Log in'}
      </button>
      <p className="hq-token-hint">
        Set or change the password with <code>wstack --hq --password &lt;secret&gt;</code> on first run.
      </p>
    </>
  );
}
