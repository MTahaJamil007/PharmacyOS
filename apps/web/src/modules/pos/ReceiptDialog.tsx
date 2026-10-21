import type { SaleReceipt } from '@pharmacy/shared';
import { Printer, Usb } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Alert, Button, Dialog } from '../../components/ui';
import { formatDateTime, formatMoney, formatQuantity, humanize, isZero } from '../../format';
import { printEscPosReceipt } from './printer';

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Bank / wallet',
  CARD: 'Card',
  CASH: 'Cash',
  CREDIT: 'Khata',
};

export function ReceiptView({
  receipt,
  qrUrl,
}: {
  readonly receipt: SaleReceipt;
  readonly qrUrl: string;
}) {
  const { sale } = receipt;
  return (
    <article className="receipt" aria-label={`Receipt ${sale.invoice_number}`}>
      <div className="receipt-center">
        <h3>{sale.branch_name}</h3>
        {sale.branch_address ? <div>{sale.branch_address}</div> : null}
        {sale.branch_phone ? <div>Tel {sale.branch_phone}</div> : null}
        {sale.seller_ntn_cnic ? <div>NTN {sale.seller_ntn_cnic}</div> : null}
        {sale.seller_strn ? <div>STRN {sale.seller_strn}</div> : null}
      </div>
      <hr />
      <table>
        <tbody>
          <tr>
            <td>Invoice</td>
            <td>
              <strong>{sale.invoice_number}</strong>
            </td>
          </tr>
          <tr>
            <td>Date</td>
            <td>{formatDateTime(sale.created_at)}</td>
          </tr>
          <tr>
            <td>Cashier</td>
            <td>{sale.cashier_name}</td>
          </tr>
          {sale.customer_name ? (
            <tr>
              <td>Customer</td>
              <td>{sale.customer_name}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <hr />
      <table>
        <tbody>
          {receipt.items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.name} {item.strength ?? ''}
                <div className="line-meta">
                  {formatQuantity(item.quantity)} ×{' '}
                  {formatMoney(item.unit_price, { symbol: false })}
                  {!isZero(item.discount_amount)
                    ? ` − ${formatMoney(item.discount_amount, { symbol: false })}`
                    : ''}
                  {' · '}B {item.batch_number} · Exp {item.expiry_date.slice(0, 7)}
                </div>
              </td>
              <td>{formatMoney(item.line_total, { symbol: false })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <table>
        <tbody>
          <tr>
            <td>Subtotal</td>
            <td>{formatMoney(sale.subtotal, { symbol: false })}</td>
          </tr>
          {!isZero(sale.discount_total) ? (
            <tr>
              <td>Discount</td>
              <td>−{formatMoney(sale.discount_total, { symbol: false })}</td>
            </tr>
          ) : null}
          <tr className="total-row">
            <td>TOTAL Rs</td>
            <td>{formatMoney(sale.total, { symbol: false })}</td>
          </tr>
          {!isZero(sale.tax_total) ? (
            <tr>
              <td>Sales tax included</td>
              <td>{formatMoney(sale.tax_total, { symbol: false })}</td>
            </tr>
          ) : null}
          {receipt.payments.map((payment, index) => (
            <tr key={`${payment.method}-${String(index)}`}>
              <td>
                {METHOD_LABELS[payment.method] ?? humanize(payment.method)}
                {payment.tendered_amount && payment.method === 'CASH'
                  ? ` (given ${formatMoney(payment.tendered_amount, { symbol: false })})`
                  : ''}
              </td>
              <td>{formatMoney(payment.amount, { symbol: false })}</td>
            </tr>
          ))}
          {receipt.payments.map((payment, index) =>
            payment.change_amount && !isZero(payment.change_amount) ? (
              <tr key={`change-${String(index)}`}>
                <td>Change</td>
                <td>{formatMoney(payment.change_amount, { symbol: false })}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
      <hr />
      <div className="receipt-center">
        {qrUrl ? <img src={qrUrl} alt="Return lookup code" /> : null}
        <div>Keep this receipt for any return.</div>
        {sale.fiscal_invoice_number ? <div>FBR invoice {sale.fiscal_invoice_number}</div> : null}
        {sale.pos_registration_number ? <div>POS ID {sale.pos_registration_number}</div> : null}
        <div>Thank you</div>
      </div>
    </article>
  );
}

export function ReceiptDialog({
  onClose,
  receipt,
}: {
  readonly onClose: () => void;
  readonly receipt: SaleReceipt;
}) {
  const printButton = useRef<HTMLButtonElement>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [printerStatus, setPrinterStatus] = useState<{
    tone: 'info' | 'danger' | 'success';
    text: string;
  } | null>(null);
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
        if (active)
          setQrError(
            'The return code could not be drawn. The invoice number still works for returns.',
          );
      });
    return () => {
      active = false;
    };
  }, [receipt.returnQrPayload]);

  const directPrint = async (): Promise<void> => {
    setPrinterStatus({ text: 'Connecting to the receipt printer…', tone: 'info' });
    try {
      await printEscPosReceipt(receipt, { kickDrawer: true });
      setPrinterStatus({ text: 'Receipt printed and cash drawer opened.', tone: 'success' });
    } catch (cause) {
      setPrinterStatus({
        text: cause instanceof Error ? cause.message : 'Direct printing failed',
        tone: 'danger',
      });
    }
  };

  return (
    <Dialog
      title={`Sale complete · ${formatMoney(receipt.sale.total)}`}
      description={`Invoice ${receipt.sale.invoice_number}`}
      size="md"
      initialFocus={printButton}
      onClose={onClose}
      footer={
        <>
          <Button icon={Usb} onClick={() => void directPrint()}>
            Thermal printer + drawer
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>New sale</Button>
          <Button ref={printButton} variant="primary" icon={Printer} onClick={() => window.print()}>
            Print receipt
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {qrError ? <Alert tone="warning">{qrError}</Alert> : null}
        {printerStatus ? <Alert tone={printerStatus.tone}>{printerStatus.text}</Alert> : null}
        <div className="receipt-preview">
          <ReceiptView receipt={receipt} qrUrl={qrUrl} />
        </div>
      </div>
    </Dialog>
  );
}
