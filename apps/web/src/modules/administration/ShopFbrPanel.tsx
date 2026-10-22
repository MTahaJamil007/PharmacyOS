import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminGet, adminPatch } from '../../api';
import { usePharmacyStore } from '../../store';
import { fbrReadiness, type ShopRecord } from './shop-types';

const PROFILE_FIELDS: ReadonlyArray<readonly [keyof ShopRecord, string]> = [
  ['name', 'Shop name'],
  ['address', 'Address'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['drugLicenseNumber', 'Drug sale license'],
  ['sellerNtnCnic', 'NTN / CNIC'],
  ['sellerStrn', 'STRN'],
  ['businessName', 'FBR registered name'],
  ['province', 'Province'],
  ['posRegistrationNumber', 'FBR POS ID'],
];

/** The shop owner's view: profile (set by the super admin) and the FBR invoicing switch. */
export function ShopFbrPanel(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const shop = useQuery({
    queryKey: ['admin', 'shop'],
    queryFn: () => adminGet<ShopRecord>(token, '/shop'),
  });

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setMessage('');
    try {
      await adminPatch(token, '/shop/fbr-invoicing', { enabled });
      await client.invalidateQueries({ queryKey: ['admin', 'shop'] });
      setMessage(
        enabled
          ? 'FBR invoicing is on. New sales are sent to FBR and print the FBR block and QR.'
          : 'FBR invoicing is off. Invoices print without any FBR block or QR.',
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The FBR switch could not be changed');
    } finally {
      setBusy(false);
    }
  };

  if (shop.isPending) return <p className="empty-state">Loading shop…</p>;
  if (!shop.data) {
    return (
      <p className="inline-error" role="alert">
        The shop profile could not be loaded.
      </p>
    );
  }
  const data = shop.data;
  const enabled = data.fbr.invoicingEnabled;
  const notes = fbrReadiness(data);

  return (
    <section className="shop-settings">
      <article className="work-panel compact-form-panel fbr-switch-panel">
        <header>
          <div>
            <p className="eyebrow">FBR invoicing</p>
            <h2>{enabled ? 'On' : 'Off'}</h2>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="FBR invoicing"
            className={enabled ? 'toggle-switch on' : 'toggle-switch'}
            disabled={busy}
            onClick={() => void toggle(!enabled)}
          >
            <span />
          </button>
        </header>
        <p className="side-hint">
          When on, each sale is recorded for FBR and its invoice prints the FBR POS ID, FBR invoice
          number and FBR QR code. When off, invoices print without any FBR block or QR.
        </p>
        {notes.length > 0 ? (
          <ul className="readiness-list">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : (
          <p className="counter-notice">Registered and approved: invoices get their FBR number.</p>
        )}
        {message ? (
          <p
            className={/could not|needs|first/i.test(message) ? 'inline-error' : 'counter-notice'}
            role="status"
          >
            {message}
          </p>
        ) : null}
      </article>
      <article className="work-panel compact-form-panel">
        <header>
          <div>
            <p className="eyebrow">Printed on every invoice</p>
            <h2>Shop profile</h2>
          </div>
        </header>
        <dl className="profile-list">
          {PROFILE_FIELDS.map(([field, label]) => (
            <div key={field}>
              <dt>{label}</dt>
              <dd>{(data[field] as string | null) ?? '—'}</dd>
            </div>
          ))}
        </dl>
        <p className="side-hint">
          The software owner (super admin) maintains these details. Ask them to correct anything
          here.
        </p>
      </article>
    </section>
  );
}
