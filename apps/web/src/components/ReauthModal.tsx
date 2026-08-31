import { type FormEvent, useEffect, useRef, useState } from 'react';

import { login } from '../api';
import { useI18n } from '../i18n';
import { usePharmacyStore } from '../store';

export function ReauthModal({ onComplete }: { readonly onComplete: () => void }) {
  const current = usePharmacyStore((state) => state.session);
  const setSession = usePharmacyStore((state) => state.setSession);
  const { t } = useI18n();
  const passwordInput = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState(current?.user.username ?? '');
  const [password, setPassword] = useState('');
  const [terminalCode, setTerminalCode] = useState(current?.user.terminalCode ?? 'COUNTER-01');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => passwordInput.current?.focus(), []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSession(await login(username, password, terminalCode));
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="reauth-dialog"
        role="dialog"
        aria-modal="true"
        onSubmit={(event) => void submit(event)}
      >
        <p className="eyebrow">{t('auth.sessionExpired')}</p>
        <h2>{t('auth.sessionExpired')}</h2>
        <p>{t('auth.reauthenticate')}</p>
        <label>
          {t('auth.username')}
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          {t('auth.password')}
          <input
            ref={passwordInput}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          {t('auth.terminal')}
          <input value={terminalCode} onChange={(event) => setTerminalCode(event.target.value)} />
        </label>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Checking…' : t('auth.continue')}
        </button>
      </form>
    </div>
  );
}
