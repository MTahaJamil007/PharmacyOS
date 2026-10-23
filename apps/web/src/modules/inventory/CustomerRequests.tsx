import { useQuery } from '@tanstack/react-query';

import { getCustomerRequests } from '../../api';
import { usePharmacyStore } from '../../store';
import { SettingField } from './StockAlerts';

function whole(value: string): string {
  return value.replace(/\.0+$/, '');
}

/** What customers asked for that the shop did not have, most asked first. */
export function CustomerRequests(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const requests = useQuery({
    queryKey: ['stock-alerts', 'customer-requests'],
    queryFn: () => getCustomerRequests(token),
  });
  const data = requests.data;
  return (
    <section className="stock-alerts" aria-label="Customer requests">
      <div className="alerts-bar">
        {data ? (
          <>
            <SettingField feature="CUSTOMER_REQUESTS" setting="reportDays" value={data.days} />
            <SettingField
              feature="CUSTOMER_REQUESTS"
              setting="minimumRequests"
              value={data.minimum}
            />
          </>
        ) : null}
      </div>
      {requests.error ? (
        <p className="inline-error">
          {requests.error instanceof Error ? requests.error.message : 'Could not load requests'}
        </p>
      ) : null}
      {data && data.data.length === 0 ? (
        <p className="planner-ok">
          No medicine was asked for {data.minimum} or more times in the last {data.days} days.
        </p>
      ) : null}
      {data && data.data.length > 0 ? (
        <table className="alert-table">
          <caption>
            Asked for at least {data.minimum} times in the last {data.days} days. Order taker marks
            these at the counter.
          </caption>
          <thead>
            <tr>
              <th>Medicine asked for</th>
              <th>Times</th>
              <th>Last asked</th>
              <th>In stock now</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((row) => (
              <tr
                key={row.medicineId ?? `name:${row.requestedName}`}
                className={row.medicineId ? '' : 'not-in-catalog'}
              >
                <td>
                  <strong>
                    {[row.requestedName, row.strength, row.dosageForm].filter(Boolean).join(' ')}
                  </strong>
                  <small>
                    {row.medicineId ? (row.manufacturer ?? '') : 'Not in the catalogue yet'}
                  </small>
                </td>
                <td>
                  <b>{row.times}</b>
                </td>
                <td>{row.lastAsked.slice(0, 10)}</td>
                <td>{row.medicineId ? whole(row.onHand) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
