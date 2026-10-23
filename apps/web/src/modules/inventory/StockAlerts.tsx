import { useQuery, useQueryClient } from '@tanstack/react-query';
import { featureDefinition, PERMISSIONS, sumMoney, type FeatureKey } from '@pharmacy/shared';
import { useRef, useState } from 'react';

import { getExpiringStock, getLowStock, getStuckStock, updateFeatureSettings } from '../../api';
import { useFeatures } from '../../features';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';
import { printElementInBrowser } from '../invoice/printers';

type AlertKind = 'low' | 'stuck' | 'expiring';

function identity(row: {
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
}): string {
  return [row.name, row.strength, row.dosageForm].filter(Boolean).join(' ');
}

function whole(value: string): string {
  return value.replace(/\.0+$/, '');
}

/**
 * A number the shop owner tunes in place ("not sold for 90 days"). It is checked against the
 * feature's allowed range by the server, so a slip cannot set an absurd window.
 */
export function SettingField({
  feature,
  setting,
  value,
}: {
  readonly feature: FeatureKey;
  readonly setting: string;
  readonly value: number;
}): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const canTune = session?.user.permissions.includes(PERMISSIONS.SETTINGS_MANAGE_SYSTEM) ?? false;
  const queryClient = useQueryClient();
  const definition = featureDefinition(feature).settings.find((item) => item.key === setting);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!definition) return <></>;
  if (!canTune) {
    return (
      <span className="setting-readout">
        {definition.label} <b>{value}</b> {definition.unit}
      </span>
    );
  }
  const save = async () => {
    const next = Number(text);
    if (text === null || !Number.isInteger(next) || next === value) {
      setText(null);
      return;
    }
    try {
      await updateFeatureSettings(token, feature, { [setting]: next });
      setError('');
      setText(null);
      await queryClient.invalidateQueries({ queryKey: ['shop-features'] });
      await queryClient.invalidateQueries({ queryKey: ['stock-alerts'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Not saved');
    }
  };
  return (
    <label className="setting-field">
      <span>{definition.label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={definition.min}
        max={definition.max}
        value={text ?? String(value)}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save();
        }}
      />
      <span>{definition.unit}</span>
      {error ? <em role="alert">{error}</em> : null}
    </label>
  );
}

export function StockAlerts(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const features = useFeatures();
  const printable = useRef<HTMLDivElement>(null);
  const kinds = (
    [
      ['low', 'Running low', features.LOW_STOCK.enabled],
      ['expiring', 'Expiring', features.EXPIRY_ALERTS.enabled],
      ['stuck', 'Not selling', features.STUCK_STOCK.enabled],
    ] as const
  ).filter(([, , enabled]) => enabled);
  const [chosen, setChosen] = useState<AlertKind>('low');
  const kind = kinds.some(([key]) => key === chosen) ? chosen : (kinds[0]?.[0] ?? 'low');
  const low = useQuery({
    queryKey: ['stock-alerts', 'low'],
    queryFn: () => getLowStock(token),
    enabled: kind === 'low' && features.LOW_STOCK.enabled,
  });
  const stuck = useQuery({
    queryKey: ['stock-alerts', 'stuck'],
    queryFn: () => getStuckStock(token),
    enabled: kind === 'stuck' && features.STUCK_STOCK.enabled,
  });
  const expiring = useQuery({
    queryKey: ['stock-alerts', 'expiring'],
    queryFn: () => getExpiringStock(token),
    enabled: kind === 'expiring' && features.EXPIRY_ALERTS.enabled,
  });
  const active = kind === 'low' ? low : kind === 'stuck' ? stuck : expiring;
  if (kinds.length === 0) {
    return <p className="empty-state">Stock alerts are not switched on for this shop.</p>;
  }
  const stuckValue = sumMoney((stuck.data?.data ?? []).map((row) => row.value));
  return (
    <section className="stock-alerts" aria-label="Stock alerts">
      <div className="alerts-bar">
        <div className="segmented" role="group" aria-label="Which alert">
          {kinds.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={kind === key}
              onClick={() => setChosen(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {kind === 'low' && low.data ? (
          <>
            <SettingField feature="LOW_STOCK" setting="coverDays" value={low.data.coverDays} />
            <SettingField
              feature="LOW_STOCK"
              setting="lookbackDays"
              value={low.data.lookbackDays}
            />
          </>
        ) : null}
        {kind === 'stuck' && stuck.data ? (
          <SettingField feature="STUCK_STOCK" setting="days" value={stuck.data.days} />
        ) : null}
        {kind === 'expiring' && expiring.data ? (
          <SettingField feature="EXPIRY_ALERTS" setting="days" value={expiring.data.days} />
        ) : null}
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            if (printable.current) printElementInBrowser(printable.current, 'A4');
          }}
        >
          Print list
        </button>
      </div>
      {active.error ? (
        <p className="inline-error">
          {active.error instanceof Error ? active.error.message : 'Could not load the list'}
        </p>
      ) : null}
      {active.isLoading ? <p className="planner-hint">Loading…</p> : null}
      <div ref={printable} className="alert-table-wrap">
        {kind === 'low' && low.data ? (
          low.data.data.length === 0 ? (
            <p className="planner-ok">✓ Nothing is running low.</p>
          ) : (
            <table className="alert-table">
              <caption>Running low: less than {low.data.coverDays} days of stock</caption>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>In stock</th>
                  <th>Sells a day</th>
                  <th>Days left</th>
                  <th>Order (packs)</th>
                </tr>
              </thead>
              <tbody>
                {low.data.data.map((row) => (
                  <tr
                    key={row.id}
                    className={row.daysLeft !== null && row.daysLeft <= 2 ? 'urgent' : ''}
                  >
                    <td>
                      <strong>{identity(row)}</strong>
                      <small>{row.manufacturer ?? ''}</small>
                    </td>
                    <td>{whole(row.onHand)}</td>
                    <td>{row.dailySales}</td>
                    <td>{row.daysLeft ?? (row.minimumStock ? 'below minimum' : '—')}</td>
                    <td>
                      <b>{row.suggestedPacks}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
        {kind === 'stuck' && stuck.data ? (
          stuck.data.data.length === 0 ? (
            <p className="planner-ok">✓ Everything has sold in the last {stuck.data.days} days.</p>
          ) : (
            <table className="alert-table">
              <caption>
                Not sold for {stuck.data.days} days · {formatPkrMoney(stuckValue)} tied up
              </caption>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Quantity</th>
                  <th>Money tied up</th>
                  <th>Last sold</th>
                  <th>Nearest expiry</th>
                </tr>
              </thead>
              <tbody>
                {stuck.data.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{identity(row)}</strong>
                      <small>{row.manufacturer ?? ''}</small>
                    </td>
                    <td>{whole(row.quantity)}</td>
                    <td>{formatPkrMoney(row.value)}</td>
                    <td>{row.lastSoldAt ? row.lastSoldAt.slice(0, 10) : 'never'}</td>
                    <td>{row.nearestExpiry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
        {kind === 'expiring' && expiring.data ? (
          expiring.data.data.length === 0 ? (
            <p className="planner-ok">✓ Nothing expires in the next {expiring.data.days} days.</p>
          ) : (
            <table className="alert-table">
              <caption>Expiring within {expiring.data.days} days, most urgent first</caption>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Expires</th>
                  <th>Quantity</th>
                  <th>Value</th>
                  <th>Shelf</th>
                </tr>
              </thead>
              <tbody>
                {expiring.data.data.map((row) => (
                  <tr
                    key={row.batchId}
                    className={row.daysLeft < 0 ? 'expired' : row.daysLeft <= 30 ? 'urgent' : ''}
                  >
                    <td>
                      <strong>{identity(row)}</strong>
                      <small>{row.manufacturer ?? ''}</small>
                    </td>
                    <td>{row.batchNumber}</td>
                    <td>
                      {row.expiryDate}
                      <small>
                        {row.daysLeft < 0
                          ? 'expired: take off the shelf'
                          : row.daysLeft === 0
                            ? 'today'
                            : `${row.daysLeft} days`}
                      </small>
                    </td>
                    <td>{whole(row.quantity)}</td>
                    <td>{formatPkrMoney(row.value)}</td>
                    <td>{row.shelf ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </div>
    </section>
  );
}
