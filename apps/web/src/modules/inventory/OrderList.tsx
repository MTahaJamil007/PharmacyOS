import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClientRequestId, multiplyMoneyByQuantity, sumMoney } from '@pharmacy/shared';
import { useRef, useState } from 'react';

import { createPurchaseOrder, getOrderList, listSuppliers, type OrderListLine } from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';
import { printElementInBrowser } from '../invoice/printers';

const PACKS = /^\d{1,6}$/;
const MONEY = /^\d{1,10}(?:\.\d{1,2})?$/;

interface Choice {
  readonly include: boolean;
  readonly packs: string;
  readonly supplierId: string;
  readonly costPerPack: string;
}

function identity(line: OrderListLine): string {
  return [line.name, line.strength, line.dosageForm].filter(Boolean).join(' ');
}

/**
 * Low stock and repeated customer requests in one list, grouped by the supplier who sent each
 * medicine last. One tap turns a group into a purchase order; a printed sheet serves suppliers
 * who take orders by phone or WhatsApp.
 */
export function OrderList(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const queryClient = useQueryClient();
  const sheets = useRef<Record<string, HTMLDivElement | null>>({});
  const list = useQuery({
    queryKey: ['stock-alerts', 'order-list'],
    queryFn: () => getOrderList(token),
  });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers(token) });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lines = list.data?.lines ?? [];
  const choiceFor = (line: OrderListLine): Choice =>
    choices[line.medicineId] ?? {
      include: true,
      packs: String(Math.max(1, line.suggestedPacks)),
      supplierId: line.supplierId ?? '',
      costPerPack: line.costPerPack ?? '',
    };
  const change = (line: OrderListLine, patch: Partial<Choice>) =>
    setChoices((current) => ({ ...current, [line.medicineId]: { ...choiceFor(line), ...patch } }));
  const supplierName = (id: string) =>
    suppliers.data?.find((supplier) => supplier.id === id)?.name ?? 'Choose a supplier';
  const groups = new Map<string, OrderListLine[]>();
  for (const line of lines) {
    const supplier = choiceFor(line).supplierId;
    groups.set(supplier, [...(groups.get(supplier) ?? []), line]);
  }

  const order = async (supplierId: string, group: readonly OrderListLine[]) => {
    const chosen = group.filter((line) => choiceFor(line).include);
    const invalid = chosen.find(
      (line) => !PACKS.test(choiceFor(line).packs) || !MONEY.test(choiceFor(line).costPerPack),
    );
    if (invalid) {
      setError(`Enter packs and cost per pack for ${invalid.name}.`);
      return;
    }
    setBusy(supplierId);
    setError('');
    try {
      const created = await createPurchaseOrder(
        token,
        {
          supplierId,
          items: chosen.map((line) => ({
            medicineId: line.medicineId,
            orderedQuantity: choiceFor(line).packs,
            unitCost: choiceFor(line).costPerPack,
            lineDiscount: '0',
            bonusQuantity: '0',
            baseUnitsPerOrderUnit: line.unitsPerPack ?? '1',
          })),
        },
        createClientRequestId(),
      );
      setMessage(
        `Purchase order ${created.order_number} made for ${supplierName(supplierId)}. Mark it ordered in Purchasing when you send it.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['stock-alerts'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The order could not be made');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="order-list" aria-label="Order list">
      {message ? (
        <p className="planner-notice" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {list.data && lines.length === 0 ? (
        <p className="planner-ok">✓ Nothing needs ordering right now.</p>
      ) : null}
      {[...groups.entries()].map(([supplierId, group]) => {
        const chosen = group.filter((line) => choiceFor(line).include);
        const total = sumMoney(
          chosen.map((line) => {
            const choice = choiceFor(line);
            return PACKS.test(choice.packs) && MONEY.test(choice.costPerPack)
              ? multiplyMoneyByQuantity(choice.costPerPack, choice.packs)
              : '0';
          }),
        );
        return (
          <article key={supplierId || 'none'} className="order-group">
            <header>
              <h3>{supplierId ? supplierName(supplierId) : 'No supplier yet'}</h3>
              <span>
                {chosen.length} medicines · {formatPkrMoney(total)}
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  const sheet = sheets.current[supplierId];
                  if (sheet) printElementInBrowser(sheet, 'A4');
                }}
              >
                Print order sheet
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!supplierId || chosen.length === 0 || busy !== null}
                onClick={() => void order(supplierId, group)}
              >
                {busy === supplierId ? 'Making…' : 'Make purchase order'}
              </button>
            </header>
            <table className="alert-table">
              <thead>
                <tr>
                  <th aria-label="Include" />
                  <th>Medicine</th>
                  <th>Why</th>
                  <th>Packs</th>
                  <th>Cost / pack</th>
                  <th>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {group.map((line) => {
                  const choice = choiceFor(line);
                  return (
                    <tr key={line.medicineId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Order ${line.name}`}
                          checked={choice.include}
                          onChange={(event) => change(line, { include: event.target.checked })}
                        />
                      </td>
                      <td>
                        <strong>{identity(line)}</strong>
                        <small>
                          {line.manufacturer ?? ''} · {line.onHand.replace(/\.0+$/, '')} in stock
                        </small>
                      </td>
                      <td>
                        {line.reasons.includes('LOW_STOCK')
                          ? line.daysLeft !== null
                            ? `${line.daysLeft} days left`
                            : 'low'
                          : ''}
                        {line.requestCount > 0 ? ` · asked ${line.requestCount}×` : ''}
                      </td>
                      <td>
                        <input
                          className="small-input"
                          inputMode="numeric"
                          aria-label={`Packs of ${line.name}`}
                          value={choice.packs}
                          onChange={(event) => change(line, { packs: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="small-input"
                          inputMode="decimal"
                          aria-label={`Cost per pack of ${line.name}`}
                          value={choice.costPerPack}
                          onChange={(event) => change(line, { costPerPack: event.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Supplier for ${line.name}`}
                          value={choice.supplierId}
                          onChange={(event) => change(line, { supplierId: event.target.value })}
                        >
                          <option value="">Choose…</option>
                          {(suppliers.data ?? [])
                            .filter((supplier) => supplier.isActive)
                            .map((supplier) => (
                              <option key={supplier.id} value={supplier.id}>
                                {supplier.name}
                              </option>
                            ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div
              className="move-list-print"
              aria-hidden="true"
              ref={(element) => {
                sheets.current[supplierId] = element;
              }}
            >
              <h1>Order for {supplierId ? supplierName(supplierId) : 'supplier'}</h1>
              <p>{new Date().toLocaleDateString('en-PK')}</p>
              <table>
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Company</th>
                    <th>Packs</th>
                  </tr>
                </thead>
                <tbody>
                  {chosen.map((line) => (
                    <tr key={line.medicineId}>
                      <td>{identity(line)}</td>
                      <td>{line.manufacturer ?? ''}</td>
                      <td>{choiceFor(line).packs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
      {list.data && list.data.notInCatalog.length > 0 ? (
        <article className="order-group">
          <header>
            <h3>Asked for but not in the catalogue</h3>
          </header>
          <ul className="plain-list">
            {list.data.notInCatalog.map((row) => (
              <li key={row.requestedName}>
                {row.requestedName} · asked {row.times}×
              </li>
            ))}
          </ul>
          <p className="planner-hint">Add these medicines in Admin → Medicines before ordering.</p>
        </article>
      ) : null}
    </section>
  );
}
