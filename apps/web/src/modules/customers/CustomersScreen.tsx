import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  minorUnitsToMoney,
  moneyToMinorUnits,
  PERMISSIONS,
  type CustomerSummary,
} from '@pharmacy/shared';
import { BookUser, HandCoins, Pencil, Phone, Search, UserPlus, Users } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import {
  createCustomer,
  getCurrentCashSession,
  getCustomerStatement,
  getReceivablesAging,
  recordCustomerPayment,
  searchCustomers,
  updateCustomer,
} from '../../api';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  MoneyInput,
  PageHeader,
  SearchInput,
  Segmented,
  Stat,
  Textarea,
  useToast,
} from '../../components/ui';
import { formatDateTime, formatMoney, humanize, isNegative, isZero } from '../../format';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePermissions, useRequestId } from '../../hooks/useSession';

const MONEY = /^\d+(?:\.\d{1,2})?$/;

const ENTRY_LABELS: Record<string, string> = {
  ADJUSTMENT: 'Adjustment',
  CREDIT_SALE: 'Sale on khata',
  OPENING_BALANCE: 'Opening balance',
  PAYMENT: 'Payment received',
  RETURN_CREDIT: 'Return credited',
};

export function CustomersScreen(): React.JSX.Element {
  const can = usePermissions();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'OWING'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const debounced = useDebouncedValue(text.trim(), 200);
  const customers = useQuery({
    queryKey: ['customers', debounced],
    queryFn: () => searchCustomers(debounced, 50),
  });
  const aging = useQuery({
    queryKey: ['receivables-aging'],
    queryFn: getReceivablesAging,
    enabled: can(PERMISSIONS.REPORTS_VIEW_FINANCIAL),
  });
  const rows = useMemo(
    () => (customers.data ?? []).filter((row) => filter === 'ALL' || !isZero(row.balance)),
    [customers.data, filter],
  );

  return (
    <div className="page">
      <PageHeader
        title="Customers and khata"
        description="Customer accounts, credit limits, and a full running statement for every rupee owed."
        actions={
          can(PERMISSIONS.CUSTOMER_MANAGE) ? (
            <Button variant="primary" icon={UserPlus} onClick={() => setCreating(true)}>
              New customer
            </Button>
          ) : null
        }
      />
      <div className="stack">
        {aging.data ? (
          <div className="grid grid-4">
            <Stat
              label="Total owed to the pharmacy"
              icon={BookUser}
              value={formatMoney(aging.data.total)}
              hint={`${String(aging.data.customerCount)} customers`}
            />
            <Stat label="Up to 30 days" value={formatMoney(aging.data.current)} />
            <Stat
              label="31–90 days"
              value={formatMoney(
                minorUnitsToMoney(
                  moneyToMinorUnits(aging.data.days31To60) +
                    moneyToMinorUnits(aging.data.days61To90),
                ),
              )}
              tone={isZero(aging.data.days61To90) ? undefined : 'warning'}
            />
            <Stat
              label="Over 90 days"
              value={formatMoney(aging.data.over90Days)}
              tone={isZero(aging.data.over90Days) ? undefined : 'danger'}
            />
          </div>
        ) : null}
        <div className="grid grid-master">
          <Card flush>
            <div className="card-body" style={{ display: 'grid', gap: 10 }}>
              <SearchInput
                icon={Search}
                aria-label="Search customers"
                placeholder="Name or phone number"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <Segmented
                label="Customer filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { label: 'All', value: 'ALL' },
                  { label: 'Owing money', value: 'OWING' },
                ]}
              />
            </div>
            <ErrorAlert error={customers.error} />
            <DataTable
              rows={rows}
              loading={customers.isLoading}
              rowKey={(row) => row.id}
              selectedKey={selectedId}
              onRowClick={(row) => setSelectedId(row.id)}
              maxHeight="calc(100vh - 330px)"
              empty={<EmptyState icon={Users} title="No customers found" />}
              columns={[
                {
                  header: 'Customer',
                  key: 'name',
                  render: (row) => (
                    <>
                      <span className="cell-primary">{row.name}</span>
                      <span className="cell-sub">
                        {row.phone ?? 'No phone'}
                        {row.isActive ? '' : ' · inactive'}
                      </span>
                    </>
                  ),
                },
                {
                  align: 'end',
                  header: 'Owes',
                  key: 'balance',
                  render: (row) => (
                    <span className={isZero(row.balance) ? 'muted' : 'cell-primary'}>
                      {formatMoney(row.balance)}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
          {selectedId ? (
            <CustomerDetail customerId={selectedId} />
          ) : (
            <Card>
              <EmptyState icon={BookUser} title="Select a customer">
                Their balance, credit limit, and complete statement appear here.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
      {creating ? (
        <CustomerFormDialog
          onClose={() => setCreating(false)}
          onSaved={(customer) => {
            setCreating(false);
            setSelectedId(customer.id);
          }}
        />
      ) : null}
    </div>
  );
}

function CustomerDetail({ customerId }: { readonly customerId: string }) {
  const can = usePermissions();
  const statement = useQuery({
    queryKey: ['customer-statement', customerId],
    queryFn: () => getCustomerStatement(customerId),
  });
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const customer = statement.data?.customer;
  if (statement.error) return <ErrorAlert error={statement.error} />;
  if (!customer)
    return (
      <Card>
        <div className="skeleton" />
      </Card>
    );
  return (
    <div className="stack">
      <Card
        title={customer.name}
        description={
          [customer.phone, customer.address].filter(Boolean).join(' · ') || 'No contact details'
        }
        actions={
          <>
            {!customer.isActive ? <Badge tone="danger">Inactive</Badge> : null}
            {can(PERMISSIONS.CUSTOMER_MANAGE) ? (
              <Button icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {can(PERMISSIONS.CUSTOMER_PAYMENT) && !isZero(customer.balance) ? (
              <Button variant="primary" icon={HandCoins} onClick={() => setPaying(true)}>
                Receive payment
              </Button>
            ) : null}
          </>
        }
      >
        <div className="kv-grid">
          <div className="kv">
            <span>Owes</span>
            <strong>{formatMoney(customer.balance)}</strong>
          </div>
          <div className="kv">
            <span>Credit limit</span>
            <strong>{formatMoney(customer.creditLimit)}</strong>
          </div>
          <div className="kv">
            <span>Credit still available</span>
            <strong>{formatMoney(customer.availableCredit)}</strong>
          </div>
          <div className="kv">
            <span>Customer since</span>
            <strong>{formatDateTime(customer.createdAt).split(',')[0]}</strong>
          </div>
        </div>
      </Card>
      <Card title="Statement" description="Every charge and payment, newest first." flush>
        <DataTable
          rows={statement.data?.entries ?? []}
          rowKey={(entry) => entry.id}
          maxHeight="calc(100vh - 420px)"
          empty={<EmptyState title="No khata activity yet" />}
          columns={[
            { header: 'When', key: 'when', render: (entry) => formatDateTime(entry.createdAt) },
            {
              header: 'Entry',
              key: 'entry',
              render: (entry) => (
                <>
                  <span className="cell-primary">
                    {ENTRY_LABELS[entry.entryType] ?? humanize(entry.entryType)}
                  </span>
                  <span className="cell-sub">
                    {[
                      entry.invoiceNumber ? `Invoice ${entry.invoiceNumber}` : null,
                      entry.paymentMethod ? humanize(entry.paymentMethod) : null,
                      entry.reference,
                      entry.performedBy,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </>
              ),
            },
            {
              align: 'end',
              header: 'Amount',
              key: 'amount',
              render: (entry) =>
                isNegative(entry.amountDelta) ? (
                  <span className="text-success">− {formatMoney(entry.amountDelta.slice(1))}</span>
                ) : (
                  <span>+ {formatMoney(entry.amountDelta)}</span>
                ),
            },
            {
              align: 'end',
              header: 'Balance',
              key: 'balance',
              render: (entry) => formatMoney(entry.balanceAfter),
            },
          ]}
        />
      </Card>
      {paying ? <PaymentDialog customer={customer} onClose={() => setPaying(false)} /> : null}
      {editing ? (
        <CustomerFormDialog
          customer={customer}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

function PaymentDialog({
  customer,
  onClose,
}: {
  readonly customer: CustomerSummary;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const amountInput = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(customer.balance);
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER'>('CASH');
  const [reference, setReference] = useState('');
  const [requestId, renew] = useRequestId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tooMuch =
    MONEY.test(amount) && moneyToMinorUnits(amount) > moneyToMinorUnits(customer.balance);
  const valid = MONEY.test(amount.trim()) && !isZero(amount) && !tooMuch;
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      let cashSessionId: string | undefined;
      if (method === 'CASH') {
        const drawer = await getCurrentCashSession();
        if (!drawer || drawer.status !== 'OPEN')
          throw new Error('Open your cash drawer before receiving cash.');
        cashSessionId = drawer.id;
      }
      const result = await recordCustomerPayment(customer.id, {
        amount: amount.trim(),
        clientRequestId: requestId,
        method,
        ...(cashSessionId ? { cashSessionId } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      toast.success(
        `Payment of ${formatMoney(amount)} received`,
        `${customer.name} now owes ${formatMoney(result.balance)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['customer-statement', customer.id] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['receivables-aging'] });
      await queryClient.invalidateQueries({ queryKey: ['cash-session-current'] });
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Receive payment from ${customer.name}`}
      description={`Currently owes ${formatMoney(customer.balance)}`}
      size="sm"
      initialFocus={amountInput}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <Field label="Amount" error={tooMuch ? 'More than the customer owes' : undefined}>
          <MoneyInput
            ref={amountInput}
            className="input-lg"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              renew();
            }}
          />
        </Field>
        <Segmented
          label="Payment method"
          value={method}
          onChange={(next) => {
            setMethod(next);
            renew();
          }}
          options={[
            { label: 'Cash', value: 'CASH' },
            { label: 'Card', value: 'CARD' },
            { label: 'Bank / wallet', value: 'BANK_TRANSFER' },
          ]}
        />
        {method !== 'CASH' ? (
          <Field label="Reference" optional>
            <Input
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
                renew();
              }}
            />
          </Field>
        ) : (
          <span className="field-hint">Cash goes into your drawer and is counted at closing.</span>
        )}
      </div>
    </Dialog>
  );
}

function CustomerFormDialog({
  customer,
  onClose,
  onSaved,
}: {
  readonly customer?: CustomerSummary;
  readonly onClose: () => void;
  readonly onSaved: (customer: CustomerSummary) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [creditLimit, setCreditLimit] = useState(customer?.creditLimit ?? '0.00');
  const [openingBalance, setOpeningBalance] = useState('0.00');
  const [active, setActive] = useState(customer?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const validLimit = MONEY.test(creditLimit.trim());
  const validOpening = MONEY.test(openingBalance.trim());
  const openingOverLimit =
    !customer &&
    validLimit &&
    validOpening &&
    moneyToMinorUnits(openingBalance) > moneyToMinorUnits(creditLimit);
  const valid =
    name.trim().length >= 2 && validLimit && (customer ? true : validOpening && !openingOverLimit);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const saved = customer
        ? await updateCustomer(customer.id, {
            address: address.trim() || null,
            creditLimit: creditLimit.trim(),
            isActive: active,
            name: name.trim(),
            phone: phone.trim() || null,
          })
        : await createCustomer({
            creditLimit: creditLimit.trim(),
            name: name.trim(),
            openingBalance: openingBalance.trim(),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(address.trim() ? { address: address.trim() } : {}),
          });
      toast.success(customer ? 'Customer updated' : 'Customer created', saved.name);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customer-statement', saved.id] });
      onSaved(saved);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={customer ? `Edit ${customer.name}` : 'New customer'}
      description="A credit limit of zero means the customer pays at the counter and cannot use khata."
      initialFocus={nameInput}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {customer ? 'Save changes' : 'Create customer'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <div className="form-grid">
          <Field label="Full name" className="span-2">
            <Input ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Phone" optional>
            <SearchInput
              icon={Phone}
              inputMode="tel"
              value={phone}
              placeholder="03xx xxxxxxx"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field
            label="Credit limit (Rs)"
            error={creditLimit && !validLimit ? 'Enter an amount' : undefined}
          >
            <MoneyInput
              value={creditLimit}
              onChange={(event) => setCreditLimit(event.target.value)}
            />
          </Field>
          <Field label="Address" optional className="span-2">
            <Textarea value={address} onChange={(event) => setAddress(event.target.value)} />
          </Field>
          {!customer ? (
            <Field
              label="Already owes (opening balance)"
              hint="From your old register, if any."
              error={openingOverLimit ? 'Cannot be more than the credit limit' : undefined}
            >
              <MoneyInput
                value={openingBalance}
                onChange={(event) => setOpeningBalance(event.target.value)}
              />
            </Field>
          ) : (
            <div className="field">
              <span className="field-label">Status</span>
              <Checkbox label="Account active" checked={active} onChange={setActive} />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
