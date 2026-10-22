import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import {
  DEFAULT_INVOICE_LAYOUT,
  FONT_SCALES,
  invoiceLayoutSchema,
  PAPER_WIDTHS,
  type InvoiceLayout,
} from '@pharmacy/shared';

import { adminGet, adminPut } from '../../api';
import { usePharmacyStore } from '../../store';
import { InvoiceDocument } from '../invoice/InvoiceDocument';
import { buildInvoiceModel, sampleReceipt } from '../invoice/invoice-model';
import { PrinterSetup } from '../invoice/PrinterSetup';
import { loadPrinterProfile, printInvoice, PRINTER_METHOD_LABELS } from '../invoice/printers';
import { invoiceShop, type ShopRecord } from './shop-types';

type BooleanKey = {
  [Key in keyof InvoiceLayout]: InvoiceLayout[Key] extends boolean ? Key : never;
}[keyof InvoiceLayout];

const TOGGLES: ReadonlyArray<readonly [BooleanKey, string]> = [
  ['showAddress', 'Shop address'],
  ['showPhone', 'Shop phone'],
  ['showEmail', 'Shop email'],
  ['showDrugLicense', 'Drug sale license'],
  ['showNtn', 'NTN and STRN'],
  ['showCashier', 'Cashier name'],
  ['showCustomer', 'Customer name'],
  ['showBatch', 'Batch number'],
  ['showExpiry', 'Expiry date'],
  ['showDiscount', 'Line discounts'],
  ['showDosage', 'Medicine timing (1+0+1)'],
  ['showDosageUrdu', 'Timing in Urdu too'],
  ['showTaxSummary', 'Sales tax line'],
  ['showReturnQr', 'Return QR code'],
];

const FONT_LABELS: Record<(typeof FONT_SCALES)[number], string> = {
  SMALL: 'Small',
  NORMAL: 'Normal',
  LARGE: 'Large',
};

interface SavedLayout {
  readonly layout: InvoiceLayout;
  readonly updatedAt: string | null;
}

/** The shop owner designs the invoice and sees exactly what will print before saving. */
export function InvoiceLayoutEditor(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const client = useQueryClient();
  const preview = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<InvoiceLayout | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const saved = useQuery({
    queryKey: ['admin', 'invoice-layout'],
    queryFn: () => adminGet<SavedLayout>(token, '/shop/invoice-layout'),
  });
  const shop = useQuery({
    queryKey: ['admin', 'shop'],
    queryFn: () => adminGet<ShopRecord>(token, '/shop'),
  });
  const savedLayout = saved.data?.layout ?? DEFAULT_INVOICE_LAYOUT;
  const layout = draft ?? savedLayout;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(savedLayout);
  const validation = invoiceLayoutSchema.safeParse(layout);
  const model = useMemo(() => {
    const record = shop.data;
    const receipt = sampleReceipt(
      record
        ? invoiceShop(record)
        : {
            name: 'Your pharmacy',
            address: 'Shop address',
            phone: null,
            email: null,
            drugLicenseNumber: null,
            sellerNtnCnic: null,
            sellerStrn: null,
            businessName: null,
          },
      {
        enabled: record?.fbr.invoicingEnabled ?? false,
        posRegistrationNumber: record?.posRegistrationNumber ?? null,
      },
    );
    return buildInvoiceModel(receipt, layout);
  }, [layout, shop.data]);

  const update = <Key extends keyof InvoiceLayout>(key: Key, value: InvoiceLayout[Key]): void => {
    setMessage('');
    setDraft({ ...layout, [key]: value });
  };

  const save = async (): Promise<void> => {
    if (!validation.success) {
      setMessage('Fix the highlighted fields before saving');
      return;
    }
    setSaving(true);
    try {
      await adminPut(token, '/shop/invoice-layout', validation.data);
      await client.invalidateQueries({ queryKey: ['admin', 'invoice-layout'] });
      setDraft(null);
      setMessage('Invoice layout saved. Every counter prints it from the next invoice.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The layout could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const testPrint = async (): Promise<void> => {
    const profile = loadPrinterProfile();
    try {
      setMessage(await printInvoice(model, profile, { token, element: preview.current }));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Test print failed');
    }
  };

  const fieldError = (key: keyof InvoiceLayout): string | null => {
    if (validation.success) return null;
    const issue = validation.error.issues.find((item) => item.path[0] === key);
    return issue ? issue.message : null;
  };

  return (
    <section className="invoice-editor">
      <article className="work-panel compact-form-panel invoice-controls">
        <header>
          <div>
            <p className="eyebrow">Invoice layout</p>
            <h2>Design the printed invoice</h2>
          </div>
          {saved.data?.updatedAt ? (
            <small>Saved {new Date(saved.data.updatedAt).toLocaleString('en-PK')}</small>
          ) : null}
        </header>
        <div className="form-grid single-column">
          <div className="choice-row" role="group" aria-label="Paper width">
            <span>Paper</span>
            {PAPER_WIDTHS.map((width) => (
              <button
                type="button"
                key={width}
                aria-pressed={layout.paperWidth === width}
                onClick={() => update('paperWidth', width)}
              >
                {width === 'A4' ? 'A4 sheet' : `${width} roll`}
              </button>
            ))}
          </div>
          <div className="choice-row" role="group" aria-label="Text size">
            <span>Text</span>
            {FONT_SCALES.map((scale) => (
              <button
                type="button"
                key={scale}
                aria-pressed={layout.fontScale === scale}
                onClick={() => update('fontScale', scale)}
              >
                {FONT_LABELS[scale]}
              </button>
            ))}
          </div>
          <label>
            Invoice title
            <input
              value={layout.title}
              maxLength={40}
              onChange={(event) => update('title', event.target.value)}
            />
            {fieldError('title') ? (
              <small className="field-error">{fieldError('title')}</small>
            ) : null}
          </label>
          <label>
            Line under the shop name
            <input
              value={layout.headerNote}
              maxLength={160}
              placeholder="e.g. Open 24 hours · Home delivery 0300-0000000"
              onChange={(event) => update('headerNote', event.target.value)}
            />
          </label>
          <label>
            Footer message
            <textarea
              value={layout.footerNote}
              maxLength={240}
              rows={3}
              onChange={(event) => update('footerNote', event.target.value)}
            />
          </label>
          <fieldset className="toggle-grid">
            <legend>Show on the invoice</legend>
            {TOGGLES.map(([key, label]) => (
              <label key={key} className="check-field">
                <input
                  type="checkbox"
                  checked={layout[key]}
                  disabled={key === 'showDosageUrdu' && !layout.showDosage}
                  onChange={(event) => update(key, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <label>
            Copies per sale
            <select
              value={String(layout.copies)}
              onChange={(event) => update('copies', Number(event.target.value))}
            >
              <option value="1">1 (customer)</option>
              <option value="2">2 (customer + shop)</option>
              <option value="3">3</option>
            </select>
          </label>
          {message ? (
            <p
              className={
                /could not|failed|fix|first|cannot/i.test(message)
                  ? 'inline-error'
                  : 'counter-notice'
              }
              role="status"
            >
              {message}
            </p>
          ) : null}
          <div className="editor-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!dirty || saving || !validation.success}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save layout'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!dirty}
              onClick={() => {
                setDraft(null);
                setMessage('');
              }}
            >
              Discard changes
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setDraft(DEFAULT_INVOICE_LAYOUT);
                setMessage('Defaults restored in the preview. Save to keep them.');
              }}
            >
              Restore defaults
            </button>
          </div>
        </div>
      </article>
      <div className="invoice-preview-column">
        <div className="invoice-preview-head">
          <div>
            <p className="eyebrow">Preview {dirty ? '· unsaved changes' : ''}</p>
            <h2>Sample invoice</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void testPrint()}
          >
            Test print · {PRINTER_METHOD_LABELS[loadPrinterProfile().method]}
          </button>
        </div>
        <div className="invoice-preview-frame" ref={preview}>
          <InvoiceDocument model={model} />
        </div>
        <details className="work-panel compact-form-panel printer-details">
          <summary>This counter’s printer</summary>
          <PrinterSetup />
        </details>
      </div>
    </section>
  );
}
