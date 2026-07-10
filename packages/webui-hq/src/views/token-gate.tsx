/**
 * Token gate — full-screen token entry shown when the HQ server runs in
 * browser-token mode and this tab has no (valid) token.
 *
 * Before this screen existed, a token-less navigation got a bare JSON 401
 * (the shell itself was gated) and a wrong/expired token looked like an
 * endless "reconnecting…". The shell is now served publicly; every byte of
 * telemetry still flows through the token-gated `/api/*` + `/ws/*` channels.
 *
 * Submitting persists the token to sessionStorage (see `lib/auth.ts`) and
 * reloads so the WS singleton and all views restart authenticated.
 */
import { useState } from 'react';
import { setHqToken } from '../lib/auth.js';

export function TokenGate({ hadToken }: { hadToken: boolean }): React.ReactElement {
  const [value, setValue] = useState('');

  const submit = (): void => {
    const token = value.trim();
    if (token.length === 0) return;
    setHqToken(token);
    window.location.reload();
  };

  return (
    <div className="hq-token-gate">
      <div className="hq-token-card">
        <div className="hq-brand">WrongStack HQ</div>
        <div className="hq-token-title">Browser token required</div>
        <p className="hq-token-text">
          {hadToken
            ? 'The saved token was rejected — it may have been revoked or the server was reset. Paste a current browser token.'
            : 'This HQ server runs in token mode. Paste the browser token printed at startup (the ?token= value in the URL wstack --hq shows).'}
        </p>
        <input
          className="hq-token-input"
          type="password"
          autoFocus
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
      </div>
    </div>
  );
}
