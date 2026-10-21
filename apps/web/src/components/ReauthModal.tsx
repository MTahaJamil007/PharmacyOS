import { type FormEvent, useRef, useState } from 'react';

import { login } from '../api';
import { useI18n } from '../i18n';
import { usePharmacyStore } from '../store';
import { Alert, Button, Dialog, Field, Input } from './ui';

/**
 * Shown when the server ends the session (idle timeout, password change, role change). The
 * counter state stays in place underneath, so signing in again continues the same sale.
 */
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

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
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
    <Dialog
      title={t('auth.sessionExpired')}
      description={t('auth.reauthenticate')}
      size="sm"
      initialFocus={passwordInput}
      onClose={() => setSession(null)}
      closeLabel={t('auth.signOut')}
      footer={
        <>
          <Button onClick={() => setSession(null)}>{t('auth.signOut')}</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {t('auth.continue')}
          </Button>
        </>
      }
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t('auth.username')}>
          <Input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field label={t('auth.password')}>
          <Input
            ref={passwordInput}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label={t('auth.terminal')}>
          <Input value={terminalCode} onChange={(event) => setTerminalCode(event.target.value)} />
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
