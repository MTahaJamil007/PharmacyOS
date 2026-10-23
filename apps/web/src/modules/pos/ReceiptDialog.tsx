import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SaleReceipt } from '@pharmacy/shared';

import { getSaleReceipt } from '../../api';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { InvoiceDocument } from '../invoice/InvoiceDocument';
import { buildInvoiceModel } from '../invoice/invoice-model';
import { PrinterSetup } from '../invoice/PrinterSetup';
import {
  loadPrinterProfile,
  printElementInBrowser,
  printInvoice,
  PRINTER_METHOD_LABELS,
  type PrinterProfile,
} from '../invoice/printers';

const FBR_IN_FLIGHT = ['PENDING', 'VALIDATING', 'VALIDATED', 'SUBMITTING'];
const FBR_POLL_MS = 2_000;
const FBR_POLL_LIMIT = 10;

function copyLabel(index: number, copies: number): string | undefined {
  if (copies === 1) return undefined;
  return index === 0 ? 'Customer copy' : index === 1 ? 'Shop copy' : `Copy ${String(index + 1)}`;
}

export function ReceiptDialog({
  onClose,
  receipt: initialReceipt,
  token,
  autoPrint = true,
}: {
  readonly onClose: () => void;
  readonly receipt: SaleReceipt;
  readonly token?: string;
  readonly autoPrint?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const printButton = useRef<HTMLButtonElement>(null);
  const printCopies = useRef<HTMLDivElement>(null);
  const autoPrinted = useRef(false);
  const [receipt, setReceipt] = useState(initialReceipt);
  const [profile, setProfile] = useState<PrinterProfile>(() => loadPrinterProfile());
  const [setupOpen, setSetupOpen] = useState(false);
  const [printerStatus, setPrinterStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [fbrPolls, setFbrPolls] = useState(0);
  useDialogFocus(dialog, printButton, onClose);
  const model = useMemo(() => buildInvoiceModel(receipt), [receipt]);
  const waitingForFbr =
    Boolean(token) &&
    receipt.fbr?.enabled === true &&
    receipt.fbr.invoiceNumber === null &&
    FBR_IN_FLIGHT.includes(receipt.fbr.status) &&
    fbrPolls < FBR_POLL_LIMIT;

  // FBR issues its number moments after the sale; refresh briefly so the first print carries it.
  useEffect(() => {
    if (!waitingForFbr || !token) return;
    const timer = window.setTimeout(() => {
      void getSaleReceipt(token, receipt.sale.id)
        .then((next) => setReceipt(next))
        .catch(() => undefined)
        .finally(() => setFbrPolls((count) => count + 1));
    }, FBR_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [receipt, token, waitingForFbr]);

  const print = useCallback(
    async (active: PrinterProfile): Promise<void> => {
      setBusy(true);
      setPrinterStatus(
        active.method === 'BROWSER' ? 'Opening the print dialog…' : 'Sending to the printer…',
      );
      try {
        setPrinterStatus(
          await printInvoice(model, active, {
            token: token ?? '',
            element: printCopies.current,
          }),
        );
      } catch (cause) {
        setPrinterStatus(cause instanceof Error ? cause.message : 'Printing failed');
      } finally {
        setBusy(false);
      }
    },
    [model, token],
  );

  useEffect(() => {
    if (!autoPrint || !profile.autoPrint || autoPrinted.current || waitingForFbr) return;
    autoPrinted.current = true;
    const timer = window.setTimeout(() => void print(profile), 0);
    return () => window.clearTimeout(timer);
  }, [autoPrint, print, profile, waitingForFbr]);

  return (
    <div
      ref={dialog}
      className="receipt-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Sale receipt"
    >
      <div className="receipt-preview">
        <InvoiceDocument model={model} />
      </div>
      <div className="invoice-print-copies" ref={printCopies} aria-hidden="true">
        {Array.from({ length: model.layout.copies }, (_, index) => (
          <InvoiceDocument
            key={index}
            model={model}
            decorative
            copyLabel={copyLabel(index, model.layout.copies)}
          />
        ))}
      </div>
      {waitingForFbr ? (
        <p className="printer-status" role="status">
          Waiting for the FBR invoice number…
        </p>
      ) : receipt.fbr?.enabled && receipt.fbr.invoiceNumber === null ? (
        <p className="inline-error">
          FBR has not confirmed this invoice yet
          {receipt.fbr.lastError ? `: ${receipt.fbr.lastError}` : ''}. It prints as pending; reprint
          it from Receipt search once confirmed.
        </p>
      ) : null}
      {printerStatus ? (
        <p className="printer-status" role="status">
          {printerStatus}
        </p>
      ) : null}
      {setupOpen ? (
        <div className="receipt-printer-setup">
          <PrinterSetup
            onSaved={(next) => {
              setProfile(next);
              setSetupOpen(false);
              setPrinterStatus(`Printer set: ${PRINTER_METHOD_LABELS[next.method]}`);
            }}
          />
        </div>
      ) : null}
      <div className="receipt-controls">
        <button className="secondary-button" onClick={onClose}>
          Close
        </button>
        <button className="secondary-button" onClick={() => setSetupOpen((open) => !open)}>
          Printer setup
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            if (printCopies.current) {
              printElementInBrowser(printCopies.current, model.layout.paperWidth);
            }
          }}
        >
          Browser print
        </button>
        <button
          ref={printButton}
          className="primary-button"
          disabled={busy}
          onClick={() => void print(profile)}
        >
          Print · {PRINTER_METHOD_LABELS[profile.method]}
        </button>
      </div>
    </div>
  );
}
