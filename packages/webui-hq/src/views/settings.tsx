import {
  Copy,
  KeyRound,
  LockKeyhole,
  LogOut,
  RadioTower,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { authorizedFetch, clearHqToken } from '../lib/auth.js';

interface AuthStatus {
  tokenMode: boolean;
  passwordMode: boolean;
  loggedIn: boolean;
  authKind?: 'token' | 'password' | 'open' | undefined;
  publicRelay?: boolean | undefined;
  publicOrigin?: string | undefined;
  secureCookies?: boolean | undefined;
}

interface ApiErrorBody {
  error?: { message?: string } | string | undefined;
}

async function errorMessage(response: Response): Promise<string> {
  const fallback = response.statusText || `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (typeof body.error === 'string') return body.error;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function SettingsView(): React.ReactElement {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const loadStatus = async (): Promise<void> => {
    const response = await authorizedFetch('/api/auth/status');
    if (!response.ok) throw new Error(await errorMessage(response));
    setStatus((await response.json()) as AuthStatus);
  };

  useEffect(() => {
    void loadStatus().catch((error: unknown) => {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    });
  }, []);

  const requiresCurrentPassword = status?.passwordMode === true && status.authKind === 'password';
  const passwordValid = newPassword.length >= 8 && newPassword.length <= 1024;
  const passwordsMatch = newPassword === confirmPassword;
  const canSave =
    passwordValid &&
    passwordsMatch &&
    (!requiresCurrentPassword || currentPassword.length > 0) &&
    !busy;

  const savePassword = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await authorizedFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(requiresCurrentPassword ? { currentPassword } : {}),
          newPassword,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setStatus((await response.json()) as AuthStatus);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage({
        tone: 'ok',
        text: status?.passwordMode ? 'Password changed.' : 'Password enabled.',
      });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const removePassword = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await authorizedFetch('/api/auth/password', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(requiresCurrentPassword ? { currentPassword } : {}) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setStatus((await response.json()) as AuthStatus);
      setCurrentPassword('');
      setConfirmRemove(false);
      setMessage({ tone: 'ok', text: 'Password protection removed.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const logout = async (): Promise<void> => {
    setBusy(true);
    try {
      await authorizedFetch('/api/logout', { method: 'POST' });
    } finally {
      clearHqToken();
      window.location.reload();
    }
  };

  const copyPublicUrl = async (): Promise<void> => {
    if (!status?.publicOrigin || !status.passwordMode) return;
    try {
      await navigator.clipboard.writeText(status.publicOrigin);
      setMessage({ tone: 'ok', text: 'Public tunnel URL copied.' });
    } catch {
      setMessage({ tone: 'error', text: 'Could not copy the public tunnel URL.' });
    }
  };

  return (
    <div className="hq-security-page">
      <section className="hq-security-summary" aria-label="Authentication status">
        <div className="hq-security-card">
          <ShieldCheck size={18} />
          <span>Browser access</span>
          <strong>{status?.loggedIn ? 'Authenticated' : 'Checking…'}</strong>
        </div>
        <div className="hq-security-card">
          <KeyRound size={18} />
          <span>Browser tokens</span>
          <strong>{status?.tokenMode ? 'Enabled' : 'Disabled'}</strong>
        </div>
        <div className="hq-security-card">
          <LockKeyhole size={18} />
          <span>Password login</span>
          <strong>{status?.passwordMode ? 'Enabled' : 'Disabled'}</strong>
        </div>
        <div className="hq-security-card">
          <RadioTower size={18} />
          <span>Public tunnel</span>
          <strong>{status?.publicRelay ? 'Active' : 'Disabled'}</strong>
          {status?.publicOrigin && status.passwordMode ? (
            <button
              type="button"
              className="hq-security-copy"
              aria-label="Copy public tunnel URL"
              title={status.publicOrigin}
              onClick={() => void copyPublicUrl()}
            >
              <Copy size={12} />
              Copy URL
            </button>
          ) : null}
        </div>
      </section>

      <section className="hq-security-panel">
        <div className="hq-security-panel-head">
          <div>
            <span>Browser credential</span>
            <h2>{status?.passwordMode ? 'Change HQ password' : 'Enable HQ password'}</h2>
            <p>
              Passwords are stored as salted scrypt hashes. Changing the password invalidates older
              password sessions.
            </p>
          </div>
          <LockKeyhole size={22} />
        </div>

        {message ? (
          <div className="hq-security-message" data-tone={message.tone} role="status">
            {message.text}
          </div>
        ) : null}

        <div className="hq-security-form">
          {requiresCurrentPassword ? (
            <label>
              <span>Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={1024}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <small>Minimum 8 characters.</small>
          </label>
          <label>
            <span>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={1024}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void savePassword();
              }}
            />
            {confirmPassword && !passwordsMatch ? (
              <small data-error>Passwords do not match.</small>
            ) : null}
          </label>
          <div className="hq-security-actions">
            <button
              type="button"
              className="hq-btn"
              disabled={!canSave}
              onClick={() => void savePassword()}
            >
              <ShieldCheck size={14} />
              {busy ? 'Saving…' : status?.passwordMode ? 'Change password' : 'Enable password'}
            </button>
          </div>
        </div>
      </section>

      <section className="hq-security-panel danger-zone">
        <div className="hq-security-panel-head">
          <div>
            <span>Session and recovery</span>
            <h2>Access controls</h2>
            <p>
              Browser tokens remain available as a recovery path. Public tunnel mode will refuse to
              remove the last browser authentication method.
            </p>
          </div>
          <ShieldOff size={22} />
        </div>
        <div className="hq-security-actions split">
          <button
            type="button"
            className="hq-btn secondary"
            disabled={busy}
            onClick={() => void logout()}
          >
            <LogOut size={14} />
            Log out this browser
          </button>
          {status?.passwordMode ? (
            confirmRemove ? (
              <div className="hq-security-confirm-remove">
                <span>Remove password protection?</span>
                <button
                  type="button"
                  className="hq-btn secondary"
                  disabled={busy}
                  onClick={() => setConfirmRemove(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="hq-btn danger"
                  disabled={busy || (requiresCurrentPassword && !currentPassword)}
                  onClick={() => void removePassword()}
                >
                  Remove password
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="hq-btn danger"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                <ShieldOff size={14} />
                Remove password
              </button>
            )
          ) : null}
        </div>
      </section>
    </div>
  );
}
