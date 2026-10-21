import { useQuery } from '@tanstack/react-query';
import type { SaleReceipt } from '@pharmacy/shared';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';

import { findSalesForReceipt, reprintSaleReceipt } from '../../api';
import { Alert, Button, DataTable, Dialog, EmptyState, SearchInput } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../format';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export function ReprintDialog({
  onClose,
  onReceipt,
}: {
  readonly onClose: () => void;
  readonly onReceipt: (receipt: SaleReceipt) => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const debounced = useDebouncedValue(text.trim(), 200);
  const sales = useQuery({
    queryKey: ['receipt-search', debounced],
    queryFn: () => findSalesForReceipt(debounced),
  });
  const select = async (saleId: string): Promise<void> => {
    setBusyId(saleId);
    setError('');
    try {
      onReceipt(await reprintSaleReceipt(saleId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The receipt could not be opened');
    } finally {
      setBusyId('');
    }
  };
  return (
    <Dialog
      title="Find a receipt"
      description="Latest sales first. Reprints are recorded in the audit trail."
      size="lg"
      initialFocus={searchInput}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="form-stack">
        <SearchInput
          ref={searchInput}
          icon={Search}
          aria-label="Invoice number"
          placeholder="Invoice number, e.g. 20261021-000042"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {sales.error ? <Alert tone="danger">{sales.error.message}</Alert> : null}
        <div className="card">
          <DataTable
            rows={sales.data ?? []}
            loading={sales.isLoading}
            rowKey={(sale) => sale.id}
            onRowClick={(sale) => void select(sale.id)}
            maxHeight={380}
            empty={<EmptyState title="No matching sale" />}
            columns={[
              {
                header: 'Invoice',
                key: 'invoice',
                render: (sale) => <span className="cell-primary mono">{sale.invoice_number}</span>,
              },
              { header: 'Time', key: 'time', render: (sale) => formatDateTime(sale.created_at) },
              { header: 'Cashier', key: 'cashier', render: (sale) => sale.cashier_name },
              {
                align: 'end',
                header: 'Total',
                key: 'total',
                render: (sale) => (busyId === sale.id ? 'Opening…' : formatMoney(sale.total)),
              },
            ]}
          />
        </div>
      </div>
    </Dialog>
  );
}
