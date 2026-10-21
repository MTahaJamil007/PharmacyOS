import { useQueryClient } from '@tanstack/react-query';
import {
  decimalToScaledInteger,
  minorUnitsToMoney,
  moneyToMinorUnits,
  PERMISSIONS,
  scaledIntegerToDecimal,
} from '@pharmacy/shared';

import {
  importCatalog,
  importOpeningStock,
  type CatalogImportResult,
  type OpeningStockImportResult,
} from '../../api';
import { formatCount, formatMoney, formatQuantity } from '../../format';
import { usePermissions } from '../../hooks/useSession';
import { CATALOG_TEMPLATE, parseCatalogFile } from './catalog-csv';
import { ChunkedImport } from './ChunkedImport';
import { OPENING_STOCK_TEMPLATE, parseOpeningStockFile } from './opening-stock-csv';

function sum<T>(results: readonly T[], pick: (result: T) => number): number {
  return results.reduce((total, result) => total + pick(result), 0);
}

export function ImportsTab() {
  const can = usePermissions();
  const queryClient = useQueryClient();
  if (!can(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)) return null;
  return (
    <div className="stack">
      <ChunkedImport<CatalogImportResult>
        title="1. Medicine list"
        description="Bring in your product list from the old system. Existing medicines (same SKU or barcode) are updated, not duplicated."
        columnsHelp="Columns: name (required), sku, generic, strength, form, pack_size, unit, barcode, prescription (yes/no), storage, hs_code, tax_rate."
        templateName="medicine-list-template.csv"
        template={CATALOG_TEMPLATE}
        parse={parseCatalogFile}
        run={(mode, rows, requestId) => importCatalog(mode, rows, requestId)}
        applyLabel="Import medicines"
        onApplied={() => {
          void queryClient.invalidateQueries({ queryKey: ['admin', 'medicines'] });
          void queryClient.invalidateQueries({ queryKey: ['medicine-picker'] });
        }}
        summarize={(results) => (
          <div className="kv-grid">
            <div className="kv">
              <span>New medicines</span>
              <strong>{formatCount(sum(results, (result) => result.created))}</strong>
            </div>
            <div className="kv">
              <span>Updated</span>
              <strong>{formatCount(sum(results, (result) => result.updated))}</strong>
            </div>
            <div className="kv">
              <span>Already up to date</span>
              <strong>{formatCount(sum(results, (result) => result.unchanged))}</strong>
            </div>
          </div>
        )}
      />
      <ChunkedImport<OpeningStockImportResult>
        title="2. Opening stock"
        description="Load what is on the shelves on day one, batch by batch. Each batch can only be loaded once."
        columnsHelp="Columns: sku or barcode (must already be in the medicine list), batch, expiry, quantity (single units), cost_price, sale_price, mrp (optional). Prices are per single unit."
        templateName="opening-stock-template.csv"
        template={OPENING_STOCK_TEMPLATE}
        parse={parseOpeningStockFile}
        run={(mode, rows, requestId) => importOpeningStock(mode, rows, requestId)}
        applyLabel="Load opening stock"
        onApplied={() => {
          void queryClient.invalidateQueries({ queryKey: ['stock'] });
          void queryClient.invalidateQueries({ queryKey: ['medicine-picker'] });
        }}
        summarize={(results) => {
          const quantity = results.reduce(
            (total, result) => total + decimalToScaledInteger(result.totalQuantity, 3),
            0n,
          );
          const value = results.reduce(
            (total, result) => total + moneyToMinorUnits(result.valueAtCost),
            0n,
          );
          return (
            <div className="kv-grid">
              <div className="kv">
                <span>Batches</span>
                <strong>{formatCount(sum(results, (result) => result.accepted))}</strong>
              </div>
              <div className="kv">
                <span>Units</span>
                <strong>{formatQuantity(scaledIntegerToDecimal(quantity, 3))}</strong>
              </div>
              <div className="kv">
                <span>Value at cost</span>
                <strong>{formatMoney(minorUnitsToMoney(value))}</strong>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
