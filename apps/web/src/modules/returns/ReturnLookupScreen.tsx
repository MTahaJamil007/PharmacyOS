import { decimalToScaledInteger } from '@pharmacy/shared';
import { useEffect, useRef, useState } from 'react';

import {
  approveReturn,
  getCurrentCashSession,
  lookupReturn,
  refundReturn,
  requestReturn,
  type ReturnCommandResult,
  type ReturnLookup,
} from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';

function isPositiveQuantity(value: string): boolean {
  try {
    return decimalToScaledInteger(value, 3) > 0n;
  } catch {
    return false;
  }
}

export function ReturnLookupScreen(): React.JSX.Element {
  const receiptTokenInput = useRef<HTMLInputElement>(null);
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const [receiptToken, setReceiptToken] = useState('');
  const [result, setResult] = useState<ReturnLookup | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<
    Record<string, 'RESTOCK_SELLABLE' | 'QUARANTINE' | 'SCRAP'>
  >({});
  const [reason, setReason] = useState('');
  const [returnCommand, setReturnCommand] = useState<ReturnCommandResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    receiptTokenInput.current?.focus();
  }, []);

  const lookup = async (): Promise<void> => {
    try {
      setError('');
      const found = await lookupReturn(token, receiptToken.trim());
      setResult(found);
      setReturnCommand(null);
      setQuantities({});
      setDispositions({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Receipt lookup failed');
    }
  };
  const submitRequest = async (): Promise<void> => {
    if (!result) return;
    const items = result.items
      .filter((item) => isPositiveQuantity(quantities[item.id] ?? '0'))
      .map((item) => ({
        saleItemId: item.id,
        quantity: quantities[item.id] ?? '0',
        disposition: dispositions[item.id] ?? 'QUARANTINE',
      }));
    try {
      setWorking(true);
      setError('');
      setReturnCommand(await requestReturn(token, receiptToken.trim(), { reason, items }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Return request failed');
    } finally {
      setWorking(false);
    }
  };
  const approve = async (): Promise<void> => {
    if (!returnCommand) return;
    try {
      setWorking(true);
      setError('');
      setReturnCommand(await approveReturn(token, returnCommand.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Return approval failed');
    } finally {
      setWorking(false);
    }
  };
  const refund = async (): Promise<void> => {
    if (!returnCommand) return;
    try {
      setWorking(true);
      setError('');
      const cashSession = await getCurrentCashSession(token);
      if (!cashSession || cashSession.status !== 'OPEN')
        throw new Error('Open a cash session before issuing a cash refund');
      setReturnCommand(
        await refundReturn(token, returnCommand.id, {
          method: 'CASH',
          cashSessionId: cashSession.id,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refund failed');
    } finally {
      setWorking(false);
    }
  };
  const canApprove = session?.user.permissions.includes('returns.approve') ?? false;
  const canRefund = session?.user.permissions.includes('returns.refund') ?? false;
  return (
    <main className="operations-canvas narrow-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Authenticated receipt scan</p>
          <h1>Return lookup</h1>
          <p>
            The QR carries only an opaque token. Invoice details resolve here after authorization.
          </p>
        </div>
      </section>
      <section className="return-search">
        <label>
          <span>Scan or paste receipt token</span>
          <input
            ref={receiptTokenInput}
            value={receiptToken}
            onChange={(event) => setReceiptToken(event.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </label>
        <button className="primary-button" onClick={() => void lookup()}>
          Find receipt
        </button>
      </section>
      {error ? <p className="inline-error">{error}</p> : null}
      {result ? (
        <article className="work-panel receipt-result">
          <header>
            <div>
              <p className="eyebrow">Original finalized sale</p>
              <h2>{result.sale.invoice_number}</h2>
            </div>
            <strong>{formatPkrMoney(result.sale.total)}</strong>
          </header>
          <div className="data-list">
            {result.items.map((item) => (
              <div className="return-item-row" key={item.id}>
                <div>
                  <strong>{item.medicine_name}</strong>
                  <small>Batch {item.batch_number}</small>
                </div>
                <div>
                  <small>Sold {item.sold_quantity}</small>
                  <b>{item.eligible_quantity} eligible</b>
                </div>
                <label>
                  Return quantity
                  <input
                    inputMode="decimal"
                    max={item.eligible_quantity}
                    value={quantities[item.id] ?? ''}
                    onChange={(event) =>
                      setQuantities({ ...quantities, [item.id]: event.target.value })
                    }
                  />
                </label>
                <label>
                  Disposition
                  <select
                    value={dispositions[item.id] ?? 'QUARANTINE'}
                    onChange={(event) =>
                      setDispositions({
                        ...dispositions,
                        [item.id]: event.target.value as
                          'RESTOCK_SELLABLE' | 'QUARANTINE' | 'SCRAP',
                      })
                    }
                  >
                    <option value="QUARANTINE">Quarantine</option>
                    <option value="RESTOCK_SELLABLE">Restock sellable</option>
                    <option value="SCRAP">Scrap</option>
                  </select>
                </label>
              </div>
            ))}
          </div>
          <div className="return-command-panel">
            <label>
              Return reason
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            {!returnCommand ? (
              <button
                className="primary-button"
                disabled={working || reason.trim().length < 3}
                onClick={() => void submitRequest()}
              >
                Submit return request
              </button>
            ) : (
              <div className="return-status-actions">
                <strong>Status: {returnCommand.status}</strong>
                {returnCommand.refundAmount ? (
                  <span>Refunded {formatPkrMoney(returnCommand.refundAmount)}</span>
                ) : null}
                {returnCommand.status === 'REQUESTED' && canApprove ? (
                  <button
                    className="secondary-button"
                    disabled={working}
                    onClick={() => void approve()}
                  >
                    Approve return
                  </button>
                ) : null}
                {returnCommand.status === 'APPROVED' && canRefund ? (
                  <button
                    className="primary-button"
                    disabled={working}
                    onClick={() => void refund()}
                  >
                    Issue cash refund
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <p className="safety-note">
            Prior accepted/requested quantities are already deducted. A return never edits the
            original sale line.
          </p>
        </article>
      ) : null}
    </main>
  );
}
