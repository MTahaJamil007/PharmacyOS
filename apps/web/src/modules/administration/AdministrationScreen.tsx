import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN_LENGTH, PERMISSIONS } from '@pharmacy/shared';
import { useState } from 'react';

import { adminGet, adminPatch, adminPost } from '../../api';
import { CatalogImportPanel } from './CatalogImportPanel';
import { InvoiceLayoutEditor } from './InvoiceLayoutEditor';
import { ShopFbrPanel } from './ShopFbrPanel';
import { usePharmacyStore } from '../../store';

type Resource = 'users' | 'medicines' | 'suppliers' | 'shelves' | 'terminals';
type Tab = Resource | 'shop' | 'invoice';
const TAB_LABELS: Record<Tab, string> = {
  users: 'users',
  medicines: 'medicines',
  suppliers: 'suppliers',
  shelves: 'shelves',
  terminals: 'terminals',
  shop: 'shop & FBR',
  invoice: 'invoice layout',
};
interface AdminRecord {
  readonly id: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly username?: string;
  readonly code?: string | null;
  readonly roles?: readonly string[];
  readonly isActive?: boolean;
}

interface OperationalPolicies {
  readonly basicDiscountLimitPercent: string;
  readonly cashVarianceApprovalThreshold: string;
}

/** Server-enforced input rules worth stating before an operator submits the form. */
const fieldHints: Readonly<Record<string, string>> = {
  password: `At least ${String(PASSWORD_MIN_LENGTH)} characters.`,
  username: 'At least 3 characters, and unique.',
  displayName: 'At least 2 characters.',
  taxRate: 'Percentage with up to two decimals, for example 17 or 17.50.',
};

const labels: Record<Resource, readonly string[]> = {
  users: ['username', 'displayName', 'password', 'role'],
  medicines: ['name', 'sku', 'barcode', 'hsCode', 'taxRate'],
  suppliers: ['name', 'code', 'phone'],
  shelves: ['name', 'code', 'rack'],
  terminals: ['name', 'code', 'terminalType'],
};

export function AdministrationScreen(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const canUsers = session?.user.permissions.includes(PERMISSIONS.SETTINGS_MANAGE_USERS) ?? false;
  const canSystem = session?.user.permissions.includes(PERMISSIONS.SETTINGS_MANAGE_SYSTEM) ?? false;
  const canShelves =
    session?.user.permissions.includes(PERMISSIONS.INVENTORY_SHELF_MANAGE) ?? false;
  const available = (['users', 'medicines', 'suppliers', 'shelves', 'terminals'] as const).filter(
    (resource) =>
      resource === 'users' ? canUsers : resource === 'shelves' ? canShelves : canSystem,
  );
  const tabs: readonly Tab[] = canSystem ? [...available, 'shop', 'invoice'] : available;
  const canGrantSuperAdmin =
    session?.user.permissions.includes(PERMISSIONS.PLATFORM_SUPER_ADMIN) ?? false;
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'users');
  const resource: Resource = tab === 'shop' || tab === 'invoice' ? (available[0] ?? 'users') : tab;
  const [form, setForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const client = useQueryClient();
  const records = useQuery({
    queryKey: ['admin', resource],
    queryFn: () => adminGet<{ readonly data: readonly AdminRecord[] }>(token, `/${resource}`),
    enabled: available.includes(resource) && tab === resource,
  });
  const policies = useQuery({
    queryKey: ['admin', 'policies'],
    queryFn: () => adminGet<OperationalPolicies>(token, '/policies'),
    enabled: canSystem,
  });

  const body = (): Record<string, unknown> => {
    switch (resource) {
      case 'users':
        return {
          username: form.username,
          displayName: form.displayName,
          password: form.password,
          roles: [form.role || 'CASHIER'],
        };
      case 'medicines':
        return {
          name: form.name,
          ...(form.sku ? { sku: form.sku } : {}),
          ...(form.barcode ? { barcode: form.barcode } : {}),
          ...(form.hsCode ? { hsCode: form.hsCode } : {}),
          taxRate: form.taxRate || '0',
          packSize: '1',
          unitName: 'unit',
        };
      case 'suppliers':
        return {
          name: form.name,
          ...(form.code ? { code: form.code } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
          leadTimeDays: 1,
        };
      case 'shelves':
        return {
          name: form.name,
          code: form.code,
          ...(form.rack ? { rack: form.rack } : {}),
          pickPriority: 100,
          storageClass: 'AMBIENT',
          isSecured: false,
          isPickLocation: true,
        };
      case 'terminals':
        return { name: form.name, code: form.code, terminalType: form.terminalType || 'ADMIN' };
    }
  };
  const create = async (): Promise<void> => {
    try {
      setMessage('Saving…');
      await adminPost(token, `/${resource}`, body());
      setForm({});
      await client.invalidateQueries({ queryKey: ['admin', resource] });
      setMessage(`${resource.slice(0, -1)} created`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Create failed');
    }
  };
  const toggle = async (record: AdminRecord): Promise<void> => {
    try {
      await adminPatch(token, `/${resource}/${record.id}`, {
        isActive: !(record.isActive ?? true),
      });
      await client.invalidateQueries({ queryKey: ['admin', resource] });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Update failed');
    }
  };
  const changePassword = async (): Promise<void> => {
    try {
      await adminPost(token, '/users/me/password', passwords);
      setPasswords({ currentPassword: '', newPassword: '' });
      setMessage('Password changed; other sessions were revoked');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Password change failed');
    }
  };
  const updatePolicies = async (): Promise<void> => {
    try {
      await adminPatch(token, '/policies', {
        basicDiscountLimitPercent: form.basicDiscountLimitPercent,
        cashVarianceApprovalThreshold: form.cashVarianceApprovalThreshold,
      });
      await client.invalidateQueries({ queryKey: ['admin', 'policies'] });
      setMessage('Branch policies updated');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Policy update failed');
    }
  };

  return (
    <main className="operations-canvas admin-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Day-two controls</p>
          <h1>Administer without touching SQL.</h1>
          <p>
            Changes are permission-gated, branch-scoped where operational, and written to the audit
            trail.
          </p>
        </div>
      </section>
      {message ? (
        <p className={message.includes('failed') ? 'inline-error' : 'counter-notice'} role="status">
          {message}
        </p>
      ) : null}
      <div className="segmented-control admin-tabs">
        {tabs.map((item) => (
          <button
            className={tab === item ? 'selected' : ''}
            key={item}
            onClick={() => {
              setTab(item);
              setForm({});
              setMessage('');
            }}
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </div>
      {tab === 'shop' ? <ShopFbrPanel /> : null}
      {tab === 'invoice' ? <InvoiceLayoutEditor /> : null}
      {tab === 'shop' || tab === 'invoice' ? null : (
        <section className="admin-layout">
          <article className="work-panel compact-form-panel">
            <header>
              <div>
                <p className="eyebrow">Create</p>
                <h2>New {resource.slice(0, -1)}</h2>
              </div>
            </header>
            <div className="form-grid single-column">
              {labels[resource].map((field) => (
                <label key={field}>
                  {field.replace(/([A-Z])/g, ' $1')}
                  {field === 'role' ? (
                    <select
                      value={form[field] ?? 'CASHIER'}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field]: event.target.value }))
                      }
                    >
                      <option>CASHIER</option>
                      <option>SALESPERSON</option>
                      <option>SUPERVISOR</option>
                      <option>INVENTORY_MANAGER</option>
                      <option>MANAGER</option>
                      <option>OWNER</option>
                      <option>SYSTEM_ADMIN</option>
                      {canGrantSuperAdmin ? <option>SUPER_ADMIN</option> : null}
                    </select>
                  ) : field === 'terminalType' ? (
                    <select
                      value={form[field] ?? 'ADMIN'}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field]: event.target.value }))
                      }
                    >
                      <option>ADMIN</option>
                      <option>CASHIER</option>
                      <option>SALES_COUNTER</option>
                    </select>
                  ) : (
                    <input
                      type={field === 'password' ? 'password' : 'text'}
                      value={form[field] ?? ''}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field]: event.target.value }))
                      }
                    />
                  )}
                  {fieldHints[field] ? (
                    <small className="field-hint">{fieldHints[field]}</small>
                  ) : null}
                </label>
              ))}
              <button className="primary-button" onClick={() => void create()}>
                Create
              </button>
            </div>
          </article>
          <article className="work-panel admin-records">
            <header>
              <div>
                <p className="eyebrow">Current records</p>
                <h2>{resource}</h2>
              </div>
              <span>{records.data?.data.length ?? 0}</span>
            </header>
            <div className="data-list">
              {(records.data?.data ?? []).map((record) => (
                <div className="admin-row" key={record.id}>
                  <span>
                    <strong>
                      {record.displayName ?? record.name ?? record.username ?? record.code}
                    </strong>
                    <small>{record.username ?? record.code ?? record.roles?.join(', ')}</small>
                  </span>
                  <button onClick={() => void toggle(record)}>
                    {record.isActive === false ? 'Activate' : 'Deactivate'}
                  </button>
                </div>
              ))}
            </div>
          </article>
          <aside className="admin-side-stack">
            <article className="work-panel compact-form-panel">
              <header>
                <div>
                  <p className="eyebrow">My security</p>
                  <h2>Change password</h2>
                </div>
              </header>
              <div className="form-grid single-column">
                <label>
                  Current password
                  <input
                    type="password"
                    value={passwords.currentPassword}
                    onChange={(event) =>
                      setPasswords((current) => ({
                        ...current,
                        currentPassword: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    value={passwords.newPassword}
                    onChange={(event) =>
                      setPasswords((current) => ({ ...current, newPassword: event.target.value }))
                    }
                  />
                </label>
                <button className="secondary-button" onClick={() => void changePassword()}>
                  Change password
                </button>
              </div>
            </article>
            {canSystem ? (
              <article className="work-panel compact-form-panel">
                <header>
                  <div>
                    <p className="eyebrow">Branch policy</p>
                    <h2>Approval limits</h2>
                  </div>
                </header>
                <div className="form-grid single-column">
                  <label>
                    Basic discount %
                    <input
                      value={
                        form.basicDiscountLimitPercent ??
                        policies.data?.basicDiscountLimitPercent ??
                        ''
                      }
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          basicDiscountLimitPercent: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Cash variance threshold
                    <input
                      value={
                        form.cashVarianceApprovalThreshold ??
                        policies.data?.cashVarianceApprovalThreshold ??
                        ''
                      }
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          cashVarianceApprovalThreshold: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button className="secondary-button" onClick={() => void updatePolicies()}>
                    Update policies
                  </button>
                </div>
              </article>
            ) : null}
            <CatalogImportPanel />
          </aside>
        </section>
      )}
    </main>
  );
}
