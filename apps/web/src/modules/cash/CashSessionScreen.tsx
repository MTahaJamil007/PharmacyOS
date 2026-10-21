import { useQuery, useQueryClient } from '@tanstack/react-query';
import { minorUnitsToMoney, moneyToMinorUnits, PERMISSIONS } from '@pharmacy/shared';
import { ArrowDownToLine, ArrowUpFromLine, Calculator, Lock, Unlock, Wallet } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import {
  addCashMovement,
  approveCashVariance,
  closeCashSession,
  getCurrentCashSession,
  getPendingCashVariances,
  openCashSession,
  type CashSessionSummary,
} from '../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  MoneyInput,
  PageHeader,
  Segmented,
  Stat,
  Textarea,
  useToast,
} from '../../components/ui';
import { formatDateTime, formatMoney, isNegative, isZero } from '../../format';
import { usePermissions, useRequestId, useSession } from '../../hooks/useSession';

const MONEY = /^\d+(?:\.\d{1,2})?$/;
const NOTES = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

function validMoney(value: string): boolean {
  return MONEY.test(value.trim());
}

function difference(counted: string, expected: string): string | null {
  try {
    return minorUnitsToMoney(moneyToMinorUnits(counted) - moneyToMinorUnits(expected));
  } catch {
    return null;
  }
}

export function CashSessionScreen(): React.JSX.Element {
  const session = useSession();
  const can = usePermissions();
  const queryClient = useQueryClient();
  const canApprove = can(PERMISSIONS.CASH_APPROVE_VARIANCE);
  const canOperate = can(PERMISSIONS.CASH_OPEN_SESSION);
  const current = useQuery({
    queryKey: ['cash-session-current'],
    queryFn: getCurrentCashSession,
    enabled: canOperate,
  });
  const pending = useQuery({
    queryKey: ['cash-session-pending'],
    queryFn: getPendingCashVariances,
    enabled: canApprove,
  });
  const [movementOpen, setMovementOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [approving, setApproving] = useState<CashSessionSummary | null>(null);
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['cash-session-current'] });
    await queryClient.invalidateQueries({ queryKey: ['cash-session-pending'] });
  };
  const drawer = current.data;

  return (
    <div className="page">
      <PageHeader
        title="Cash drawer"
        description={`${session?.user.terminalName ?? 'This terminal'} · ${session?.user.displayName ?? ''}`}
        actions={
          drawer?.status === 'OPEN' ? (
            <>
              <Button icon={ArrowDownToLine} onClick={() => setMovementOpen(true)}>
                Cash in / out
              </Button>
              <Button variant="primary" icon={Lock} onClick={() => setCloseOpen(true)}>
                Count and close
              </Button>
            </>
          ) : null
        }
      />
      <div className="stack">
        <ErrorAlert error={current.error ?? pending.error} />
        {canOperate && !current.isLoading && !drawer ? <OpenDrawerCard onOpened={refresh} /> : null}
        {drawer ? <DrawerSummary drawer={drawer} /> : null}
        {canApprove ? (
          <Card
            title="Variance approvals"
            description="Counts that differ from the expected cash by more than the branch threshold. A cashier cannot approve their own."
            flush
          >
            <DataTable
              rows={pending.data ?? []}
              loading={pending.isLoading}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Nothing to approve" icon={Wallet} />}
              columns={[
                {
                  header: 'Cashier',
                  key: 'cashier',
                  render: (row) => <span className="cell-primary">{row.cashierName}</span>,
                },
                { header: 'Opened', key: 'opened', render: (row) => formatDateTime(row.openedAt) },
                {
                  align: 'end',
                  header: 'Expected',
                  key: 'expected',
                  render: (row) => formatMoney(row.expectedCash),
                },
                {
                  align: 'end',
                  header: 'Counted',
                  key: 'counted',
                  render: (row) => formatMoney(row.countedCash),
                },
                {
                  align: 'end',
                  header: 'Difference',
                  key: 'variance',
                  render: (row) => (
                    <span className={isNegative(row.variance) ? 'text-danger' : 'text-success'}>
                      {formatMoney(row.variance)}
                    </span>
                  ),
                },
                { header: 'Notes', key: 'notes', render: (row) => row.closingNotes ?? '—' },
                {
                  align: 'end',
                  header: '',
                  key: 'action',
                  render: (row) =>
                    row.cashierUserId === session?.user.id ? (
                      <Badge>Your own count</Badge>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => setApproving(row)}>
                        Review
                      </Button>
                    ),
                },
              ]}
            />
          </Card>
        ) : null}
      </div>
      {movementOpen && drawer ? (
        <MovementDialog drawer={drawer} onClose={() => setMovementOpen(false)} onDone={refresh} />
      ) : null}
      {closeOpen && drawer ? (
        <CloseDialog drawer={drawer} onClose={() => setCloseOpen(false)} onDone={refresh} />
      ) : null}
      {approving ? (
        <ApproveDialog drawer={approving} onClose={() => setApproving(null)} onDone={refresh} />
      ) : null}
    </div>
  );
}

function OpenDrawerCard({ onOpened }: { readonly onOpened: () => Promise<void> }) {
  const toast = useToast();
  const [openingFloat, setOpeningFloat] = useState('5000');
  const [requestId, renew] = useRequestId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await openCashSession(openingFloat.trim(), requestId);
      renew();
      toast.success('Drawer opened', `Starting cash ${formatMoney(openingFloat)}`);
      await onOpened();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Open the drawer"
      description="Count the cash you are starting with. Sales cannot be taken until the drawer is open."
      footer={
        <Button
          variant="primary"
          icon={Unlock}
          loading={busy}
          disabled={!validMoney(openingFloat)}
          onClick={() => void submit()}
        >
          Open drawer
        </Button>
      }
    >
      <div className="form-grid">
        <Field
          label="Starting cash (opening float)"
          error={
            openingFloat && !validMoney(openingFloat) ? 'Enter an amount like 5000' : undefined
          }
        >
          <MoneyInput
            className="input-lg"
            value={openingFloat}
            onChange={(event) => {
              setOpeningFloat(event.target.value);
              renew();
            }}
          />
        </Field>
        <div>
          <ErrorAlert error={error} />
        </div>
      </div>
    </Card>
  );
}

function DrawerSummary({ drawer }: { readonly drawer: CashSessionSummary }) {
  const lines: Array<[string, string, 'plus' | 'minus' | 'base']> = [
    ['Opening float', drawer.openingFloat, 'base'],
    ['Cash sales', drawer.cashSales, 'plus'],
    ['Khata collected in cash', drawer.accountPayments, 'plus'],
    ['Cash put in', drawer.cashIn, 'plus'],
    ['Cash refunds', drawer.cashRefunds, 'minus'],
    ['Cash taken out', drawer.cashOut, 'minus'],
  ];
  return (
    <div className="grid grid-sidebar">
      <Card
        title={drawer.status === 'OPEN' ? 'Drawer is open' : 'Waiting for variance approval'}
        description={`Opened ${formatDateTime(drawer.openedAt)} by ${drawer.cashierName}`}
        actions={
          <Badge tone={drawer.status === 'OPEN' ? 'success' : 'warning'}>
            {drawer.status === 'OPEN' ? 'Open' : 'Closing'}
          </Badge>
        }
      >
        <div className="ledger-list">
          {lines.map(([label, value, kind]) => (
            <div className="ledger-line" key={label}>
              <span>{label}</span>
              <strong className={kind === 'minus' && !isZero(value) ? 'text-danger' : undefined}>
                {kind === 'minus' && !isZero(value)
                  ? '− '
                  : kind === 'plus' && !isZero(value)
                    ? '+ '
                    : ''}
                {formatMoney(value)}
              </strong>
            </div>
          ))}
          <div className="ledger-line total">
            <span>Should be in the drawer</span>
            <strong>{formatMoney(drawer.expectedCash)}</strong>
          </div>
        </div>
        {drawer.status === 'CLOSING' ? (
          <div style={{ marginBlockStart: 12 }}>
            <Alert tone="warning" title="Count recorded">
              Counted {formatMoney(drawer.countedCash)}, a difference of{' '}
              {formatMoney(drawer.variance)}. A supervisor must approve it before this drawer is
              closed.
            </Alert>
          </div>
        ) : null}
      </Card>
      <div className="stack">
        <Stat label="Expected cash" icon={Wallet} value={formatMoney(drawer.expectedCash)} />
        <Stat label="Cash sales today" value={formatMoney(drawer.cashSales)} />
        <Stat
          label="Approval threshold"
          value={formatMoney(drawer.varianceApprovalThreshold)}
          hint="Differences larger than this need a supervisor."
        />
      </div>
    </div>
  );
}

const MOVEMENT_REASONS = {
  CASH_IN: ['Change top-up', 'Owner cash added', 'Other'],
  CASH_OUT: ['Bank deposit', 'Supplier payment', 'Petty expense', 'Owner withdrawal', 'Other'],
} as const;

function MovementDialog({
  drawer,
  onClose,
  onDone,
}: {
  readonly drawer: CashSessionSummary;
  readonly onClose: () => void;
  readonly onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const amountInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_OUT');
  const [amount, setAmount] = useState('');
  const [reasonChoice, setReasonChoice] = useState<string>(MOVEMENT_REASONS.CASH_OUT[0]);
  const [details, setDetails] = useState('');
  const [requestId, renew] = useRequestId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const reason = [reasonChoice === 'Other' ? '' : reasonChoice, details.trim()]
    .filter(Boolean)
    .join(': ');
  const valid = validMoney(amount) && !isZero(amount) && reason.length >= 3;
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await addCashMovement(drawer.id, {
        amount: amount.trim(),
        clientRequestId: requestId,
        movementType: type,
        reason,
      });
      toast.success(
        type === 'CASH_IN' ? 'Cash added to drawer' : 'Cash taken out of drawer',
        formatMoney(amount),
      );
      await onDone();
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const change = (apply: () => void): void => {
    apply();
    renew();
  };
  return (
    <Dialog
      title="Cash in / out"
      description="Every movement is recorded against your name with its reason."
      size="sm"
      initialFocus={amountInput}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Record
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <Segmented
          label="Direction"
          value={type}
          onChange={(next) =>
            change(() => {
              setType(next);
              setReasonChoice(MOVEMENT_REASONS[next][0]);
            })
          }
          options={[
            { label: 'Take cash out', value: 'CASH_OUT' },
            { label: 'Put cash in', value: 'CASH_IN' },
          ]}
        />
        <Field label="Amount">
          <MoneyInput
            ref={amountInput}
            className="input-lg"
            value={amount}
            onChange={(event) => change(() => setAmount(event.target.value))}
          />
        </Field>
        <Field label="Reason">
          <select
            className="select"
            value={reasonChoice}
            onChange={(event) => change(() => setReasonChoice(event.target.value))}
          >
            {MOVEMENT_REASONS[type].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </Field>
        <Field
          label={reasonChoice === 'Other' ? 'Describe the reason' : 'Details'}
          optional={reasonChoice !== 'Other'}
        >
          <Input
            value={details}
            placeholder="e.g. receipt number or who took it"
            onChange={(event) => change(() => setDetails(event.target.value))}
          />
        </Field>
        {type === 'CASH_OUT' ? (
          <span className="field-hint">
            Drawer should hold {formatMoney(drawer.expectedCash)} before this.
          </span>
        ) : null}
      </div>
    </Dialog>
  );
}

function CloseDialog({
  drawer,
  onClose,
  onDone,
}: {
  readonly drawer: CashSessionSummary;
  readonly onClose: () => void;
  readonly onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [manual, setManual] = useState('');
  const [mode, setMode] = useState<'NOTES' | 'TOTAL'>('NOTES');
  const [notes, setNotes] = useState('');
  const [requestId, renew] = useRequestId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const counted = useMemo(() => {
    if (mode === 'TOTAL')
      return validMoney(manual) ? minorUnitsToMoney(moneyToMinorUnits(manual.trim())) : null;
    let total = 0n;
    for (const note of NOTES) {
      const pieces = counts[note]?.trim() ?? '';
      if (!pieces) continue;
      if (!/^\d{1,5}$/.test(pieces)) return null;
      total += BigInt(pieces) * BigInt(note) * 100n;
    }
    return minorUnitsToMoney(total);
  }, [counts, manual, mode]);
  const variance = counted ? difference(counted, drawer.expectedCash) : null;
  const overThreshold = (() => {
    if (!variance) return false;
    try {
      const value = moneyToMinorUnits(variance);
      return (value < 0n ? -value : value) > moneyToMinorUnits(drawer.varianceApprovalThreshold);
    } catch {
      return false;
    }
  })();
  const submit = async (): Promise<void> => {
    if (!counted) return;
    setBusy(true);
    setError(null);
    try {
      const result = await closeCashSession(drawer.id, {
        clientRequestId: requestId,
        countedCash: counted,
        ...(notes.trim() ? { closingNotes: notes.trim() } : {}),
      });
      const difference = result.variance ?? '0.00';
      const balanced = isZero(difference);
      const differenceText = isNegative(difference)
        ? `short by ${formatMoney(difference.slice(1))}`
        : `over by ${formatMoney(difference)}`;
      if (result.status !== 'CLOSED') {
        toast.info('Count recorded', `Drawer is ${differenceText}. A supervisor must approve it.`);
      } else if (balanced) {
        toast.success('Drawer closed', 'The count matches exactly.');
      } else {
        toast.info(
          'Drawer closed with a difference',
          `Drawer is ${differenceText}, within the allowed limit. It is recorded against this shift.`,
        );
      }
      await onDone();
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Count and close the drawer"
      description="Count every note and coin in the drawer, then enter the amount you counted."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="footer-note">
            Expected {formatMoney(drawer.expectedCash)} · threshold{' '}
            {formatMoney(drawer.varianceApprovalThreshold)}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Lock}
            loading={busy}
            disabled={!counted}
            onClick={() => void submit()}
          >
            Submit count
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <Segmented
          label="Counting method"
          value={mode}
          onChange={(next) => {
            setMode(next);
            renew();
          }}
          options={[
            { label: 'Count by notes', value: 'NOTES' },
            { label: 'Enter total', value: 'TOTAL' },
          ]}
        />
        {mode === 'NOTES' ? (
          <div className="denominations">
            {NOTES.map((note) => {
              const pieces = counts[note] ?? '';
              const lineTotal = /^\d{1,5}$/.test(pieces) ? String(Number(pieces) * note) : '0';
              return (
                <div className="denomination" key={note}>
                  <span>
                    <Calculator aria-hidden width={14} height={14} /> Rs {note}
                  </span>
                  <input
                    className="input"
                    inputMode="numeric"
                    aria-label={`Number of Rs ${String(note)} notes or coins`}
                    value={pieces}
                    onChange={(event) => {
                      setCounts((current) => ({ ...current, [note]: event.target.value }));
                      renew();
                    }}
                  />
                  <span>{formatMoney(lineTotal)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <Field label="Counted cash">
            <MoneyInput
              className="input-lg"
              value={manual}
              onChange={(event) => {
                setManual(event.target.value);
                renew();
              }}
            />
          </Field>
        )}
        <div className="kv-grid">
          <div className="kv">
            <span>Counted</span>
            <strong>{formatMoney(counted)}</strong>
          </div>
          <div className="kv">
            <span>Expected</span>
            <strong>{formatMoney(drawer.expectedCash)}</strong>
          </div>
          <div className="kv">
            <span>Difference</span>
            <strong className={variance && isNegative(variance) ? 'text-danger' : 'text-success'}>
              {formatMoney(variance)}
            </strong>
          </div>
        </div>
        {overThreshold ? (
          <Alert tone="warning">
            The difference is above the approval threshold. The drawer will wait for a supervisor to
            approve it; add a note explaining the difference.
          </Alert>
        ) : null}
        <Field label="Notes" optional>
          <Textarea
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              renew();
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function ApproveDialog({
  drawer,
  onClose,
  onDone,
}: {
  readonly drawer: CashSessionSummary;
  readonly onClose: () => void;
  readonly onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [requestId] = useRequestId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await approveCashVariance(drawer.id, notes.trim(), requestId);
      toast.success('Variance approved', `${drawer.cashierName}'s drawer is closed.`);
      await onDone();
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Approve ${drawer.cashierName}'s difference`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={ArrowUpFromLine}
            loading={busy}
            disabled={notes.trim().length < 3}
            onClick={() => void submit()}
          >
            Approve
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <dl className="detail-list">
          <dt>Expected</dt>
          <dd>{formatMoney(drawer.expectedCash)}</dd>
          <dt>Counted</dt>
          <dd>{formatMoney(drawer.countedCash)}</dd>
          <dt>Difference</dt>
          <dd className={isNegative(drawer.variance) ? 'text-danger' : 'text-success'}>
            {formatMoney(drawer.variance)}
          </dd>
          <dt>Cashier note</dt>
          <dd>{drawer.closingNotes ?? '—'}</dd>
        </dl>
        <Field label="Your approval note" hint="Why the difference is accepted.">
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
