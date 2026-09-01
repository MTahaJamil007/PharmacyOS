import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getOwnerDashboard } from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';

function recentDates(days: number): string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (days - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

export function OwnerDashboard(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const dates = recentDates(7);
  const dashboard = useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: () => getOwnerDashboard(token),
    refetchInterval: 60_000,
  });
  const trend = useQuery({
    queryKey: ['owner-dashboard-trend', dates],
    queryFn: async () =>
      Promise.all(dates.map(async (date) => (await getOwnerDashboard(token, date)).data)),
  });
  const snapshot = dashboard.data?.data;
  const chartData = (trend.data ?? [])
    .filter((item) => item !== null)
    .map((item) => ({
      date: item.metricDate.slice(5),
      sales: Number(item.netSales),
      profit: Number(item.grossProfitEstimate),
    }));
  const movers = (snapshot?.metrics.topMovers ?? []).map((item) => ({
    ...item,
    quantityValue: Number(item.quantity),
  }));
  const backup = snapshot?.metrics.lastSuccessfulBackup;
  const restore = snapshot?.metrics.lastRestoreDrill;

  return (
    <main className="operations-canvas owner-dashboard">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">
            Deterministic owner ledger · {snapshot?.metricDate ?? 'awaiting refresh'}
          </p>
          <h1>Know the day before asking why.</h1>
          <p>
            Financial cards remain authoritative with AI disabled. Snapshots refresh hourly through
            the durable worker.
          </p>
        </div>
        <span className={snapshot ? 'snapshot-status ready' : 'snapshot-status'}>
          {snapshot
            ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString('en-PK')}`
            : 'Worker refresh pending'}
        </span>
      </section>
      {dashboard.error ? <p className="inline-error">Dashboard metrics are unavailable.</p> : null}
      {snapshot ? (
        <>
          <section className="metric-ledger" aria-label="Daily owner metrics">
            {[
              ['Net sales', snapshot.netSales, 'money'],
              ['Gross profit', snapshot.grossProfitEstimate, 'money'],
              ['Receivables', snapshot.metrics.receivables, 'money'],
              ['Cash collected', snapshot.cashCollected, 'money'],
              ['Refunds', snapshot.refunds, 'money'],
              ['Invoices', snapshot.invoiceCount, 'count'],
              ['Expiry risk', snapshot.metrics.expiryValueAtRisk, 'money'],
              ['Dead stock', snapshot.metrics.deadStockValue, 'money'],
              ['Low stock', String(snapshot.metrics.lowStockCount), 'count'],
              ['Fiscal failures', String(snapshot.metrics.failedFiscalSubmissions), 'count'],
              ['Cash variance', snapshot.metrics.netCashVariance, 'money'],
              ['Non-cash', snapshot.nonCashCollected, 'money'],
            ].map(([label, value, kind]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{kind === 'money' ? formatPkrMoney(value) : value}</strong>
              </article>
            ))}
          </section>
          <section className="dashboard-charts">
            <article className="work-panel chart-panel">
              <header>
                <div>
                  <p className="eyebrow">Seven-day trace</p>
                  <h2>Sales and gross profit</h2>
                </div>
              </header>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ left: 4, right: 18, top: 12, bottom: 4 }}>
                  <CartesianGrid stroke="#dce5e1" vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={70} />
                  <Tooltip formatter={(value) => formatPkrMoney(String(value))} />
                  <Line dataKey="sales" stroke="#0b6b5e" strokeWidth={3} dot={false} />
                  <Line dataKey="profit" stroke="#f2b544" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </article>
            <article className="work-panel chart-panel">
              <header>
                <div>
                  <p className="eyebrow">Today</p>
                  <h2>Top movers</h2>
                </div>
              </header>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={movers}
                  layout="vertical"
                  margin={{ left: 24, right: 18, top: 12, bottom: 4 }}
                >
                  <CartesianGrid stroke="#dce5e1" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={110}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip />
                  <Bar dataKey="quantityValue" fill="#0b6b5e" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </article>
          </section>
          <section className="continuity-strip">
            <article>
              <span>Last successful backup</span>
              <strong>
                {backup?.finishedAt
                  ? new Date(backup.finishedAt).toLocaleString('en-PK')
                  : 'No evidence'}
              </strong>
            </article>
            <article>
              <span>Last restore drill</span>
              <strong>
                {restore?.finishedAt
                  ? new Date(restore.finishedAt).toLocaleString('en-PK')
                  : 'No evidence'}
              </strong>
            </article>
            <article className={snapshot.metrics.failedFiscalSubmissions ? 'critical' : ''}>
              <span>Fiscal queue requiring action</span>
              <strong>{snapshot.metrics.failedFiscalSubmissions}</strong>
            </article>
          </section>
        </>
      ) : (
        <p className="empty-state">
          No snapshot exists for today yet. The durable worker will create it without blocking
          counter sales.
        </p>
      )}
    </main>
  );
}
