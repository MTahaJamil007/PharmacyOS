import { PERMISSIONS } from '@pharmacy/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Calculator,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  Languages,
  LayoutDashboard,
  LogOut,
  Monitor,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Undo2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { changeOwnPassword, getCurrentCashSession, logout } from '../api';
import { formatMoney, initials } from '../format';
import { useLanStatus } from '../hooks/useLanStatus';
import { usePermissions, useSession } from '../hooks/useSession';
import { useI18n, type MessageKey } from '../i18n';
import { usePharmacyStore } from '../store';
import { Button, Dialog, ErrorAlert, Field, Input, useDismiss, useToast } from './ui';

interface NavItem {
  readonly key: MessageKey;
  readonly to: string;
  readonly icon: LucideIcon;
  readonly permissions: readonly string[];
}

interface NavGroup {
  readonly key: MessageKey;
  readonly items: readonly NavItem[];
}

/**
 * A destination appears only when the session carries a permission it needs, so nobody is
 * sent to a screen that can only answer "not allowed".
 */
export const NAVIGATION: readonly NavGroup[] = [
  {
    key: 'group.sell',
    items: [
      { icon: ShoppingCart, key: 'nav.counter', permissions: [PERMISSIONS.POS_SEARCH], to: '/pos' },
      {
        icon: Undo2,
        key: 'nav.returns',
        permissions: [
          PERMISSIONS.RETURNS_LOOKUP,
          PERMISSIONS.RETURNS_REQUEST,
          PERMISSIONS.RETURNS_APPROVE,
          PERMISSIONS.RETURNS_REFUND,
        ],
        to: '/returns',
      },
      {
        icon: Users,
        key: 'nav.customers',
        permissions: [PERMISSIONS.CUSTOMER_READ],
        to: '/customers',
      },
      {
        icon: Calculator,
        key: 'nav.budget',
        permissions: [PERMISSIONS.SALES_BUDGET_REGIMEN_CALCULATE],
        to: '/budget',
      },
    ],
  },
  {
    key: 'group.stock',
    items: [
      {
        icon: Package,
        key: 'nav.inventory',
        permissions: [
          PERMISSIONS.INVENTORY_ADJUST,
          PERMISSIONS.INVENTORY_PURCHASE,
          PERMISSIONS.INVENTORY_EXPIRY_READ,
          PERMISSIONS.INVENTORY_SHELF_READ,
          PERMISSIONS.REPORTS_VIEW_BASIC,
        ],
        to: '/inventory',
      },
      {
        icon: Truck,
        key: 'nav.purchasing',
        permissions: [PERMISSIONS.INVENTORY_PURCHASE],
        to: '/purchasing',
      },
    ],
  },
  {
    key: 'group.money',
    items: [
      {
        icon: Wallet,
        key: 'nav.cash',
        permissions: [
          PERMISSIONS.CASH_OPEN_SESSION,
          PERMISSIONS.CASH_CLOSE_SESSION,
          PERMISSIONS.CASH_APPROVE_VARIANCE,
        ],
        to: '/cash',
      },
      {
        icon: LayoutDashboard,
        key: 'nav.owner',
        permissions: [PERMISSIONS.REPORTS_VIEW_FINANCIAL, PERMISSIONS.ANALYTICS_OWNER_READ],
        to: '/owner',
      },
      {
        icon: BarChart3,
        key: 'nav.reports',
        permissions: [PERMISSIONS.REPORTS_VIEW_BASIC, PERMISSIONS.REPORTS_VIEW_FINANCIAL],
        to: '/reports',
      },
    ],
  },
  {
    key: 'group.system',
    items: [
      {
        icon: Activity,
        key: 'nav.operations',
        permissions: [
          PERMISSIONS.FBR_VIEW_STATUS,
          PERMISSIONS.BACKUP_RESTORE,
          PERMISSIONS.AI_AUDIT_READ,
          PERMISSIONS.SETTINGS_MANAGE_SYSTEM,
        ],
        to: '/operations',
      },
      {
        icon: Settings,
        key: 'nav.admin',
        permissions: [
          PERMISSIONS.SETTINGS_MANAGE_USERS,
          PERMISSIONS.SETTINGS_MANAGE_SYSTEM,
          PERMISSIONS.INVENTORY_SHELF_MANAGE,
        ],
        to: '/admin',
      },
    ],
  },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('pharmacy-sidebar-collapsed') === 'true';
  } catch {
    return false;
  }
}

export function AppShell({ children }: { readonly children: ReactNode }) {
  const session = useSession();
  const can = usePermissions();
  const { t } = useI18n();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      try {
        localStorage.setItem('pharmacy-sidebar-collapsed', String(!current));
      } catch {
        // Preference only.
      }
      return !current;
    });
  };
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => !session || can(...item.permissions)),
  })).filter((group) => group.items.length > 0);
  const current = NAVIGATION.flatMap((group) => group.items).find((item) =>
    location.pathname.startsWith(item.to),
  );

  return (
    <div className={collapsed ? 'app-shell collapsed' : 'app-shell'}>
      <aside className="sidebar" aria-label="Main menu">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            Rx
          </span>
          <div>
            <strong>{t('app.name')}</strong>
            <span>{session?.user.terminalName ?? t('app.tagline')}</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.key}>
              <div className="nav-group-label">{t(group.key)}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                  title={collapsed ? t(item.key) : undefined}
                >
                  <item.icon aria-hidden />
                  <span>{t(item.key)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="nav-link" onClick={toggleCollapsed}>
            {collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
            <span>{collapsed ? t('nav.expand') : t('nav.collapse')}</span>
          </button>
        </div>
      </aside>
      <header className="topbar">
        <h1 className="topbar-title">{current ? t(current.key) : t('app.name')}</h1>
        <div className="topbar-spacer" />
        <div className="topbar-status">
          <TillStatus />
          <LanStatus />
          {session ? (
            <span className="status-chip" title="This computer">
              <Monitor aria-hidden /> {session.user.terminalCode}
            </span>
          ) : null}
        </div>
        <UserMenu />
      </header>
      <main className="app-main" id="main">
        {children}
      </main>
    </div>
  );
}

function LanStatus() {
  const lan = useLanStatus();
  const { t } = useI18n();
  const label =
    lan === 'READY'
      ? t('status.ready')
      : lan === 'UNAVAILABLE'
        ? t('status.unavailable')
        : t('status.checking');
  return (
    <span className={`status-chip ${lan.toLowerCase()}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function TillStatus() {
  const can = usePermissions();
  const { t } = useI18n();
  const allowed = can(PERMISSIONS.CASH_OPEN_SESSION);
  const till = useQuery({
    queryKey: ['cash-session-current'],
    queryFn: getCurrentCashSession,
    enabled: allowed,
    refetchInterval: 60_000,
  });
  if (!allowed || till.isLoading) return null;
  const session = till.data;
  if (!session) {
    return (
      <NavLink to="/cash" className="status-chip warning">
        <Wallet aria-hidden /> {t('status.tillClosed')}
      </NavLink>
    );
  }
  return (
    <NavLink
      to="/cash"
      className={session.status === 'OPEN' ? 'status-chip ready' : 'status-chip warning'}
      title="Expected cash in the drawer"
    >
      <Wallet aria-hidden />
      {session.status === 'OPEN' ? t('status.tillOpen') : t('status.tillCounting')} ·{' '}
      {formatMoney(session.expectedCash)}
    </NavLink>
  );
}

function UserMenu() {
  const session = useSession();
  const setSession = usePharmacyStore((state) => state.setSession);
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(container, open, close);
  const signOut = (): void => {
    if (session) void logout(session.accessToken).catch(() => undefined);
    setSession(null);
  };
  if (!session) return null;
  return (
    <div className="user-menu" ref={container}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(session.user.displayName)}
        </span>
        <span className="user-menu-name">
          <strong>{session.user.displayName}</strong>
          <span>{session.user.username}</span>
        </span>
      </button>
      {open ? (
        <div className="menu-popover" role="menu">
          <div className="menu-meta">
            Signed in on {session.user.terminalName} ({session.user.terminalCode})
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setLocale(locale === 'en' ? 'ur' : 'en');
              close();
            }}
          >
            <Languages aria-hidden /> {t('language.switch')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setPasswordOpen(true);
              close();
            }}
          >
            <KeyRound aria-hidden /> {t('auth.changePassword')}
          </button>
          <div className="menu-separator" />
          <button type="button" role="menuitem" className="menu-item" onClick={signOut}>
            <LogOut aria-hidden /> {t('auth.signOut')}
          </button>
        </div>
      ) : null}
      {passwordOpen ? <ChangePasswordDialog onClose={() => setPasswordOpen(false)} /> : null}
    </div>
  );
}

function ChangePasswordDialog({ onClose }: { readonly onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 12;
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await changeOwnPassword(current, next);
      toast.success('Password changed', 'You stay signed in here; other sessions were signed out.');
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Change your password"
      description="Use at least 12 characters. Other signed-in sessions will be signed out."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!current || next.length < 12 || mismatch}
            onClick={() => void submit()}
          >
            Change password
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <Field label="New password" error={tooShort ? 'At least 12 characters' : undefined}>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>
        <Field label="Repeat new password" error={mismatch ? 'Does not match' : undefined}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
