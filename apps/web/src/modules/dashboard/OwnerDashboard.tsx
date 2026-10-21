import { useQuery } from '@tanstack/react-query';
import { moneyToMinorUnits } from '@pharmacy/shared';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  DatabaseBackup,
  HandCoins,
  PackageX,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { getOwnerOverview, type OwnerDashboard as OwnerDashboardData } from '../../api';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  PageHeader,
  Stat,
} from '../../components/ui';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQuantity,
  formatTime,
  isoDateIn,
  isZero,
} from '../../format';
import { useClock } from '../../hooks/useClock';
import { useSession } from '../../hooks/useSession';

/** Brand teal, validated for contrast and chroma against the card surface. */
const SERIES_COLOR = '#138a73';
const GRID_COLOR = '#eaeeee';
const AXIS_COLOR = '#6b7878';

/** Share of a total, as a percentage with one decimal, computed in exact minor units. */
function share(part: string, total: string): string {
  const whole = moneyToMinorUnits(total);
  if (whole <= 0n) return '0';
  const tenths = (moneyToMinorUnits(part) * 1000n + whole / 2n) / whole;
  return `${(tenths / 10n).toString()}.${(tenths % 10n).toString()}`;
}

function margin(profit: string, sales: string): string | null {
  return moneyToMinorUnits(sales) > 0n ? share(profit, sales) : null;
}

function shortDay(value: string): string {
  return formatDate(value).slice(0, 6);
}

/** Axis ticks in thousands; the tooltip shows the exact amount. */
function compactRupees(value: number): string {
  if (Math.abs(value) >= 100_000) return `${(value / 100_000).toFixed(1)}L`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

export function OwnerDashboard(): React.JSX.Element {
  const session = useSession();
  const today = isoDateIn(session?.user.branchTimezone);
  const [date, setDate] = useState(today);
  const overview = useQuery({
    queryKey: ['owner-overview', date],
    queryFn: () => getOwnerOverview(date, 14),
    refetchInterval: date === today ? 60_000 : false,
  });
  const data = overview.data;
  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        description={
          data
            ? `${date === today ? 'Today' : formatDate(data.date)} · updated ${formatTime(data.generatedAt)}`
            : 'How the shop is doing'
        }
        actions={
          <>
            <Field label={<span className="sr-only">Business day</span>}>
              <Input
                type="date"
                value={date}
                max={today}
                onChange={(event) => setDate(event.target.value || today)}
              />
            </Field>
            <Button
              icon={RefreshCw}
              loading={overview.isFetching}
              onClick={() => void overview.refetch()}
            >
              Refresh
            </Button>
          </>
        }
      />
      <ErrorAlert error={overview.error} />
      {data ? <DashboardBody data={data} isToday={date === today} /> : null}
      {overview.isLoading ? <div className="skeleton" style={{ height: 320 }} /> : null}
    </div>
  );
}

function DashboardBody({
  data,
  isToday,
}: {
  readonly data: OwnerDashboardData;
  readonly isToday: boolean;
}) {
  const { sales, position, continuity } = data;
  const profitMargin = margin(sales.grossProfit, sales.netSales);
  const trend = data.trend.map((day) => ({
    date: day.date,
    invoices: day.invoiceCount,
    label: shortDay(day.date),
    netSales: Number(day.netSales),
    netSalesText: day.netSales,
  }));
  const paymentMix = [
    { amount: sales.cash, label: 'Cash' },
    { amount: sales.card, label: 'Card' },
    { amount: sales.bankTransfer, label: 'Bank transfer / wallet' },
    { amount: sales.credit, label: 'On account (khata)' },
  ];
  const tendered = paymentMix.reduce((sum, item) => sum + moneyToMinorUnits(item.amount), 0n);
  const tenderedText = `${(tendered / 100n).toString()}.${(tendered % 100n).toString().padStart(2, '0')}`;
  return (
    <div className="stack">
      <Attention data={data} />
      <div className="grid grid-4">
        <Stat
          label="Net sales"
          icon={TrendingUp}
          value={formatMoney(sales.netSales)}
          hint={`${String(sales.invoiceCount)} invoice(s) · average ${formatMoney(sales.averageTicket)}`}
        />
        <Stat
          label="Gross profit"
          icon={Banknote}
          value={formatMoney(sales.grossProfit)}
          hint={
            profitMargin
              ? `${profitMargin}% margin · cost ${formatMoney(sales.costOfGoods)}`
              : 'No sales yet'
          }
          tone={moneyToMinorUnits(sales.grossProfit) < 0n ? 'danger' : undefined}
        />
        <Stat
          label="Discounts and refunds"
          icon={Undo2}
          value={formatMoney(
            (() => {
              const total = moneyToMinorUnits(sales.discounts) + moneyToMinorUnits(sales.refunds);
              return `${(total / 100n).toString()}.${(total % 100n).toString().padStart(2, '0')}`;
            })(),
          )}
          hint={`Discounts ${formatMoney(sales.discounts)} · refunds ${formatMoney(sales.refunds)}`}
        />
        <Stat
          label="Sold on account"
          icon={HandCoins}
          value={formatMoney(sales.credit)}
          hint={`Collected from customers ${formatMoney(sales.creditCollected)}`}
        />
      </div>
      <div className="grid grid-sidebar">
        <Card title="Net sales, last 14 days" description="Bars show each branch business day.">
          {trend.length > 0 ? (
            <div
              className="chart-box"
              role="img"
              aria-label="Net sales per day for the last 14 days"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={trend}
                  margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
                  barCategoryGap="22%"
                >
                  <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: AXIS_COLOR, fontSize: 12 }}
                  />
                  <YAxis
                    tickFormatter={compactRupees}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tick={{ fill: AXIS_COLOR, fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgb(19 138 115 / 8%)' }}
                    content={({ active, payload }) => {
                      const point = active
                        ? (payload[0]?.payload as (typeof trend)[number] | undefined)
                        : undefined;
                      if (!point) return null;
                      return (
                        <div className="chart-tooltip">
                          <strong>{formatDate(point.date)}</strong>
                          <span>{formatMoney(point.netSalesText)} net sales</span>
                          <span>{point.invoices} invoice(s)</span>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="netSales"
                    fill={SERIES_COLOR}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No sales history yet" />
          )}
        </Card>
        <Card
          title="How customers paid"
          description={`${formatMoney(tenderedText)} taken in total`}
        >
          <div className="bar-list">
            {paymentMix.map((item) => {
              const percent = share(item.amount, tenderedText);
              return (
                <div className="bar-item" key={item.label}>
                  <div className="bar-item-label">
                    <span>{item.label}</span>
                    <span className="num">
                      {formatMoney(item.amount)} <span className="muted">· {percent}%</span>
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div className="grid grid-2">
        <Card
          title={isToday ? 'Top sellers today' : `Top sellers on ${formatDate(data.date)}`}
          flush
        >
          <DataTable
            caption="Top selling medicines"
            compact
            rows={data.topItems}
            rowKey={(item) => item.medicineId}
            empty={<EmptyState icon={ReceiptText} title="Nothing sold yet" />}
            columns={[
              {
                header: 'Medicine',
                key: 'name',
                render: (item) => <span className="cell-primary">{item.name}</span>,
              },
              {
                align: 'end',
                header: 'Units',
                key: 'qty',
                render: (item) => formatQuantity(item.quantity),
              },
              {
                align: 'end',
                header: 'Net sales',
                key: 'sales',
                render: (item) => formatMoney(item.netSales),
              },
            ]}
          />
        </Card>
        <Card title="Shop position" description="Right now, regardless of the day selected.">
          <div className="kv-grid">
            <div className="kv">
              <span>Stock value at cost</span>
              <strong>{formatMoney(position.stockValueAtCost)}</strong>
            </div>
            <div className="kv">
              <span>Customers owe (khata)</span>
              <strong>{formatMoney(position.receivables)}</strong>
            </div>
            <div className="kv">
              <span>Value expiring soon</span>
              <strong className={isZero(position.expiryValueAtRisk) ? undefined : 'text-warning'}>
                {formatMoney(position.expiryValueAtRisk)}
              </strong>
            </div>
            <div className="kv">
              <span>Low stock items</span>
              <strong className={position.lowStockCount ? 'text-warning' : undefined}>
                {position.lowStockCount}
              </strong>
            </div>
            <div className="kv">
              <span>Out of stock items</span>
              <strong className={position.outOfStockCount ? 'text-danger' : undefined}>
                {position.outOfStockCount}
              </strong>
            </div>
            <div className="kv">
              <span>Cash drawers open</span>
              <strong>{position.openCashSessions}</strong>
            </div>
            <div className="kv">
              <span>Last backup</span>
              <strong>
                {continuity.lastSuccessfulBackupAt
                  ? formatDateTime(continuity.lastSuccessfulBackupAt)
                  : 'Never'}
              </strong>
            </div>
            <div className="kv">
              <span>Last restore drill</span>
              <strong>
                {continuity.lastRestoreDrillAt
                  ? formatDate(continuity.lastRestoreDrillAt)
                  : 'Never'}
              </strong>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

const BACKUP_STALE_MS = 26 * 60 * 60 * 1000;

function Attention({ data }: { readonly data: OwnerDashboardData }) {
  const navigate = useNavigate();
  const now = useClock();
  const { position, continuity } = data;
  const lastBackup = continuity.lastSuccessfulBackupAt
    ? Date.parse(continuity.lastSuccessfulBackupAt)
    : null;
  const backupStale = lastBackup === null || now.getTime() - lastBackup > BACKUP_STALE_MS;
  const items: Array<{
    readonly key: string;
    readonly tone: 'warning' | 'danger';
    readonly icon: typeof AlertTriangle;
    readonly text: string;
    readonly action?: { readonly label: string; readonly to: string };
  }> = [];
  if (backupStale) {
    items.push({
      icon: DatabaseBackup,
      key: 'backup',
      text:
        lastBackup === null
          ? 'No successful backup has been recorded. Data loss would be permanent.'
          : `The last successful backup was ${formatDateTime(continuity.lastSuccessfulBackupAt)} — more than a day ago.`,
      tone: 'danger',
      action: { label: 'Check backups', to: '/operations' },
    });
  }
  if (position.pendingVariances > 0) {
    items.push({
      action: { label: 'Review', to: '/cash' },
      icon: Wallet,
      key: 'variance',
      text: `${String(position.pendingVariances)} closed drawer(s) have a cash difference waiting for approval.`,
      tone: 'warning',
    });
  }
  if (position.pendingReturns > 0) {
    items.push({
      action: { label: 'Open returns', to: '/returns' },
      icon: Undo2,
      key: 'returns',
      text: `${String(position.pendingReturns)} return(s) are waiting for approval or refund.`,
      tone: 'warning',
    });
  }
  if (position.failedFiscalSubmissions > 0) {
    items.push({
      action: { label: 'Fix', to: '/operations' },
      icon: AlertTriangle,
      key: 'fiscal',
      text: `${String(position.failedFiscalSubmissions)} invoice(s) failed to reach FBR.`,
      tone: 'danger',
    });
  }
  if (position.openAlerts > 0) {
    items.push({
      action: { label: 'View', to: '/operations' },
      icon: AlertTriangle,
      key: 'alerts',
      text: `${String(position.openAlerts)} system alert(s) are open.`,
      tone: 'warning',
    });
  }
  if (position.outOfStockCount > 0) {
    items.push({
      action: { label: 'See stock', to: '/inventory' },
      icon: PackageX,
      key: 'out',
      text: `${String(position.outOfStockCount)} medicine(s) you normally stock are out.`,
      tone: 'warning',
    });
  }
  if (!isZero(position.expiryValueAtRisk)) {
    items.push({
      action: { label: 'Expiry list', to: '/inventory' },
      icon: CalendarClock,
      key: 'expiry',
      text: `${formatMoney(position.expiryValueAtRisk)} of stock is inside the expiry warning window.`,
      tone: 'warning',
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.slice(0, 4).map((item) => (
        <Alert
          key={item.key}
          tone={item.tone}
          actions={
            item.action ? (
              <Button size="sm" onClick={() => void navigate(item.action?.to ?? '/')}>
                {item.action.label}
              </Button>
            ) : undefined
          }
        >
          {item.text}
        </Alert>
      ))}
    </div>
  );
}
