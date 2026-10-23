import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClientRequestId, PERMISSIONS } from '@pharmacy/shared';
import { useRef, useState } from 'react';

import {
  getReceivingMedicine,
  linkBarcode,
  listSuppliers,
  placeInAlphabet,
  scanForReceiving,
  searchMedicines,
  submitQuickReceipt,
  type MedicineSearchResult,
  type ReceivingDefaults,
  type ScanResult,
  type ScannedMedicine,
} from '../../api';
import { useFeatures } from '../../features';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';
import {
  addLine,
  checkLine,
  lineKey,
  lineTotal,
  loadDraft,
  looksLikeScan,
  receiptTotal,
  saveDraft,
  updateLine,
  type ReceivingLine,
} from './receiving-model';

const SUPPLIER_KEY = 'pharmacy-receiving-supplier';

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function identity(medicine: {
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm?: string | null;
}): string {
  return [medicine.name, medicine.strength, medicine.dosageForm].filter(Boolean).join(' ');
}

function trimQuantity(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function newLine(
  medicine: ScannedMedicine,
  defaults: ReceivingDefaults | null,
  scan: ScanResult | null,
): ReceivingLine {
  const batch = scan?.scan.batch ?? '';
  return {
    key: `${lineKey(medicine.id, batch)}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    medicineId: medicine.id,
    name: medicine.name,
    strength: medicine.strength,
    dosageForm: medicine.dosageForm,
    manufacturer: medicine.manufacturer,
    unitName: medicine.unitName,
    batchNumber: batch,
    expiryDate: scan?.scan.expiryDate ?? '',
    packs: '1',
    bonusPacks: '0',
    unitsPerPack: trimQuantity(defaults?.unitsPerPack ?? medicine.packSize),
    costPerPack: defaults?.costPerPack ?? '',
    discount: '0',
    salePricePerUnit: defaults?.salePricePerUnit ?? '',
    scannedCode: scan?.scan.raw ?? null,
    notes: scan?.warnings ?? [],
    checkBatch: Boolean(scan && (scan.scan.needsReview || !scan.scan.batch)),
  };
}

interface Done {
  readonly orderNumber: string | null;
  readonly totalCost: string;
  readonly lines: readonly ReceivingLine[];
  readonly shelves: ReadonlyMap<string, string | null>;
}

/**
 * Receiving a delivery by scanning: each pack scan adds a line or one more pack, with batch and
 * expiry from the pack's code and last delivery's prices. Nothing about which medicine a pack is
 * is guessed; an unknown barcode is linked only after a person confirms the medicine.
 */
export function ReceiveStock(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const terminalId = session?.user.terminalId ?? 'local';
  const canPlace = session?.user.permissions.includes(PERMISSIONS.INVENTORY_SHELF_MANAGE) ?? false;
  const features = useFeatures();
  const queryClient = useQueryClient();
  const scanInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(createClientRequestId());
  const [lines, setLinesState] = useState<ReceivingLine[]>(() => loadDraft(terminalId));
  const [supplierId, setSupplierIdState] = useState(() => {
    try {
      return localStorage.getItem(SUPPLIER_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [invoice, setInvoice] = useState('');
  const [code, setCode] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [unknown, setUnknown] = useState<ScanResult | null>(null);
  const [confirmLink, setConfirmLink] = useState<MedicineSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const today = localToday();

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => listSuppliers(token),
    staleTime: 60_000,
  });
  const nameResults = useQuery({
    queryKey: ['receiving-search', nameQuery],
    queryFn: () => searchMedicines(token, nameQuery),
    enabled: nameQuery.length >= 2,
    staleTime: 10_000,
  });

  const setLines = (next: ReceivingLine[]) => {
    setLinesState(next);
    saveDraft(terminalId, next);
  };
  const setSupplierId = (id: string) => {
    setSupplierIdState(id);
    try {
      localStorage.setItem(SUPPLIER_KEY, id);
    } catch {
      // Remembering the supplier is a convenience only.
    }
  };
  const refocus = () => window.setTimeout(() => scanInput.current?.focus(), 0);

  const addScanned = (result: ScanResult) => {
    if (!result.medicine) return;
    setLines(addLine(lines, newLine(result.medicine, result.defaults, result)));
    if (!supplierId && result.defaults?.supplierId) setSupplierId(result.defaults.supplierId);
    setNotice(`${identity(result.medicine)} added`);
  };

  const submitCode = async () => {
    const text = code.trim();
    if (!text) return;
    setError('');
    setNotice('');
    setDone(null);
    if (!looksLikeScan(text)) {
      setNameQuery(text);
      setCode('');
      return;
    }
    setBusy(true);
    try {
      const result = await scanForReceiving(token, text);
      if (result.medicine) {
        addScanned(result);
        setUnknown(null);
      } else {
        setUnknown(result);
        setNameQuery('');
      }
      setCode('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The code could not be read');
    } finally {
      setBusy(false);
      refocus();
    }
  };

  const pickByName = async (medicine: MedicineSearchResult) => {
    if (unknown) {
      setConfirmLink(medicine);
      return;
    }
    setBusy(true);
    try {
      const found = await getReceivingMedicine(token, medicine.id);
      setLines(addLine(lines, newLine(found.medicine, found.defaults, null)));
      setNameQuery('');
      setNotice(`${identity(found.medicine)} added. Type its batch and expiry.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That medicine could not be added');
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    if (!unknown || !confirmLink) return;
    setBusy(true);
    setError('');
    try {
      await linkBarcode(token, confirmLink.id, unknown.scan.raw);
      const result = await scanForReceiving(token, unknown.scan.raw);
      addScanned(result);
      setUnknown(null);
      setConfirmLink(null);
      setNameQuery('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The barcode could not be linked');
    } finally {
      setBusy(false);
      refocus();
    }
  };

  const checks = new Map(lines.map((line) => [line.key, checkLine(line, today)]));
  const blocking = lines.filter((line) => (checks.get(line.key)?.errors.length ?? 0) > 0).length;

  const receive = async () => {
    if (!supplierId) {
      setError('Choose the supplier first.');
      return;
    }
    if (blocking > 0) {
      setError(`Fix the ${blocking} red ${blocking === 1 ? 'line' : 'lines'} first.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const snapshot = lines;
      const result = await submitQuickReceipt(token, {
        clientRequestId: requestId.current,
        supplierId,
        ...(invoice.trim() ? { supplierInvoiceNumber: invoice.trim() } : {}),
        lines: lines.map((line) => ({
          medicineId: line.medicineId,
          quantity: line.packs,
          bonusQuantity: line.bonusPacks,
          unitsPerPack: line.unitsPerPack,
          costPerPack: line.costPerPack,
          lineDiscount: line.discount,
          batchNumber: line.batchNumber.trim(),
          expiryDate: line.expiryDate,
          salePricePerUnit: line.salePricePerUnit,
          ...(line.scannedCode ? { scannedCode: line.scannedCode.slice(0, 200) } : {}),
        })),
      });
      requestId.current = createClientRequestId();
      setLines([]);
      setInvoice('');
      setDone({
        orderNumber: result.orderNumber ?? null,
        totalCost: result.totalCost,
        lines: snapshot,
        shelves: new Map((result.shelves ?? []).map((row) => [row.medicineId, row.shelf])),
      });
      await queryClient.invalidateQueries({ queryKey: ['stock-alerts'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The delivery could not be received');
    } finally {
      setBusy(false);
    }
  };

  const supplierOptions = suppliers.data?.filter((supplier) => supplier.isActive) ?? [];

  return (
    <section className="receive-stock" aria-label="Receive stock">
      <div className="receive-head">
        <label className="planner-field">
          <span>Supplier</span>
          <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">Choose…</option>
            {supplierOptions.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className="planner-field">
          <span>Supplier invoice no. (optional)</span>
          <input
            value={invoice}
            maxLength={120}
            onChange={(event) => setInvoice(event.target.value)}
          />
        </label>
        <label className="planner-field scan-field">
          <span>Scan a pack, or type a name</span>
          <input
            ref={scanInput}
            value={code}
            autoComplete="off"
            placeholder="Scan the barcode on the pack"
            aria-label="Scan a pack or type a medicine name"
            disabled={busy && !code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitCode();
              }
            }}
          />
        </label>
      </div>

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="planner-notice" role="status">
          {notice}
        </p>
      ) : null}

      {unknown ? (
        <div className="unknown-pack" role="group" aria-label="New barcode">
          <div>
            <strong>This pack is new to the shop.</strong>
            <span>
              {unknown.scan.gtin ? `Product number ${unknown.scan.gtin}` : unknown.scan.raw}
              {unknown.scan.batch ? ` · batch ${unknown.scan.batch}` : ''}
              {unknown.scan.expiryDate ? ` · expires ${unknown.scan.expiryDate}` : ''}
            </span>
            <small>Find the medicine below by name. The barcode is then remembered for it.</small>
          </div>
          <button type="button" className="link-button" onClick={() => setUnknown(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      {unknown || nameQuery ? (
        <div className="name-pick">
          <label className="planner-field">
            <span>{unknown ? 'Which medicine is this pack?' : 'Medicine name'}</span>
            <input
              value={nameQuery}
              autoComplete="off"
              aria-label="Find the medicine by name"
              onChange={(event) => setNameQuery(event.target.value)}
            />
          </label>
          <ul className="name-results">
            {(nameResults.data ?? []).slice(0, 8).map((medicine) => (
              <li key={medicine.id}>
                <button type="button" disabled={busy} onClick={() => void pickByName(medicine)}>
                  <strong>{identity(medicine)}</strong>
                  <small>
                    {medicine.manufacturer ?? 'No company'}
                    {medicine.barcode ? ` · barcode ${medicine.barcode}` : ' · no barcode yet'}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {confirmLink && unknown ? (
        <div className="confirm-link" role="alertdialog" aria-label="Confirm the medicine">
          <p>
            From now on this barcode will mean <b>{identity(confirmLink)}</b> by{' '}
            <b>{confirmLink.manufacturer ?? 'no company'}</b>. Check the name, strength and form on
            the pack.
          </p>
          <div>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void link()}
            >
              Yes, it is this medicine
            </button>
            <button type="button" className="secondary-button" onClick={() => setConfirmLink(null)}>
              No, choose again
            </button>
          </div>
        </div>
      ) : null}

      {lines.length > 0 ? (
        <div className="receive-table-wrap">
          <table className="receive-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th>Packs</th>
                <th>Bonus</th>
                <th>Per pack</th>
                <th>Cost / pack</th>
                <th>Sale / unit</th>
                <th>Total</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const check = checks.get(line.key) ?? { errors: [], warnings: [] };
                const field = (
                  name: keyof ReceivingLine,
                  label: string,
                  props: React.InputHTMLAttributes<HTMLInputElement> = {},
                ) => (
                  <input
                    aria-label={`${label} for ${line.name}`}
                    value={String(line[name] ?? '')}
                    onChange={(event) =>
                      setLines(updateLine(lines, line.key, { [name]: event.target.value }))
                    }
                    {...props}
                  />
                );
                return (
                  <tr
                    key={line.key}
                    className={
                      check.errors.length > 0
                        ? 'has-error'
                        : check.warnings.length > 0
                          ? 'has-warning'
                          : ''
                    }
                  >
                    <td className="receive-medicine">
                      <strong>{identity(line)}</strong>
                      <small>{line.manufacturer ?? 'No company'}</small>
                      {[...check.errors, ...check.warnings].map((message) => (
                        <em key={message}>{message}</em>
                      ))}
                    </td>
                    <td className={line.checkBatch ? 'check-batch' : ''}>
                      {field('batchNumber', 'Batch', { maxLength: 120 })}
                    </td>
                    <td>{field('expiryDate', 'Expiry', { type: 'date' })}</td>
                    <td>{field('packs', 'Packs', { inputMode: 'decimal' })}</td>
                    <td>{field('bonusPacks', 'Bonus packs', { inputMode: 'decimal' })}</td>
                    <td>
                      {field('unitsPerPack', `${line.unitName}s per pack`, {
                        inputMode: 'decimal',
                      })}
                    </td>
                    <td>{field('costPerPack', 'Cost per pack', { inputMode: 'decimal' })}</td>
                    <td>
                      {field('salePricePerUnit', `Sale price per ${line.unitName}`, {
                        inputMode: 'decimal',
                      })}
                    </td>
                    <td className="receive-total">{formatPkrMoney(lineTotal(line))}</td>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        aria-label={`Remove ${line.name}`}
                        onClick={() => setLines(lines.filter((item) => item.key !== line.key))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <footer className="receive-footer">
            <span>
              {lines.length} {lines.length === 1 ? 'line' : 'lines'} ·{' '}
              <b>{formatPkrMoney(receiptTotal(lines))}</b>
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setLines([]);
                refocus();
              }}
            >
              Start over
            </button>
            <button
              type="button"
              className="primary-button big-action"
              disabled={busy || lines.length === 0}
              onClick={() => void receive()}
            >
              {busy ? 'Saving…' : 'Receive stock'}
            </button>
          </footer>
        </div>
      ) : !done ? (
        <p className="empty-state receive-empty">
          Scan the first pack. Each scan of the same batch adds one more pack.
        </p>
      ) : null}

      {done ? (
        <ReceivedSummary
          done={done}
          token={token}
          canPlace={canPlace && features.SHELF_LOCATIONS.enabled}
        />
      ) : null}
    </section>
  );
}

function ReceivedSummary({
  done,
  token,
  canPlace,
}: {
  readonly done: Done;
  readonly token: string;
  readonly canPlace: boolean;
}): React.JSX.Element {
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const medicines = [...new Map(done.lines.map((line) => [line.medicineId, line])).values()];
  const place = async (line: ReceivingLine) => {
    setError('');
    try {
      const placed = await placeInAlphabet(token, line.medicineId, true);
      setPlaces((current) => ({
        ...current,
        [line.medicineId]:
          `${placed.targetLabel}` +
          (placed.after ? ` after ${placed.after}` : '') +
          (placed.moves.length > 0
            ? ` · then move ${placed.moves.map((move) => `${move.name} to ${move.toLabel}`).join(', ')}`
            : ''),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No place could be found');
    }
  };
  return (
    <section className="received-summary" aria-label="Stock received">
      <h3>
        ✓ Received{done.orderNumber ? ` · ${done.orderNumber}` : ''} ·{' '}
        {formatPkrMoney(done.totalCost)}
      </h3>
      <p className="planner-hint">Put the new stock away:</p>
      <ul>
        {medicines.map((line) => {
          const shelf = done.shelves.get(line.medicineId) ?? null;
          return (
            <li key={line.medicineId}>
              <span>{identity(line)}</span>
              {shelf ? (
                <b>{shelf}</b>
              ) : places[line.medicineId] ? (
                <b>{places[line.medicineId]}</b>
              ) : canPlace ? (
                <button type="button" className="secondary-button" onClick={() => void place(line)}>
                  Give it an A to Z place
                </button>
              ) : (
                <em>No shelf yet</em>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <p className="inline-error">{error}</p> : null}
    </section>
  );
}
