import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@pharmacy/shared';
import { LayoutGrid, MapPin, Monitor, Plus, Truck } from 'lucide-react';
import { useState } from 'react';

import { adminGet, adminPatch, adminPost, type MedicineSearchResult } from '../../api';
import { MedicinePicker } from '../../components/MedicinePicker';
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
  Select,
  Textarea,
  useToast,
} from '../../components/ui';
import { formatDateTime, humanize } from '../../format';
import { usePermissions } from '../../hooks/useSession';
import {
  blankToNull,
  withoutBlanks,
  type AdminShelf,
  type AdminSupplier,
  type AdminTerminal,
  type StorageClass,
  type TerminalType,
} from './admin-types';

/** Keeps only the fields whose value differs from the record being edited. */
function changedFields(original: object, next: Record<string, unknown>): Record<string, unknown> {
  const source = original as Record<string, unknown>;
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => source[key] !== value));
}

function ActiveBadge({ active }: { readonly active: boolean }) {
  return active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>;
}

/* ---------- Suppliers ---------- */

export function SuppliersTab() {
  const [editing, setEditing] = useState<AdminSupplier | 'new' | null>(null);
  const suppliers = useQuery({
    queryKey: ['admin', 'suppliers'],
    queryFn: () => adminGet<{ readonly data: readonly AdminSupplier[] }>('/suppliers'),
  });
  return (
    <Card
      title="Suppliers"
      description="Distributors you buy from. Lead time drives reorder timing."
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
          Add supplier
        </Button>
      }
      flush
    >
      <ErrorAlert error={suppliers.error} />
      <DataTable
        caption="Suppliers"
        rows={suppliers.data?.data ?? []}
        rowKey={(supplier) => supplier.id}
        loading={suppliers.isLoading}
        onRowClick={setEditing}
        empty={<EmptyState icon={Truck} title="No suppliers yet" />}
        columns={[
          {
            header: 'Supplier',
            key: 'name',
            render: (supplier) => (
              <>
                <span className="cell-primary">{supplier.name}</span>
                <span className="cell-sub">{supplier.address ?? '—'}</span>
              </>
            ),
          },
          {
            header: 'Code',
            key: 'code',
            render: (supplier) => <span className="mono">{supplier.code ?? '—'}</span>,
          },
          { header: 'Phone', key: 'phone', render: (supplier) => supplier.phone ?? '—' },
          {
            align: 'end',
            header: 'Lead time',
            key: 'lead',
            render: (supplier) => `${String(supplier.leadTimeDays)} day(s)`,
          },
          {
            header: 'Status',
            key: 'status',
            render: (supplier) => <ActiveBadge active={supplier.isActive} />,
          },
        ]}
      />
      {editing ? (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

function SupplierDialog({
  supplier,
  onClose,
}: {
  readonly supplier: AdminSupplier | null;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    address: supplier?.address ?? '',
    code: supplier?.code ?? '',
    leadTimeDays: String(supplier?.leadTimeDays ?? 1),
    name: supplier?.name ?? '',
    phone: supplier?.phone ?? '',
  });
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const leadValid = /^\d{1,3}$/.test(form.leadTimeDays) && Number(form.leadTimeDays) <= 365;
  const valid = form.name.trim().length >= 2 && leadValid;
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (supplier) {
        const changes = changedFields(supplier, {
          address: blankToNull(form.address),
          code: blankToNull(form.code),
          isActive,
          leadTimeDays: Number(form.leadTimeDays),
          name: form.name.trim(),
          phone: blankToNull(form.phone),
        });
        if (Object.keys(changes).length > 0) await adminPatch(`/suppliers/${supplier.id}`, changes);
      } else {
        await adminPost('/suppliers', {
          ...withoutBlanks({ address: form.address, code: form.code, phone: form.phone }),
          leadTimeDays: Number(form.leadTimeDays),
          name: form.name.trim(),
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'suppliers'] }),
        queryClient.invalidateQueries({ queryKey: ['purchasable-suppliers'] }),
      ]);
      toast.success(supplier ? 'Supplier updated' : 'Supplier added');
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const set =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  return (
    <Dialog
      title={supplier ? `Edit ${supplier.name}` : 'Add supplier'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" className="span-all">
          <Input value={form.name} maxLength={200} onChange={set('name')} />
        </Field>
        <Field label="Code" optional>
          <Input className="mono" value={form.code} maxLength={100} onChange={set('code')} />
        </Field>
        <Field label="Phone" optional>
          <Input type="tel" value={form.phone} maxLength={50} onChange={set('phone')} />
        </Field>
        <Field
          label="Usual delivery time (days)"
          error={leadValid ? undefined : 'A whole number from 0 to 365'}
        >
          <Input inputMode="numeric" value={form.leadTimeDays} onChange={set('leadTimeDays')} />
        </Field>
        <Field label="Address" className="span-all" optional>
          <Textarea rows={2} value={form.address} maxLength={500} onChange={set('address')} />
        </Field>
        {supplier ? (
          <div className="span-all">
            <Checkbox
              label="Active (can receive new orders)"
              checked={isActive}
              onChange={setIsActive}
            />
          </div>
        ) : null}
        <div className="span-all">
          <ErrorAlert error={error} />
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- Shelves ---------- */

const STORAGE: readonly StorageClass[] = ['AMBIENT', 'COLD', 'FROZEN', 'OTHER'];

export function ShelvesTab() {
  const [editing, setEditing] = useState<AdminShelf | 'new' | null>(null);
  const [assigning, setAssigning] = useState<AdminShelf | null>(null);
  const shelves = useQuery({
    queryKey: ['admin', 'shelves'],
    queryFn: () => adminGet<{ readonly data: readonly AdminShelf[] }>('/shelves'),
  });
  return (
    <Card
      title="Shelves and locations"
      description="Where medicines live, so the counter shows staff where to pick from."
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
          Add shelf
        </Button>
      }
      flush
    >
      <ErrorAlert error={shelves.error} />
      <DataTable
        caption="Shelves"
        rows={shelves.data?.data ?? []}
        rowKey={(shelf) => shelf.id}
        loading={shelves.isLoading}
        empty={<EmptyState icon={LayoutGrid} title="No shelves yet" />}
        columns={[
          {
            header: 'Shelf',
            key: 'name',
            render: (shelf) => (
              <>
                <span className="cell-primary">
                  <span className="mono">{shelf.code}</span> · {shelf.name}
                </span>
                <span className="cell-sub">
                  {[
                    shelf.rack && `Rack ${shelf.rack}`,
                    shelf.rowLabel && `Row ${shelf.rowLabel}`,
                    shelf.bin && `Bin ${shelf.bin}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </span>
              </>
            ),
          },
          {
            header: 'Type',
            key: 'type',
            render: (shelf) => (
              <span className="row wrap">
                <Badge>{humanize(shelf.storageClass)}</Badge>
                {shelf.isSecured ? <Badge tone="warning">Secured</Badge> : null}
                {!shelf.isPickLocation ? <Badge>Reserve only</Badge> : null}
              </span>
            ),
          },
          {
            align: 'end',
            header: 'Pick order',
            key: 'priority',
            render: (shelf) => shelf.pickPriority,
          },
          {
            header: 'Status',
            key: 'status',
            render: (shelf) => <ActiveBadge active={shelf.isActive} />,
          },
          {
            align: 'end',
            header: <span className="sr-only">Actions</span>,
            key: 'actions',
            render: (shelf) => (
              <span className="table-actions">
                <Button
                  size="sm"
                  icon={MapPin}
                  disabled={!shelf.isActive}
                  onClick={() => setAssigning(shelf)}
                >
                  Place medicine
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(shelf)}>
                  Edit
                </Button>
              </span>
            ),
          },
        ]}
      />
      {editing ? (
        <ShelfDialog shelf={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      {assigning ? (
        <AssignShelfDialog shelf={assigning} onClose={() => setAssigning(null)} />
      ) : null}
    </Card>
  );
}

function ShelfDialog({
  shelf,
  onClose,
}: {
  readonly shelf: AdminShelf | null;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    bin: shelf?.bin ?? '',
    code: shelf?.code ?? '',
    name: shelf?.name ?? '',
    pickPriority: String(shelf?.pickPriority ?? 100),
    rack: shelf?.rack ?? '',
    rowLabel: shelf?.rowLabel ?? '',
  });
  const [storageClass, setStorageClass] = useState<StorageClass>(shelf?.storageClass ?? 'AMBIENT');
  const [isSecured, setIsSecured] = useState(shelf?.isSecured ?? false);
  const [isPickLocation, setIsPickLocation] = useState(shelf?.isPickLocation ?? true);
  const [isActive, setIsActive] = useState(shelf?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const priorityValid =
    /^\d{1,5}$/.test(form.pickPriority) &&
    Number(form.pickPriority) >= 1 &&
    Number(form.pickPriority) <= 10_000;
  const valid = form.code.trim().length >= 1 && form.name.trim().length >= 2 && priorityValid;
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (shelf) {
        const changes = changedFields(shelf, {
          bin: blankToNull(form.bin),
          code: form.code.trim(),
          isActive,
          isPickLocation,
          isSecured,
          name: form.name.trim(),
          pickPriority: Number(form.pickPriority),
          rack: blankToNull(form.rack),
          rowLabel: blankToNull(form.rowLabel),
          storageClass,
        });
        if (Object.keys(changes).length > 0) await adminPatch(`/shelves/${shelf.id}`, changes);
      } else {
        await adminPost('/shelves', {
          ...withoutBlanks({ bin: form.bin, rack: form.rack, rowLabel: form.rowLabel }),
          code: form.code.trim(),
          isPickLocation,
          isSecured,
          name: form.name.trim(),
          pickPriority: Number(form.pickPriority),
          storageClass,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'shelves'] });
      toast.success(shelf ? 'Shelf updated' : 'Shelf added');
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={shelf ? `Edit shelf ${shelf.code}` : 'Add shelf'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Code" hint="Short label printed on the shelf, e.g. A-03">
          <Input className="mono" value={form.code} maxLength={64} onChange={set('code')} />
        </Field>
        <Field label="Name">
          <Input value={form.name} maxLength={160} onChange={set('name')} />
        </Field>
        <Field label="Rack" optional>
          <Input value={form.rack} maxLength={64} onChange={set('rack')} />
        </Field>
        <Field label="Row" optional>
          <Input value={form.rowLabel} maxLength={64} onChange={set('rowLabel')} />
        </Field>
        <Field label="Bin" optional>
          <Input value={form.bin} maxLength={64} onChange={set('bin')} />
        </Field>
        <Field
          label="Pick order"
          hint="Lower numbers are closer to the counter"
          error={priorityValid ? undefined : '1 to 10,000'}
        >
          <Input inputMode="numeric" value={form.pickPriority} onChange={set('pickPriority')} />
        </Field>
        <Field label="Storage">
          <Select
            value={storageClass}
            onChange={(event) => setStorageClass(event.target.value as StorageClass)}
          >
            {STORAGE.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="stack span-all" style={{ gap: 8 }}>
          <Checkbox label="Secured (locked cabinet)" checked={isSecured} onChange={setIsSecured} />
          <Checkbox
            label="Staff pick from here at the counter"
            checked={isPickLocation}
            onChange={setIsPickLocation}
          />
          {shelf ? <Checkbox label="Active" checked={isActive} onChange={setIsActive} /> : null}
        </div>
        <div className="span-all">
          <ErrorAlert error={error} />
        </div>
      </div>
    </Dialog>
  );
}

function AssignShelfDialog({
  shelf,
  onClose,
}: {
  readonly shelf: AdminShelf;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [medicine, setMedicine] = useState<MedicineSearchResult | null>(null);
  const [locationType, setLocationType] = useState<'PRIMARY_PICK' | 'SECONDARY_PICK' | 'RESERVE'>(
    'PRIMARY_PICK',
  );
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (!medicine) return;
    setBusy(true);
    try {
      await adminPost(`/shelves/${shelf.id}/assign`, {
        isPrimary: locationType === 'PRIMARY_PICK',
        locationType,
        medicineId: medicine.id,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['medicine-picker'] }),
        queryClient.invalidateQueries({ queryKey: ['stock'] }),
      ]);
      toast.success(`${medicine.name} placed on ${shelf.code}`);
      setMedicine(null);
    } catch (caught) {
      toast.error('Could not place the medicine', caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Place medicines on ${shelf.code}`}
      description={shelf.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Done</Button>
          <Button
            variant="primary"
            icon={MapPin}
            loading={busy}
            disabled={!medicine}
            onClick={() => void submit()}
          >
            Place here
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <MedicinePicker onSelect={setMedicine} focusOnMount />
        {medicine ? (
          <div className="customer-chip">
            <div>
              <strong>{medicine.name}</strong>
              <span>Currently: {medicine.shelf ?? 'no shelf assigned'}</span>
            </div>
          </div>
        ) : null}
        <Field label="This shelf is the medicine's">
          <Select
            value={locationType}
            onChange={(event) => setLocationType(event.target.value as typeof locationType)}
          >
            <option value="PRIMARY_PICK">Main pick location (shown at the counter)</option>
            <option value="SECONDARY_PICK">Second pick location</option>
            <option value="RESERVE">Reserve / back stock</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------- Terminals ---------- */

const TERMINAL_TYPES: ReadonlyArray<{ readonly value: TerminalType; readonly label: string }> = [
  { label: 'Sales counter', value: 'SALES_COUNTER' },
  { label: 'Cashier', value: 'CASHIER' },
  { label: 'Back office', value: 'ADMIN' },
];

export function TerminalsTab() {
  const can = usePermissions();
  const [editing, setEditing] = useState<AdminTerminal | 'new' | null>(null);
  const terminals = useQuery({
    queryKey: ['admin', 'terminals'],
    queryFn: () => adminGet<{ readonly data: readonly AdminTerminal[] }>('/terminals'),
    enabled: can(PERMISSIONS.SETTINGS_MANAGE_SYSTEM),
  });
  return (
    <Card
      title="Terminals"
      description="Each computer signs in with its terminal code. Cash drawers and receipts are tied to it."
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
          Add terminal
        </Button>
      }
      flush
    >
      <ErrorAlert error={terminals.error} />
      <DataTable
        caption="Terminals"
        rows={terminals.data?.data ?? []}
        rowKey={(terminal) => terminal.id}
        loading={terminals.isLoading}
        onRowClick={setEditing}
        empty={<EmptyState icon={Monitor} title="No terminals" />}
        columns={[
          {
            header: 'Terminal',
            key: 'name',
            render: (terminal) => (
              <>
                <span className="cell-primary">{terminal.name}</span>
                <span className="cell-sub mono">{terminal.code}</span>
              </>
            ),
          },
          {
            header: 'Used as',
            key: 'type',
            render: (terminal) =>
              TERMINAL_TYPES.find((type) => type.value === terminal.terminalType)?.label ??
              terminal.terminalType,
          },
          {
            header: 'Last seen',
            key: 'seen',
            render: (terminal) =>
              terminal.lastSeenAt ? formatDateTime(terminal.lastSeenAt) : 'Never',
          },
          {
            header: 'Status',
            key: 'status',
            render: (terminal) => <ActiveBadge active={terminal.isActive} />,
          },
        ]}
      />
      {editing ? (
        <TerminalDialog
          terminal={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

function TerminalDialog({
  terminal,
  onClose,
}: {
  readonly terminal: AdminTerminal | null;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(terminal?.code ?? '');
  const [name, setName] = useState(terminal?.name ?? '');
  const [terminalType, setTerminalType] = useState<TerminalType>(
    terminal?.terminalType ?? 'SALES_COUNTER',
  );
  const [isActive, setIsActive] = useState(terminal?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = code.trim().length >= 2 && name.trim().length >= 2;
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (terminal) {
        const changes = changedFields(terminal, {
          code: code.trim(),
          isActive,
          name: name.trim(),
          terminalType,
        });
        if (Object.keys(changes).length > 0) await adminPatch(`/terminals/${terminal.id}`, changes);
      } else {
        await adminPost('/terminals', { code: code.trim(), name: name.trim(), terminalType });
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'terminals'] });
      toast.success(
        terminal ? 'Terminal updated' : 'Terminal added',
        terminal ? undefined : `Sign in on that computer with code ${code.trim()}.`,
      );
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={terminal ? `Edit ${terminal.name}` : 'Add terminal'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <Field
          label="Terminal code"
          hint="Typed on the sign-in screen of that computer, e.g. COUNTER-2"
        >
          <Input
            className="mono"
            value={code}
            maxLength={64}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Name">
          <Input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Used as">
          <Select
            value={terminalType}
            onChange={(event) => setTerminalType(event.target.value as TerminalType)}
          >
            {TERMINAL_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>
        {terminal ? (
          <Checkbox label="Active (can sign in)" checked={isActive} onChange={setIsActive} />
        ) : null}
        <ErrorAlert error={error} />
      </div>
    </Dialog>
  );
}
