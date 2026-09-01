import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type CustomerSummary } from '@pharmacy/shared';
import { useState } from 'react';

import {
  createCustomer,
  getCurrentCashSession,
  getCustomerStatement,
  recordCustomerPayment,
  searchCustomers,
} from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';

export function CustomersScreen(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    creditLimit: '0.00',
    openingBalance: '0.00',
  });
  const [payment, setPayment] = useState({
    amount: '',
    method: 'CASH' as 'CASH' | 'CARD' | 'BANK_TRANSFER',
    reference: '',
  });
  const canManage = session?.user.permissions.includes(PERMISSIONS.CUSTOMER_MANAGE) ?? false;
  const canPay = session?.user.permissions.includes(PERMISSIONS.CUSTOMER_PAYMENT) ?? false;
  const customers = useQuery({
    queryKey: ['customers', query],
    queryFn: () => searchCustomers(token, query),
    enabled: Boolean(token),
  });
  const statement = useQuery({
    queryKey: ['customer-statement', selected?.id],
    queryFn: () => getCustomerStatement(token, selected?.id ?? ''),
    enabled: Boolean(token && selected),
  });

  const create = async (): Promise<void> => {
    try {
      setError('');
      const customer = await createCustomer(token, {
        name: customerForm.name,
        creditLimit: customerForm.creditLimit,
        openingBalance: customerForm.openingBalance,
        ...(customerForm.phone.trim() ? { phone: customerForm.phone.trim() } : {}),
        ...(customerForm.address.trim() ? { address: customerForm.address.trim() } : {}),
      });
      setSelected(customer);
      setCreating(false);
      setCustomerForm({
        name: '',
        phone: '',
        address: '',
        creditLimit: '0.00',
        openingBalance: '0.00',
      });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      setNotice('Customer account created');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Customer creation failed');
    }
  };

  const pay = async (): Promise<void> => {
    if (!selected) return;
    try {
      setError('');
      let cashSessionId: string | undefined;
      if (payment.method === 'CASH') {
        const cashSession = await getCurrentCashSession(token);
        if (!cashSession || cashSession.status !== 'OPEN')
          throw new Error('Open this terminal cash session first');
        cashSessionId = cashSession.id;
      }
      await recordCustomerPayment(token, selected.id, {
        amount: payment.amount,
        method: payment.method,
        ...(cashSessionId ? { cashSessionId } : {}),
        ...(payment.reference.trim() ? { reference: payment.reference.trim() } : {}),
      });
      setPayment({ amount: '', method: 'CASH', reference: '' });
      await queryClient.invalidateQueries({ queryKey: ['customer-statement', selected.id] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      setNotice('Account payment recorded');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account payment failed');
    }
  };

  return (
    <main className="operations-canvas customer-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Khata · append-only ledger</p>
          <h1>Customer accounts that reconcile.</h1>
          <p>Search by phone, collect partial payments, and retain a complete running statement.</p>
        </div>
        {canManage ? (
          <button className="primary-button" onClick={() => setCreating((value) => !value)}>
            New customer
          </button>
        ) : null}
      </section>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="counter-notice" role="status">
          {notice}
        </p>
      ) : null}
      {creating ? (
        <section className="work-panel compact-form-panel">
          <header>
            <div>
              <p className="eyebrow">Create account</p>
              <h2>Customer identity and limit</h2>
            </div>
          </header>
          <div className="form-grid">
            {(['name', 'phone', 'address', 'creditLimit', 'openingBalance'] as const).map(
              (field) => (
                <label key={field}>
                  {field.replace(/([A-Z])/g, ' $1')}
                  <input
                    value={customerForm[field]}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, [field]: event.target.value }))
                    }
                  />
                </label>
              ),
            )}
          </div>
          <button className="primary-button" onClick={() => void create()}>
            Create customer
          </button>
        </section>
      ) : null}
      <section className="customer-layout">
        <aside className="work-panel customer-index">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              placeholder="Phone or name"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="data-list">
            {(customers.data ?? []).map((customer) => (
              <button
                className={selected?.id === customer.id ? 'customer-row selected' : 'customer-row'}
                key={customer.id}
                onClick={() => setSelected(customer)}
              >
                <span>
                  <strong>{customer.name}</strong>
                  <small>{customer.phone ?? 'No phone'}</small>
                </span>
                <span>
                  <small>Balance</small>
                  <b>{formatPkrMoney(customer.balance)}</b>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <article className="work-panel statement-panel">
          {statement.data ? (
            <>
              <header>
                <div>
                  <p className="eyebrow">Account statement</p>
                  <h2>{statement.data.customer.name}</h2>
                </div>
                <strong>{formatPkrMoney(statement.data.customer.balance)}</strong>
              </header>
              <div className="account-strip">
                <span>
                  Limit <b>{formatPkrMoney(statement.data.customer.creditLimit)}</b>
                </span>
                <span>
                  Available <b>{formatPkrMoney(statement.data.customer.availableCredit)}</b>
                </span>
                <span>{statement.data.customer.isActive ? 'Active' : 'Inactive'}</span>
              </div>
              {canPay && statement.data.customer.balance !== '0.00' ? (
                <div className="payment-inline">
                  <input
                    aria-label="Payment amount"
                    inputMode="decimal"
                    placeholder="Amount"
                    value={payment.amount}
                    onChange={(event) =>
                      setPayment((current) => ({ ...current, amount: event.target.value }))
                    }
                  />
                  <select
                    value={payment.method}
                    onChange={(event) =>
                      setPayment((current) => ({
                        ...current,
                        method: event.target.value as typeof payment.method,
                      }))
                    }
                  >
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                  </select>
                  <input
                    aria-label="Payment reference"
                    placeholder="Reference (optional)"
                    value={payment.reference}
                    onChange={(event) =>
                      setPayment((current) => ({ ...current, reference: event.target.value }))
                    }
                  />
                  <button className="primary-button" onClick={() => void pay()}>
                    Record payment
                  </button>
                </div>
              ) : null}
              <div className="statement-list">
                {statement.data.entries.map((entry) => (
                  <div className="statement-row" key={entry.id}>
                    <span>
                      <strong>{entry.entryType.replaceAll('_', ' ')}</strong>
                      <small>
                        {new Date(entry.createdAt).toLocaleString('en-PK')} ·{' '}
                        {entry.invoiceNumber ?? entry.paymentMethod ?? entry.reason}
                      </small>
                    </span>
                    <b
                      className={entry.amountDelta.startsWith('-') ? 'credit-entry' : 'debit-entry'}
                    >
                      {entry.amountDelta.startsWith('-') ? '−' : '+'}
                      {formatPkrMoney(entry.amountDelta.replace('-', ''))}
                    </b>
                    <span>
                      <small>Balance</small>
                      {formatPkrMoney(entry.balanceAfter)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-state">Select a customer to inspect the authoritative ledger.</p>
          )}
        </article>
      </section>
    </main>
  );
}
