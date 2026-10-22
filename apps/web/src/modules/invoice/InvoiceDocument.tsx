import { useEffect, useState } from 'react';

import { formatPkrMoney } from '../../money';
import type { InvoiceModel } from './invoice-model';

function useQrDataUrl(payload: string | null): string {
  const [url, setUrl] = useState<{ readonly payload: string; readonly url: string } | null>(null);
  useEffect(() => {
    if (!payload) return;
    let active = true;
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 220 }),
      )
      .then((value) => {
        if (active) setUrl({ payload, url: value });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [payload]);
  return payload && url?.payload === payload ? url.url : '';
}

/**
 * The printable invoice. Sized by the layout's paper width so a 58 mm roll, an 80 mm roll, and an
 * A4 sheet each get a document that fits.
 */
export function InvoiceDocument({
  model,
  copyLabel,
  decorative = false,
}: {
  readonly model: InvoiceModel;
  readonly copyLabel?: string | undefined;
  /** Print-only copies repeat the on-screen invoice, so their images carry no alt text. */
  readonly decorative?: boolean;
}): React.JSX.Element {
  const fbrQr = useQrDataUrl(model.fbr?.qrPayload ?? null);
  const returnQr = useQrDataUrl(model.returnQr);
  const paper = model.layout.paperWidth.toLowerCase();
  const font = model.layout.fontScale.toLowerCase();
  return (
    <article className={`invoice-document paper-${paper} font-${font}`} aria-label="Invoice">
      <header className="invoice-shop">
        <strong>{model.shopName}</strong>
        {model.shopLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
        {model.headerNote ? <em>{model.headerNote}</em> : null}
      </header>
      <h3 className="invoice-title">{model.title}</h3>
      {copyLabel ? <p className="invoice-copy">{copyLabel}</p> : null}
      <dl className="invoice-meta">
        <div>
          <dt>Invoice</dt>
          <dd>{model.invoiceNumber}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{model.issuedAt}</dd>
        </div>
        {model.cashier ? (
          <div>
            <dt>Cashier</dt>
            <dd>{model.cashier}</dd>
          </div>
        ) : null}
        {model.customer ? (
          <div>
            <dt>Customer</dt>
            <dd>{model.customer}</dd>
          </div>
        ) : null}
      </dl>
      <table className="invoice-lines">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Qty</th>
            <th scope="col">Rate</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((line, index) => (
            <tr key={`${line.name}-${String(index)}`}>
              <td>
                <strong>{line.name}</strong>
                {line.batch || line.expiry ? (
                  <small>
                    {[
                      line.batch ? `Batch ${line.batch}` : null,
                      line.expiry ? `Exp ${line.expiry}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                ) : null}
                {line.discount ? <small>Discount −{formatPkrMoney(line.discount)}</small> : null}
                {line.dosage ? (
                  <span className="invoice-dosage">
                    <b>Dose {line.dosage.code}</b>
                    <span>{line.dosage.english}</span>
                    {line.dosage.urdu ? (
                      <span lang="ur" dir="rtl">
                        {line.dosage.urdu}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </td>
              <td>{line.quantity}</td>
              <td>{formatPkrMoney(line.unitPrice).replace('PKR ', '')}</td>
              <td>{formatPkrMoney(line.amount).replace('PKR ', '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="invoice-totals">
        <div>
          <dt>Subtotal ({model.totals.units} units)</dt>
          <dd>{formatPkrMoney(model.totals.subtotal)}</dd>
        </div>
        {model.totals.discount ? (
          <div>
            <dt>Discount</dt>
            <dd>−{formatPkrMoney(model.totals.discount)}</dd>
          </div>
        ) : null}
        {model.totals.tax ? (
          <div>
            <dt>Sales tax (included)</dt>
            <dd>{formatPkrMoney(model.totals.tax)}</dd>
          </div>
        ) : null}
        <div className="invoice-grand-total">
          <dt>Total</dt>
          <dd>{formatPkrMoney(model.totals.total)}</dd>
        </div>
        {model.payments.map((payment, index) => (
          <div key={`${payment.label}-${String(index)}`}>
            <dt>{payment.label}</dt>
            <dd>{formatPkrMoney(payment.amount)}</dd>
          </div>
        ))}
        {model.change ? (
          <div>
            <dt>Change</dt>
            <dd>{formatPkrMoney(model.change)}</dd>
          </div>
        ) : null}
      </dl>
      {model.fbr ? (
        <section className="invoice-fbr" aria-label="FBR invoice">
          <strong>FBR invoice</strong>
          {model.fbr.posRegistrationNumber ? (
            <span>POS ID: {model.fbr.posRegistrationNumber}</span>
          ) : null}
          {model.fbr.invoiceNumber ? (
            <span>FBR No: {model.fbr.invoiceNumber}</span>
          ) : (
            <span>FBR number pending — reprint to verify</span>
          )}
          {fbrQr ? <img src={fbrQr} alt={decorative ? '' : 'FBR invoice QR code'} /> : null}
          {model.fbr.qrPayload ? <small>Verify with the FBR Tax Asaan app</small> : null}
        </section>
      ) : null}
      {model.returnQr ? (
        <section className="invoice-return">
          {returnQr ? (
            <img src={returnQr} alt={decorative ? '' : 'Opaque return lookup token'} />
          ) : null}
          <small>Scan at the counter for returns. The code holds no personal data.</small>
        </section>
      ) : null}
      {model.footerNote ? <footer className="invoice-footer">{model.footerNote}</footer> : null}
    </article>
  );
}
