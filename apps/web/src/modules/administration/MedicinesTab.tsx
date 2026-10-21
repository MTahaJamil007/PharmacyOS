import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pill, Plus, Search } from 'lucide-react';
import { useState } from 'react';

import { adminGet, adminPatch, adminPost } from '../../api';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  SearchInput,
  Select,
  useToast,
} from '../../components/ui';
import { formatQuantity, humanize, isPositiveQuantityText } from '../../format';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { blankToNull, withoutBlanks, type AdminMedicine, type StorageClass } from './admin-types';

const STORAGE: readonly StorageClass[] = ['AMBIENT', 'COLD', 'FROZEN', 'OTHER'];
const HS_CODE = /^\d{4}\.\d{4}$/;
const TAX_RATE = /^\d{1,3}(?:\.\d{1,2})?$/;

export function MedicinesTab() {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<AdminMedicine | 'new' | null>(null);
  const query = useDebouncedValue(text.trim(), 250);
  const medicines = useQuery({
    queryKey: ['admin', 'medicines', query],
    queryFn: () =>
      adminGet<{ readonly data: readonly AdminMedicine[] }>(
        `/medicines?query=${encodeURIComponent(query)}&limit=50`,
      ),
    placeholderData: (previous) => previous,
  });
  return (
    <Card
      title="Medicine catalogue"
      description="What the shop sells. Stock and prices are set when goods are received; this is the product master."
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
          Add medicine
        </Button>
      }
      flush
    >
      <div className="card-body">
        <SearchInput
          icon={Search}
          aria-label="Search the catalogue"
          placeholder="Search by name, generic name, SKU or barcode"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <ErrorAlert error={medicines.error} />
      <DataTable
        caption="Medicines"
        compact
        rows={medicines.data?.data ?? []}
        rowKey={(medicine) => medicine.id}
        loading={medicines.isLoading}
        onRowClick={setEditing}
        empty={
          <EmptyState icon={Pill} title={query ? 'No medicine matches' : 'The catalogue is empty'}>
            {query
              ? 'Try the generic name or scan the barcode.'
              : 'Add medicines one by one, or import your list under Data import.'}
          </EmptyState>
        }
        columns={[
          {
            header: 'Medicine',
            key: 'name',
            render: (medicine) => (
              <>
                <span className="cell-primary">{medicine.name}</span>
                <span className="cell-sub">
                  {[medicine.genericName, medicine.strength, medicine.dosageForm]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </span>
              </>
            ),
          },
          {
            header: 'SKU',
            key: 'sku',
            render: (medicine) => <span className="mono">{medicine.sku ?? '—'}</span>,
          },
          {
            header: 'Barcode',
            key: 'barcode',
            render: (medicine) => <span className="mono">{medicine.barcode ?? '—'}</span>,
          },
          {
            align: 'end',
            header: 'Pack',
            key: 'pack',
            render: (medicine) => `${formatQuantity(medicine.packSize)} ${medicine.unitName}`,
          },
          {
            header: 'Flags',
            key: 'flags',
            render: (medicine) => (
              <span className="row wrap">
                {medicine.requiresPrescription ? <Badge tone="info">Rx</Badge> : null}
                {medicine.storageClass !== 'AMBIENT' ? (
                  <Badge tone="info">{humanize(medicine.storageClass)}</Badge>
                ) : null}
                {medicine.requiresSecuredStorage ? <Badge tone="warning">Secured</Badge> : null}
                {!medicine.hsCode ? <Badge tone="warning">No HS code</Badge> : null}
                {!medicine.isActive ? <Badge tone="danger">Inactive</Badge> : null}
              </span>
            ),
          },
          {
            align: 'end',
            header: 'Sales tax',
            key: 'tax',
            render: (medicine) => `${medicine.taxRate}%`,
          },
        ]}
      />
      {editing ? (
        <MedicineDialog
          medicine={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

function MedicineDialog({
  medicine,
  onClose,
}: {
  readonly medicine: AdminMedicine | null;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    barcode: medicine?.barcode ?? '',
    dosageForm: medicine?.dosageForm ?? '',
    fbrSaleType: medicine?.fbrSaleType ?? 'Goods at standard rate (default)',
    fbrUom: medicine?.fbrUom ?? 'Numbers, pieces, units',
    genericName: medicine?.genericName ?? '',
    hsCode: medicine?.hsCode ?? '',
    name: medicine?.name ?? '',
    packSize: medicine ? formatQuantity(medicine.packSize).replaceAll(',', '') : '1',
    sku: medicine?.sku ?? '',
    strength: medicine?.strength ?? '',
    taxRate: medicine?.taxRate ?? '0',
    unitName: medicine?.unitName ?? 'tablet',
  });
  const [requiresPrescription, setRequiresPrescription] = useState(
    medicine?.requiresPrescription ?? false,
  );
  const [requiresSecuredStorage, setRequiresSecuredStorage] = useState(
    medicine?.requiresSecuredStorage ?? false,
  );
  const [storageClass, setStorageClass] = useState<StorageClass>(
    medicine?.storageClass ?? 'AMBIENT',
  );
  const [isActive, setIsActive] = useState(medicine?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const problems = {
    barcode: form.barcode.trim() && form.barcode.trim().length < 3 ? 'At least 3 characters' : null,
    hsCode: form.hsCode.trim() && !HS_CODE.test(form.hsCode.trim()) ? 'Format 3004.9099' : null,
    name: form.name.trim().length < 2 ? 'Enter the brand name' : null,
    packSize: !isPositiveQuantityText(form.packSize) ? 'Units in one pack, e.g. 20' : null,
    taxRate: !TAX_RATE.test(form.taxRate.trim()) ? 'A percentage like 0 or 18' : null,
    unitName: !form.unitName.trim() ? 'e.g. tablet, ml, sachet' : null,
  };
  const valid =
    Object.values(problems).every((problem) => !problem) &&
    form.fbrUom.trim() &&
    form.fbrSaleType.trim();
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const common = {
      fbrSaleType: form.fbrSaleType.trim(),
      fbrUom: form.fbrUom.trim(),
      name: form.name.trim(),
      packSize: form.packSize.trim(),
      requiresPrescription,
      requiresSecuredStorage,
      storageClass,
      taxRate: form.taxRate.trim(),
      unitName: form.unitName.trim(),
    };
    try {
      if (medicine) {
        const next: Record<string, unknown> = {
          ...common,
          barcode: blankToNull(form.barcode),
          dosageForm: blankToNull(form.dosageForm),
          genericName: blankToNull(form.genericName),
          hsCode: blankToNull(form.hsCode),
          isActive,
          sku: blankToNull(form.sku),
          strength: blankToNull(form.strength),
        };
        // Send only what changed: rewriting an untouched barcode or SKU must never collide.
        const original = medicine as unknown as Record<string, unknown>;
        const changes = Object.fromEntries(
          Object.entries(next).filter(([key, value]) =>
            key === 'packSize'
              ? formatQuantity(medicine.packSize).replaceAll(',', '') !== value
              : original[key] !== value,
          ),
        );
        if (Object.keys(changes).length === 0) {
          toast.info('No changes to save');
          onClose();
          return;
        }
        await adminPatch(`/medicines/${medicine.id}`, changes);
        toast.success('Medicine updated');
      } else {
        await adminPost(
          '/medicines',
          withoutBlanks({
            ...common,
            barcode: form.barcode.trim(),
            dosageForm: form.dosageForm.trim(),
            genericName: form.genericName.trim(),
            hsCode: form.hsCode.trim(),
            sku: form.sku.trim(),
            strength: form.strength.trim(),
          }),
        );
        toast.success(`${form.name.trim()} added to the catalogue`);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'medicines'] }),
        queryClient.invalidateQueries({ queryKey: ['medicine-picker'] }),
        queryClient.invalidateQueries({ queryKey: ['stock'] }),
      ]);
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={medicine ? `Edit ${medicine.name}` : 'Add medicine'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {medicine ? 'Save changes' : 'Add medicine'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="form-grid three">
          <Field
            label="Brand name"
            className="span-2"
            error={form.name && problems.name ? problems.name : undefined}
          >
            <Input value={form.name} maxLength={200} onChange={set('name')} />
          </Field>
          <Field label="Strength" optional>
            <Input
              value={form.strength}
              placeholder="500 mg"
              maxLength={100}
              onChange={set('strength')}
            />
          </Field>
          <Field label="Generic name (salt)" className="span-2" optional>
            <Input
              value={form.genericName}
              placeholder="Paracetamol"
              maxLength={200}
              onChange={set('genericName')}
            />
          </Field>
          <Field label="Form" optional>
            <Input
              value={form.dosageForm}
              placeholder="Tablet, syrup…"
              maxLength={100}
              onChange={set('dosageForm')}
            />
          </Field>
          <Field
            label="Sold by the"
            hint="The smallest unit you sell"
            error={problems.unitName ?? undefined}
          >
            <Input value={form.unitName} maxLength={50} onChange={set('unitName')} />
          </Field>
          <Field label="Units per pack" error={problems.packSize ?? undefined}>
            <Input inputMode="decimal" value={form.packSize} onChange={set('packSize')} />
          </Field>
          <Field label="Storage">
            <Select
              value={storageClass}
              onChange={(event) => setStorageClass(event.target.value as StorageClass)}
            >
              {STORAGE.map((value) => (
                <option key={value} value={value}>
                  {value === 'AMBIENT'
                    ? 'Room temperature'
                    : value === 'COLD'
                      ? 'Fridge (2–8 °C)'
                      : humanize(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="SKU / item code" optional>
            <Input className="mono" value={form.sku} maxLength={100} onChange={set('sku')} />
          </Field>
          <Field label="Barcode" optional error={problems.barcode ?? undefined}>
            <Input
              className="mono"
              value={form.barcode}
              maxLength={120}
              onChange={set('barcode')}
            />
          </Field>
        </div>
        <div className="row wrap" style={{ gap: 24 }}>
          <Checkbox
            label="Prescription required"
            checked={requiresPrescription}
            onChange={setRequiresPrescription}
          />
          <Checkbox
            label="Keep in secured storage"
            checked={requiresSecuredStorage}
            onChange={setRequiresSecuredStorage}
          />
          {medicine ? (
            <Checkbox
              label="Active (can be sold and ordered)"
              checked={isActive}
              onChange={setIsActive}
            />
          ) : null}
        </div>
        <div className="form-section-title">Tax and FBR</div>
        <div className="form-grid">
          <Field
            label="HS code"
            optional
            hint="Needed for FBR digital invoicing"
            error={problems.hsCode ?? undefined}
          >
            <Input
              className="mono"
              value={form.hsCode}
              placeholder="3004.9099"
              onChange={set('hsCode')}
            />
          </Field>
          <Field label="Sales tax rate (%)" error={problems.taxRate ?? undefined}>
            <Input inputMode="decimal" value={form.taxRate} onChange={set('taxRate')} />
          </Field>
          <Field label="FBR unit of measure">
            <Input value={form.fbrUom} maxLength={120} onChange={set('fbrUom')} />
          </Field>
          <Field label="FBR sale type">
            <Input value={form.fbrSaleType} maxLength={200} onChange={set('fbrSaleType')} />
          </Field>
        </div>
        <ErrorAlert error={error} />
      </div>
    </Dialog>
  );
}
