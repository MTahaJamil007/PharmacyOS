import { NavLink } from 'react-router-dom';

import { logout } from '../api';
import { useLanStatus } from '../hooks/useLanStatus';
import { useI18n } from '../i18n';
import { usePharmacyStore } from '../store';

const navigation = [
  { key: 'nav.counter', to: '/pos' },
  { key: 'nav.cash', to: '/cash' },
  { key: 'nav.customers', to: '/customers' },
  { key: 'nav.inventory', to: '/inventory' },
  { key: 'nav.budget', to: '/budget' },
  { key: 'nav.returns', to: '/returns' },
  { key: 'nav.owner', to: '/owner' },
  { key: 'nav.admin', to: '/admin' },
] as const;

export function AppShell({ children }: { readonly children: React.ReactNode }) {
  const session = usePharmacyStore((state) => state.session);
  const setSession = usePharmacyStore((state) => state.setSession);
  const lan = useLanStatus();
  const { locale, setLocale, t } = useI18n();
  const signOut = (): void => {
    if (session) void logout(session.accessToken).catch(() => undefined);
    setSession(null);
  };
  const statusLabel =
    lan === 'READY'
      ? t('status.ready')
      : lan === 'UNAVAILABLE'
        ? t('status.unavailable')
        : t('status.checking');

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <div className="compact-brand">
          <span className="brand-mark" aria-hidden="true">
            Rx
          </span>
          <strong>{t('app.name')}</strong>
        </div>
        <nav aria-label="Primary navigation">
          {navigation
            .filter(
              (item) =>
                item.to !== '/admin' ||
                Boolean(
                  session?.user.permissions.includes('settings.manage_users') ||
                  session?.user.permissions.includes('settings.manage_system') ||
                  session?.user.permissions.includes('inventory.shelf.manage'),
                ),
            )
            .map((item) => (
              <NavLink key={item.to} to={item.to}>
                {t(item.key)}
              </NavLink>
            ))}
        </nav>
        <div className="operator">
          <span className={`lan-state ${lan.toLowerCase()}`}>
            <i className="status-dot" /> {statusLabel}
          </span>
          <button
            className="locale-toggle"
            onClick={() => setLocale(locale === 'en' ? 'ur' : 'en')}
            aria-label="Change language"
          >
            {locale === 'en' ? 'اردو' : 'English'}
          </button>
          <button onClick={signOut}>
            {session?.user.displayName ?? 'Training user'} · {t('auth.signOut')}
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
