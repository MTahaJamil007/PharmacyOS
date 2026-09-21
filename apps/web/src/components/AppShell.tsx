import { PERMISSIONS } from '@pharmacy/shared';
import { NavLink } from 'react-router-dom';

import { logout } from '../api';
import { useLanStatus } from '../hooks/useLanStatus';
import { useI18n } from '../i18n';
import { usePharmacyStore } from '../store';

/**
 * A destination is shown only when the session actually carries a permission it
 * needs; otherwise the operator reaches a screen that can only answer 403.
 */
const navigation = [
  { key: 'nav.counter', permissions: [PERMISSIONS.POS_SEARCH], to: '/pos' },
  {
    key: 'nav.cash',
    permissions: [PERMISSIONS.CASH_OPEN_SESSION, PERMISSIONS.CASH_CLOSE_SESSION],
    to: '/cash',
  },
  { key: 'nav.customers', permissions: [PERMISSIONS.CUSTOMER_READ], to: '/customers' },
  {
    key: 'nav.inventory',
    permissions: [
      PERMISSIONS.INVENTORY_ADJUST,
      PERMISSIONS.INVENTORY_EXPIRY_READ,
      PERMISSIONS.INVENTORY_SHELF_READ,
    ],
    to: '/inventory',
  },
  { key: 'nav.purchasing', permissions: [PERMISSIONS.INVENTORY_PURCHASE], to: '/purchasing' },
  {
    key: 'nav.budget',
    permissions: [PERMISSIONS.SALES_BUDGET_REGIMEN_CALCULATE],
    to: '/budget',
  },
  {
    key: 'nav.returns',
    permissions: [PERMISSIONS.RETURNS_LOOKUP, PERMISSIONS.RETURNS_REQUEST],
    to: '/returns',
  },
  {
    key: 'nav.reports',
    permissions: [PERMISSIONS.REPORTS_VIEW_BASIC, PERMISSIONS.REPORTS_VIEW_FINANCIAL],
    to: '/reports',
  },
  { key: 'nav.owner', permissions: [PERMISSIONS.REPORTS_VIEW_FINANCIAL], to: '/owner' },
  {
    key: 'nav.operations',
    permissions: [
      PERMISSIONS.FBR_VIEW_STATUS,
      PERMISSIONS.BACKUP_RESTORE,
      PERMISSIONS.AI_AUDIT_READ,
    ],
    to: '/operations',
  },
  {
    key: 'nav.admin',
    permissions: [
      PERMISSIONS.SETTINGS_MANAGE_USERS,
      PERMISSIONS.SETTINGS_MANAGE_SYSTEM,
      PERMISSIONS.INVENTORY_SHELF_MANAGE,
    ],
    to: '/admin',
  },
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
                !session ||
                item.permissions.some((permission) =>
                  session.user.permissions.includes(permission),
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
