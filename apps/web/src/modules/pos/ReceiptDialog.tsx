import { useEffect, useRef, useState } from 'react';
import type { SaleReceipt } from '@pharmacy/shared';

import { useDialogFocus } from '../../hooks/useDialogFocus';
import { formatPkrMoney } from '../../money';
import { printEscPosReceipt } from './printer';

export function ReceiptDialog({
  onClose,
  receipt,
}: {
  readonly onClose: () => void;
  readonly receipt: SaleReceipt;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const printButton = useRef<HTMLButtonElement>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [printerStatus, setPrinterStatus] = useState('');
  useDialogFocus(dialog, printButton, onClose);
  useEffect(() => {
    let active = true;
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(receipt.returnQrPayload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 220,
        }),
      )
      .then((url) => {
        if (active) setQrUrl(url);
      })
      .catch(() => {
        if (active) setQrError('Return QR could not be generated. Reprint before handing over.');
      });
    return () => {
      active = false;
    };
  }, [receipt.returnQrPayload]);

  const directPrint = async (): Promise<void> => {
    setPrinterStatus('Connecting to receipt printer…');
    try {
      await printEscPosReceipt(receipt, { kickDrawer: true });
      setPrinterStatus('Receipt printed and cash drawer opened.');
    } catch (cause) {
      setPrinterStatus(cause instanceof Error ? cause.message : 'Direct receipt printing failed');
    }
  };

  return (
    <div
      ref={dialog}
      className="receipt-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Sale receipt"
    >
      <article className="printable-receipt">
        <header>
          <strong>{receipt.sale.branch_name}</strong>
          <span>{receipt.sale.branch_address}</span>
          <span>{receipt.sale.branch_phone}</span>
        </header>
        <div className="receipt-identifiers">
          <b>{receipt.sale.invoice_number}</b>
          <span>{new Date(receipt.sale.created_at).toLocaleString('en-PK')}</span>
          <span>Cashier: {receipt.sale.cashier_name}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.name} {item.strength}
                  <small>
                    Batch {item.batch_number} · exp {item.expiry_date}
                  </small>
                </td>
                <td>{item.quantity}</td>
                <td>{formatPkrMoney(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatPkrMoney(receipt.sale.subtotal)}</dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>{formatPkrMoney(receipt.sale.discount_total)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatPkrMoney(receipt.sale.total)}</dd>
          </div>
          {receipt.payments.map((payment, index) => (
            <div key={`${payment.method}-${index}`}>
              <dt>{payment.method}</dt>
              <dd>{formatPkrMoney(payment.amount)}</dd>
            </div>
          ))}
          {receipt.payments.map((payment, index) =>
            payment.change_amount && payment.change_amount !== '0.00' ? (
              <div key={`change-${index}`}>
                <dt>Change</dt>
                <dd>{formatPkrMoney(payment.change_amount)}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <div className="receipt-qr">
          {qrUrl ? <img src={qrUrl} alt="Opaque return lookup token" /> : null}
          {qrError ? (
            <p className="inline-error" role="alert">
              {qrError}
            </p>
          ) : null}
          <strong>Scan for an authorized return lookup</strong>
          <small>No customer, medicine, or payment data is stored in this QR.</small>
        </div>
        <footer>
          <span>Fiscal status: {receipt.sale.fiscal_status}</span>
          {receipt.sale.fiscal_invoice_number ? (
            <span>Fiscal invoice: {receipt.sale.fiscal_invoice_number}</span>
          ) : null}
        </footer>
      </article>
      {printerStatus ? (
        <p className="printer-status" role="status">
          {printerStatus}
        </p>
      ) : null}
      <div className="receipt-controls">
        <button className="secondary-button" onClick={onClose}>
          Close
        </button>
        <button className="secondary-button" onClick={() => window.print()}>
          Browser print
        </button>
        <button ref={printButton} className="primary-button" onClick={() => void directPrint()}>
          Print + open drawer
        </button>
      </div>
    </div>
  );
}
