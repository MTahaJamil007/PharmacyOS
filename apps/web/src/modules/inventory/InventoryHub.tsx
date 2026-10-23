import { PERMISSIONS } from '@pharmacy/shared';
import { useState } from 'react';

import { useFeatures } from '../../features';
import { usePharmacyStore } from '../../store';
import { CustomerRequests } from './CustomerRequests';
import { InventoryIntelligence } from './InventoryIntelligence';
import { InventoryOperations } from './InventoryOperations';
import { OrderList } from './OrderList';
import { ReceiveStock } from './ReceiveStock';
import { StockAlerts } from './StockAlerts';

type Tab = 'receive' | 'alerts' | 'requests' | 'order' | 'batches';

const TAB_KEY = 'pharmacy-inventory-tab';

/** Stock work in one place, each part shown only when the shop has it and the user may use it. */
export function InventoryHub(): React.JSX.Element {
  const permissions = usePharmacyStore((state) => state.session?.user.permissions ?? []);
  const features = useFeatures();
  const can = (...wanted: string[]) =>
    wanted.some((permission) => permissions.includes(permission));
  const tabs = (
    [
      [
        'receive',
        'Receive stock',
        features.SCAN_RECEIVING.enabled && can(PERMISSIONS.INVENTORY_PURCHASE),
      ],
      [
        'alerts',
        'Stock alerts',
        (features.LOW_STOCK.enabled ||
          features.STUCK_STOCK.enabled ||
          features.EXPIRY_ALERTS.enabled) &&
          can(
            PERMISSIONS.INVENTORY_PURCHASE,
            PERMISSIONS.INVENTORY_EXPIRY_READ,
            PERMISSIONS.REPORTS_VIEW_BASIC,
          ),
      ],
      [
        'requests',
        'Customer requests',
        features.CUSTOMER_REQUESTS.enabled &&
          can(PERMISSIONS.INVENTORY_PURCHASE, PERMISSIONS.REPORTS_VIEW_BASIC),
      ],
      [
        'order',
        'Order list',
        features.PURCHASE_ORDERS.enabled && can(PERMISSIONS.INVENTORY_PURCHASE),
      ],
      ['batches', 'Reviews and batches', true],
    ] as const
  ).filter(([, , shown]) => shown);
  const [chosen, setChosen] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab | null) ?? 'receive';
    } catch {
      return 'receive';
    }
  });
  const tab = tabs.some(([key]) => key === chosen) ? chosen : (tabs[0]?.[0] ?? 'batches');
  const choose = (next: Tab) => {
    setChosen(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // The last tab is only a convenience.
    }
  };
  return (
    <main className="inventory-hub">
      <header className="hub-head">
        <div>
          <p className="eyebrow">Stock</p>
          <h1>Receive, watch, and reorder</h1>
        </div>
        <nav className="hub-tabs" aria-label="Stock sections">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => choose(key)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'receive' ? <ReceiveStock /> : null}
      {tab === 'alerts' ? <StockAlerts /> : null}
      {tab === 'requests' ? <CustomerRequests /> : null}
      {tab === 'order' ? <OrderList /> : null}
      {tab === 'batches' ? (
        <>
          <InventoryIntelligence />
          <InventoryOperations />
        </>
      ) : null}
    </main>
  );
}
