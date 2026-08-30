import { type FormEvent, useEffect, useRef, useState } from 'react';

import { login } from './api';
import { usePharmacyStore } from './store';

export function LoginScreen(): React.JSX.Element {
  const usernameInput = useRef<HTMLInputElement>(null);
  const setSession = usePharmacyStore((state) => state.setSession);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [terminalCode, setTerminalCode] = useState('COUNTER-01');
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
      setSession(await login(username, password, terminalCode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-context" aria-label="System status">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            Rx
          </span>
          <div>
            <strong>PharmacyOS</strong>
            <span>Local counter system</span>
          </div>
        </div>
        <div className="login-message">
          <p className="eyebrow">Counter ready</p>
          <h1>
            Fast at the counter.
            <br />
            Exact in the ledger.
          </h1>
          <p>Sales remain available on the pharmacy network, even when the internet is not.</p>
        </div>
        <dl className="system-strip">
          <div>
            <dt>Database</dt>
            <dd>
              <i className="status-dot" /> Local
            </dd>
          </div>
          <div>
            <dt>Fiscal mode</dt>
            <dd>Configured by owner</dd>
          </div>
          <div>
            <dt>Support</dt>
            <dd>Alt + /</dd>
          </div>
        </dl>
      </section>

      <section className="login-panel">
        <form onSubmit={(event) => void submit(event)}>
          <p className="eyebrow">Staff sign in</p>
          <h2>Open this terminal</h2>
          <label>
            Username
            <input
              ref={usernameInput}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Terminal code
            <input value={terminalCode} onChange={(event) => setTerminalCode(event.target.value)} />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Opening…' : 'Open counter'}
          </button>
          <p className="form-note">Use your own account. Actions are recorded against your name.</p>
        </form>
      </section>
    </main>
  );
}
