import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PASSWORD_MIN_LENGTH, shopProfileSchema } from '@pharmacy/shared';

import { platformRequest } from '../../api';
import { usePharmacyStore } from '../../store';
import { fbrReadiness, type ShopRecord } from '../administration/shop-types';

type Tab = 'shops' | 'users' | 'roles' | 'audit' | 'system';
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['shops', 'Shops & FBR'],
  ['users', 'All users'],
  ['roles', 'Roles'],
  ['audit', 'Audit log'],
  ['system', 'System'],
];

const ROLE_CODES = [
  'OWNER',
  'MANAGER',
  'SUPERVISOR',
  'CASHIER',
  'SALESPERSON',
  'INVENTORY_MANAGER',
  'SYSTEM_ADMIN',
  'SUPER_ADMIN',
] as const;

const PROFILE_FIELDS = [
  ['name', 'Shop name', ''],
  ['address', 'Address', ''],
  ['phone', 'Phone', ''],
  ['email', 'Email', ''],
  ['drugLicenseNumber', 'Drug sale license no.', ''],
  ['sellerNtnCnic', 'NTN (7/9 digits) or CNIC (13 digits)', ''],
  ['sellerStrn', 'STRN', ''],
  ['businessName', 'FBR registered business name', ''],
  ['province', 'Province', ''],
  ['posRegistrationNumber', 'FBR POS ID', ''],
  ['scenarioId', 'Sandbox scenario (SN###)', 'SN001'],
] as const;

type ProfileField = (typeof PROFILE_FIELDS)[number][0];

interface PlatformUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly isActive: boolean;
  readonly lockedUntil: string | null;
  readonly failedLoginCount: number;
  readonly lastLoginAt: string | null;
  readonly access: ReadonlyArray<{
    readonly branchId: string;
    readonly branchName: string;
    readonly role: string;
  }>;
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function ShopEditor({
  shop,
  token,
  onChanged,
}: {
  readonly shop: ShopRecord;
  readonly token: string;
  readonly onChanged: (message: string) => Promise<void>;
}): React.JSX.Element {
  const [form, setForm] = useState<Partial<Record<ProfileField, string>>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const value = (field: ProfileField): string => form[field] ?? shop[field] ?? '';
  const changed = Object.keys(form) as ProfileField[];

  const saveProfile = async (): Promise<void> => {
    const body = Object.fromEntries(
      changed.map((field) => {
        const text = (form[field] ?? '').trim();
        if (field === 'name') return [field, text];
        return [field, text === '' ? null : field === 'scenarioId' ? text.toUpperCase() : text];
      }),
    );
    const parsed = shopProfileSchema.safeParse(body);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`).join('; '),
      );
      return;
    }
    try {
      setError('');
      await platformRequest(token, `/shops/${shop.id}`, 'PATCH', parsed.data);
      setForm({});
      await onChanged(`${shop.name}: profile saved`);
    } catch (cause) {
      setError(errorText(cause, 'Profile could not be saved'));
    }
  };

  const act = async (path: string, body: unknown, done: string): Promise<void> => {
    try {
      setError('');
      await platformRequest(token, `/shops/${shop.id}${path}`, 'PATCH', body);
      await onChanged(done);
    } catch (cause) {
      setError(errorText(cause, 'Change failed'));
    }
  };

  const readiness = fbrReadiness(shop);
  return (
    <article
      className="work-panel compact-form-panel platform-shop"
      aria-label={`Shop ${shop.name}`}
    >
      <header>
        <div>
          <p className="eyebrow">
            {shop.code} · {shop.isActive ? 'active' : 'deactivated'} · {shop.users ?? 0} users ·{' '}
            {shop.terminals ?? 0} terminals · {shop.salesToday ?? 0} sales today
          </p>
          <h2>{shop.name}</h2>
        </div>
        <button
          type="button"
          className="secondary-button compact"
          onClick={() =>
            void act(
              '/active',
              { isActive: !shop.isActive },
              `${shop.name} ${shop.isActive ? 'deactivated' : 'activated'}`,
            )
          }
        >
          {shop.isActive ? 'Deactivate shop' : 'Activate shop'}
        </button>
      </header>
      <div className="platform-shop-grid">
        <div className="form-grid">
          {PROFILE_FIELDS.map(([field, label, placeholder]) => (
            <label key={field}>
              {label}
              <input
                value={value(field)}
                placeholder={placeholder}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [field]: event.target.value }))
                }
              />
            </label>
          ))}
          <div className="editor-actions">
            <button
              type="button"
              className="primary-button"
              disabled={changed.length === 0}
              onClick={() => void saveProfile()}
            >
              Save profile
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={changed.length === 0}
              onClick={() => setForm({})}
            >
              Discard
            </button>
          </div>
        </div>
        <aside className="platform-fbr">
          <h3>FBR</h3>
          <div className="switch-row">
            <span>
              <strong>FBR invoicing</strong>
              <small>The shop owner can also switch this.</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={shop.fbr.invoicingEnabled}
              aria-label={`FBR invoicing for ${shop.name}`}
              className={shop.fbr.invoicingEnabled ? 'toggle-switch on' : 'toggle-switch'}
              onClick={() =>
                void act(
                  '/fbr-invoicing',
                  { enabled: !shop.fbr.invoicingEnabled },
                  `${shop.name}: FBR invoicing ${shop.fbr.invoicingEnabled ? 'off' : 'on'}`,
                )
              }
            >
              <span />
            </button>
          </div>
          <div className="switch-row">
            <span>
              <strong>Live sending to FBR</strong>
              <small>
                {shop.fbr.transmissionApproved
                  ? `Approved ${shop.fbr.transmissionApprovedAt ? new Date(shop.fbr.transmissionApprovedAt).toLocaleDateString('en-PK') : ''}`
                  : 'Not approved: invoices are recorded but never sent.'}
              </small>
            </span>
          </div>
          <label>
            Reason (recorded in the audit log)
            <input
              value={reason}
              placeholder="e.g. FBR POS ID issued and sandbox tested"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={shop.fbr.transmissionApproved ? 'secondary-button' : 'primary-button'}
            disabled={reason.trim().length < 3}
            onClick={() =>
              void act(
                '/fbr-transmission',
                { approved: !shop.fbr.transmissionApproved, reason: reason.trim() },
                `${shop.name}: live FBR sending ${shop.fbr.transmissionApproved ? 'withdrawn' : 'approved'}`,
              ).then(() => setReason(''))
            }
          >
            {shop.fbr.transmissionApproved ? 'Withdraw approval' : 'Approve live sending'}
          </button>
          {readiness.length > 0 ? (
            <ul className="readiness-list">
              {readiness.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : (
            <p className="counter-notice">Ready: invoices get FBR numbers and QR codes.</p>
          )}
        </aside>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function ShopsTab({
  token,
  onMessage,
}: {
  readonly token: string;
  readonly onMessage: (text: string) => void;
}) {
  const client = useQueryClient();
  const shops = useQuery({
    queryKey: ['platform', 'shops'],
    queryFn: () => platformRequest<{ readonly data: readonly ShopRecord[] }>(token, '/shops'),
  });
  const [draft, setDraft] = useState({ code: '', name: '', address: '', phone: '' });
  const [error, setError] = useState('');
  const refresh = async (message: string): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['platform', 'shops'] });
    onMessage(message);
  };
  const create = async (): Promise<void> => {
    try {
      setError('');
      await platformRequest(token, '/shops', 'POST', {
        code: draft.code.trim().toUpperCase(),
        name: draft.name.trim(),
        ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
        ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
      });
      setDraft({ code: '', name: '', address: '', phone: '' });
      await refresh('Shop created with an admin terminal. Add its owner under All users.');
    } catch (cause) {
      setError(errorText(cause, 'Shop could not be created'));
    }
  };
  return (
    <div className="platform-stack">
      {(shops.data?.data ?? []).map((shop) => (
        <ShopEditor key={shop.id} shop={shop} token={token} onChanged={refresh} />
      ))}
      <article className="work-panel compact-form-panel">
        <header>
          <div>
            <p className="eyebrow">New installation</p>
            <h2>Add a shop</h2>
          </div>
        </header>
        <div className="form-grid">
          <label>
            Code
            <input
              value={draft.code}
              placeholder="SHOP-2"
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
            />
          </label>
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            Address
            <input
              value={draft.address}
              onChange={(event) => setDraft({ ...draft, address: event.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={draft.code.trim().length < 2 || draft.name.trim().length < 2}
            onClick={() => void create()}
          >
            Create shop
          </button>
        </div>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </article>
    </div>
  );
}

function UserRow({
  user,
  shops,
  token,
  onChanged,
}: {
  readonly user: PlatformUser;
  readonly shops: readonly ShopRecord[];
  readonly token: string;
  readonly onChanged: (message: string) => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [branchId, setBranchId] = useState(user.access[0]?.branchId ?? shops[0]?.id ?? '');
  const [roles, setRoles] = useState<readonly string[]>(
    user.access.filter((item) => item.branchId === branchId).map((item) => item.role),
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const run = async (path: string, method: 'POST' | 'PATCH', body: unknown, done: string) => {
    try {
      setError('');
      await platformRequest(token, `/users/${user.id}${path}`, method, body);
      await onChanged(done);
      return true;
    } catch (cause) {
      setError(errorText(cause, 'Change failed'));
      return false;
    }
  };
  const locked = user.lockedUntil !== null && new Date(user.lockedUntil) > new Date();
  return (
    <div className="platform-user">
      <div className="platform-user-main">
        <span>
          <strong>{user.displayName}</strong>
          <small>
            {user.username} · {user.isActive ? 'active' : 'deactivated'}
            {locked ? ' · locked' : ''}
            {user.lastLoginAt
              ? ` · last sign-in ${new Date(user.lastLoginAt).toLocaleString('en-PK')}`
              : ''}
          </small>
        </span>
        <span className="role-chips">
          {user.access.map((item) => (
            <em key={`${item.branchId}-${item.role}`}>
              {item.branchName}: {item.role}
            </em>
          ))}
        </span>
        <span className="platform-user-actions">
          <button type="button" onClick={() => setEditing((open) => !open)}>
            {editing ? 'Close' : 'Manage'}
          </button>
          <button
            type="button"
            onClick={() =>
              void run(
                '',
                'PATCH',
                { isActive: !user.isActive },
                `${user.username} ${user.isActive ? 'deactivated' : 'activated'}`,
              )
            }
          >
            {user.isActive ? 'Deactivate' : 'Activate'}
          </button>
          {locked || user.failedLoginCount > 0 ? (
            <button
              type="button"
              onClick={() => void run('/unlock', 'POST', {}, `${user.username} unlocked`)}
            >
              Unlock
            </button>
          ) : null}
        </span>
      </div>
      {editing ? (
        <div className="platform-user-edit">
          <label>
            Shop
            <select
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setRoles(
                  user.access
                    .filter((item) => item.branchId === event.target.value)
                    .map((item) => item.role),
                );
              }}
            >
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="role-picker">
            <legend>Roles in this shop</legend>
            {ROLE_CODES.map((code) => (
              <label key={code} className="check-field">
                <input
                  type="checkbox"
                  checked={roles.includes(code)}
                  onChange={(event) =>
                    setRoles((current) =>
                      event.target.checked
                        ? [...current, code]
                        : current.filter((role) => role !== code),
                    )
                  }
                />
                <span>{code}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="secondary-button compact"
            disabled={roles.length === 0}
            onClick={() =>
              void run('', 'PATCH', { branchId, roles }, `${user.username}: roles saved`)
            }
          >
            Save roles
          </button>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-button compact"
            disabled={password.length < PASSWORD_MIN_LENGTH}
            onClick={() =>
              void run('/password', 'POST', { password }, `${user.username}: password reset`).then(
                (ok) => {
                  if (ok) setPassword('');
                },
              )
            }
          >
            Reset password
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function UsersTab({
  token,
  onMessage,
}: {
  readonly token: string;
  readonly onMessage: (text: string) => void;
}) {
  const client = useQueryClient();
  const users = useQuery({
    queryKey: ['platform', 'users'],
    queryFn: () => platformRequest<{ readonly data: readonly PlatformUser[] }>(token, '/users'),
  });
  const shops = useQuery({
    queryKey: ['platform', 'shops'],
    queryFn: () => platformRequest<{ readonly data: readonly ShopRecord[] }>(token, '/shops'),
  });
  const shopList = shops.data?.data ?? [];
  const [draft, setDraft] = useState({
    branchId: '',
    username: '',
    displayName: '',
    password: '',
    role: 'OWNER',
  });
  const [error, setError] = useState('');
  const refresh = async (message: string): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['platform'] });
    onMessage(message);
  };
  const create = async (): Promise<void> => {
    try {
      setError('');
      await platformRequest(token, '/users', 'POST', {
        branchId: draft.branchId || shopList[0]?.id,
        username: draft.username.trim(),
        displayName: draft.displayName.trim(),
        password: draft.password,
        roles: [draft.role],
      });
      setDraft({ ...draft, username: '', displayName: '', password: '' });
      await refresh('User created');
    } catch (cause) {
      setError(errorText(cause, 'User could not be created'));
    }
  };
  return (
    <div className="platform-stack">
      <article className="work-panel compact-form-panel">
        <header>
          <div>
            <p className="eyebrow">Any shop, any role</p>
            <h2>Create a user</h2>
          </div>
        </header>
        <div className="form-grid">
          <label>
            Shop
            <select
              value={draft.branchId || shopList[0]?.id || ''}
              onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}
            >
              {shopList.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Username
            <input
              value={draft.username}
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
          </label>
          <label>
            Display name
            <input
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            />
          </label>
          <label>
            Password ({PASSWORD_MIN_LENGTH}+ characters)
            <input
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
          </label>
          <label>
            Role
            <select
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            >
              {ROLE_CODES.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={
              draft.username.trim().length < 3 ||
              draft.displayName.trim().length < 2 ||
              draft.password.length < PASSWORD_MIN_LENGTH
            }
            onClick={() => void create()}
          >
            Create user
          </button>
        </div>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </article>
      <article className="work-panel">
        <header>
          <div>
            <p className="eyebrow">Every account</p>
            <h2>Users ({users.data?.data.length ?? 0})</h2>
          </div>
        </header>
        <div className="platform-user-list">
          {(users.data?.data ?? []).map((user) => (
            <UserRow key={user.id} user={user} shops={shopList} token={token} onChanged={refresh} />
          ))}
        </div>
      </article>
    </div>
  );
}

function RolesTab({ token }: { readonly token: string }) {
  const roles = useQuery({
    queryKey: ['platform', 'roles'],
    queryFn: () =>
      platformRequest<{
        readonly data: ReadonlyArray<{
          readonly code: string;
          readonly name: string;
          readonly permissions: readonly string[];
        }>;
      }>(token, '/roles'),
  });
  return (
    <article className="work-panel">
      <header>
        <div>
          <p className="eyebrow">What each role can do</p>
          <h2>Roles</h2>
        </div>
      </header>
      <div className="platform-roles">
        {(roles.data?.data ?? []).map((role) => (
          <div key={role.code}>
            <strong>
              {role.name} <small>{role.code}</small>
            </strong>
            <p>{role.permissions.length > 0 ? role.permissions.join(', ') : 'No permissions'}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function AuditTab({ token }: { readonly token: string }) {
  const [branchId, setBranchId] = useState('');
  const shops = useQuery({
    queryKey: ['platform', 'shops'],
    queryFn: () => platformRequest<{ readonly data: readonly ShopRecord[] }>(token, '/shops'),
  });
  const audit = useQuery({
    queryKey: ['platform', 'audit', branchId],
    queryFn: () =>
      platformRequest<{
        readonly data: ReadonlyArray<{
          readonly id: string;
          readonly eventType: string;
          readonly entityType: string | null;
          readonly entityId: string | null;
          readonly createdAt: string;
          readonly branchName: string | null;
          readonly userName: string | null;
        }>;
      }>(token, `/audit?limit=150${branchId ? `&branchId=${branchId}` : ''}`),
  });
  return (
    <article className="work-panel">
      <header>
        <div>
          <p className="eyebrow">Latest 150 events</p>
          <h2>Audit log</h2>
        </div>
        <select
          aria-label="Filter by shop"
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
        >
          <option value="">All shops</option>
          {(shops.data?.data ?? []).map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.name}
            </option>
          ))}
        </select>
      </header>
      <table className="platform-audit">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Shop</th>
            <th scope="col">Who</th>
            <th scope="col">Event</th>
            <th scope="col">Record</th>
          </tr>
        </thead>
        <tbody>
          {(audit.data?.data ?? []).map((event) => (
            <tr key={event.id}>
              <td>{new Date(event.createdAt).toLocaleString('en-PK')}</td>
              <td>{event.branchName ?? '—'}</td>
              <td>{event.userName ?? 'System'}</td>
              <td>{event.eventType}</td>
              <td>{event.entityType ? `${event.entityType} ${event.entityId ?? ''}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function SystemTab({ token }: { readonly token: string }) {
  const system = useQuery({
    queryKey: ['platform', 'system'],
    queryFn: () =>
      platformRequest<{
        readonly fbrMode: string;
        readonly fbrApiBaseUrl: string;
        readonly fbrTokenConfigured: boolean;
        readonly nodeVersion: string;
        readonly environment: string;
      }>(token, '/system'),
  });
  const data = system.data;
  return (
    <article className="work-panel compact-form-panel">
      <header>
        <div>
          <p className="eyebrow">Server configuration (read from .env)</p>
          <h2>System</h2>
        </div>
      </header>
      <dl className="profile-list">
        <div>
          <dt>FBR mode</dt>
          <dd>{data?.fbrMode ?? '—'}</dd>
        </div>
        <div>
          <dt>FBR API</dt>
          <dd>{data?.fbrApiBaseUrl ?? '—'}</dd>
        </div>
        <div>
          <dt>FBR API token</dt>
          <dd>{data ? (data.fbrTokenConfigured ? 'Configured' : 'Missing') : '—'}</dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{data?.environment ?? '—'}</dd>
        </div>
        <div>
          <dt>Node.js</dt>
          <dd>{data?.nodeVersion ?? '—'}</dd>
        </div>
      </dl>
      <p className="side-hint">
        FBR mode and the API token are server secrets set in .env (FBR_MODE, FBR_API_TOKEN) and take
        effect after a restart. They are never sent to the browser.
      </p>
    </article>
  );
}

/** The software owner's console: every shop, account and setting. */
export function PlatformScreen(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const [tab, setTab] = useState<Tab>('shops');
  const [message, setMessage] = useState('');
  return (
    <main className="operations-canvas admin-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Software owner</p>
          <h1>Super admin</h1>
          <p>
            Control every shop, account and FBR setting. Every change is written to the audit log.
          </p>
        </div>
      </section>
      {message ? (
        <p className="counter-notice" role="status">
          {message}
        </p>
      ) : null}
      <div className="segmented-control admin-tabs">
        {TABS.map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={tab === key ? 'selected' : ''}
            onClick={() => {
              setTab(key);
              setMessage('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'shops' ? <ShopsTab token={token} onMessage={setMessage} /> : null}
      {tab === 'users' ? <UsersTab token={token} onMessage={setMessage} /> : null}
      {tab === 'roles' ? <RolesTab token={token} /> : null}
      {tab === 'audit' ? <AuditTab token={token} /> : null}
      {tab === 'system' ? <SystemTab token={token} /> : null}
    </main>
  );
}
