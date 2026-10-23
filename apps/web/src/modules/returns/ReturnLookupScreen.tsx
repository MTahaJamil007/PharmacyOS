import { createClientRequestId, decimalToScaledInteger } from '@pharmacy/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  approveReturn,
  getCurrentCashSession,
  getReturnSearchPolicy,
  lookupReturn,
  refundReturn,
  requestReturn,
  requestReturnBySale,
  searchReturns,
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

function todayInTimezone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year ?? ''}-${values.month ?? ''}-${values.day ?? ''}`;
}

function saleTimeInShop(value: string, timeZone: string | undefined): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-PK', timeZone ? { timeZone } : undefined);
}

export function ReturnLookupScreen(): React.JSX.Element {
  const receiptTokenInput = useRef<HTMLInputElement>(null);
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const searchPolicy = useQuery({
    queryKey: ['returns-search-policy'],
    queryFn: () => getReturnSearchPolicy(token),
    enabled: Boolean(token),
    retry: false,
  });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [medicines, setMedicines] = useState('');
  const [matches, setMatches] = useState<readonly ReturnLookup[]>([]);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [receiptToken, setReceiptToken] = useState('');
  const [result, setResult] = useState<ReturnLookup | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<
    Record<string, 'RESTOCK_SELLABLE' | 'QUARANTINE' | 'SCRAP'>
  >({});
  const [reason, setReason] = useState('');
  const [returnCommand, setReturnCommand] = useState<ReturnCommandResult | null>(null);
  const [returnRequestId, setReturnRequestId] = useState(createClientRequestId);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const defaultShopDate = searchPolicy.data?.timezone
    ? todayInTimezone(searchPolicy.data.timezone)
    : '';

  useEffect(() => {
    receiptTokenInput.current?.focus();
  }, []);
  const lookup = async (): Promise<void> => {
    try {
      setError('');
      const found = await lookupReturn(token, receiptToken.trim());
      setResult(found);
      setSaleId(null);
      setMatches([]);
      setReturnCommand(null);
      setReturnRequestId(createClientRequestId());
      setQuantities({});
      setDispositions({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Receipt lookup failed');
    }
  };
  const searchLostInvoice = async (): Promise<void> => {
    const searchFrom = from || defaultShopDate;
    const searchTo = to || defaultShopDate;
    if (!searchFrom || !searchTo || (!query.trim() && !medicines.trim())) {
      setError('Choose a date range and enter an invoice/customer detail or medicine name');
      return;
    }
    try {
      setWorking(true);
      setError('');
      setResult(null);
      setReturnCommand(null);
      setMatches(await searchReturns(token, { from: searchFrom, to: searchTo, query, medicines }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invoice search failed');
    } finally {
      setWorking(false);
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
      setReturnCommand(
        saleId
          ? await requestReturnBySale(token, saleId, {
              clientRequestId: returnRequestId,
              reason,
              items,
            })
          : await requestReturn(token, receiptToken.trim(), {
              clientRequestId: returnRequestId,
              reason,
              items,
            }),
      );
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
          <p className="eyebrow">Returns · shop timezone: {searchPolicy.data?.timezone ?? '…'}</p>
          <h1>Return lookup</h1>
          <p>
            Search by invoice, customer name or phone, or the medicines bought. Invoice-less search
            is{' '}
            {searchPolicy.data?.allowInvoiceLessReturns
              ? 'enabled by the owner'
              : 'disabled by the owner'}
            .
          </p>
        </div>
      </section>
      {searchPolicy.data?.allowInvoiceLessReturns ? (
        <section className="return-search return-search-expanded">
          <label>
            <span>From (shop date)</span>
            <input
              aria-label="Purchase from date"
              type="date"
              value={from || defaultShopDate}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            <span>Through (inclusive shop date)</span>
            <input
              aria-label="Purchase through date"
              type="date"
              value={to || defaultShopDate}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label>
            <span>Invoice #, customer name or phone</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Invoice number or customer detail"
            />
          </label>
          <label>
            <span>Medicines (comma separated)</span>
            <input
              value={medicines}
              onChange={(event) => setMedicines(event.target.value)}
              placeholder="Panadol 500 mg, Amoxil 675 mg"
            />
          </label>
          <button
            className="primary-button"
            disabled={working}
            onClick={() => void searchLostInvoice()}
          >
            Search past sales
          </button>
        </section>
      ) : null}
      {matches.length > 0 ? (
        <section className="work-panel return-search-results" aria-label="Matching sales">
          <h2>Matching sales</h2>
          {matches.map((match) => (
            <button
              key={match.sale.id}
              onClick={() => {
                setResult(match);
                setSaleId(match.sale.id);
                setReturnCommand(null);
                setReturnRequestId(createClientRequestId());
                setQuantities({});
                setDispositions({});
                setError('');
              }}
            >
              <span>
                <strong>{match.sale.invoice_number}</strong>
                <small>
                  {saleTimeInShop(match.sale.created_at, searchPolicy.data?.timezone)} ·{' '}
                  {match.sale.customer_name ?? 'Walk-in'} {match.sale.customer_phone ?? ''}
                </small>
              </span>
              <b>{formatPkrMoney(match.sale.total)}</b>
            </button>
          ))}
        </section>
      ) : null}
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
              <p className="eyebrow">
                Original finalized sale{saleId ? ' · matched without receipt token' : ''}
              </p>
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
