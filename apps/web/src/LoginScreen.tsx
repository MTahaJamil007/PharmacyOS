import { CheckCircle2 } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { login } from './api';
import { Alert, Button, Field, Input } from './components/ui';
import { useI18n } from './i18n';
import { usePharmacyStore } from './store';

const TERMINAL_KEY = 'pharmacy-terminal-code';

function rememberedTerminal(): string {
  try {
    return localStorage.getItem(TERMINAL_KEY) ?? 'COUNTER-01';
  } catch {
    return 'COUNTER-01';
  }
}

export function LoginScreen(): React.JSX.Element {
  const usernameInput = useRef<HTMLInputElement>(null);
  const setSession = usePharmacyStore((state) => state.setSession);
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [terminalCode, setTerminalCode] = useState(rememberedTerminal);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    usernameInput.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await login(username.trim(), password, terminalCode.trim());
      try {
        localStorage.setItem(TERMINAL_KEY, terminalCode.trim().toUpperCase());
      } catch {
        // The terminal code is only a convenience for the next sign-in.
      }
      setSession(session);
    } catch (cause) {
      setPassword('');
      setError(
        cause instanceof Error && /credentials|terminal/i.test(cause.message)
          ? 'Username, password, or terminal code is not correct. After several failed attempts the account is locked for a few minutes.'
          : cause instanceof Error
            ? cause.message
            : 'Sign-in failed',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-aside" aria-label="About this system">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            Rx
          </span>
          <strong>{t('app.name')}</strong>
        </div>
        <div>
          <h1>Fast at the counter. Exact in the books.</h1>
          <ul>
            <li>
              <CheckCircle2 aria-hidden /> Sells keep working on the shop network without internet
            </li>
            <li>
              <CheckCircle2 aria-hidden /> First-expiry-first-out batches on every sale
            </li>
            <li>
              <CheckCircle2 aria-hidden /> Every rupee and every tablet traced in the ledger
            </li>
          </ul>
        </div>
        <footer>Sign in with your own account. Every action is recorded against your name.</footer>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <h2>{t('auth.signIn')}</h2>
          <p>Open this terminal with your staff account.</p>
          <div className="form-stack">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label={t('auth.username')}>
              <Input
                ref={usernameInput}
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field label={t('auth.password')}>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label={t('auth.terminal')} hint="Printed on the label of this computer.">
              <Input
                value={terminalCode}
                autoCapitalize="characters"
                onChange={(event) => setTerminalCode(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={busy}
              disabled={!username.trim() || !password || !terminalCode.trim()}
            >
              {busy ? 'Signing in…' : t('auth.signIn')}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
