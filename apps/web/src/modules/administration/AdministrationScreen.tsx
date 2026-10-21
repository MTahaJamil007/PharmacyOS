import { PERMISSIONS } from '@pharmacy/shared';
import { FileUp, LayoutGrid, Monitor, Pill, SlidersHorizontal, Truck, Users } from 'lucide-react';
import { useState } from 'react';

import { PageHeader, Tabs } from '../../components/ui';
import { usePermissions } from '../../hooks/useSession';
import { ShelvesTab, SuppliersTab, TerminalsTab } from './DirectoryTabs';
import { ImportsTab } from './ImportsTab';
import { MedicinesTab } from './MedicinesTab';
import { PoliciesTab } from './PoliciesTab';
import { UsersTab } from './UsersTab';

type SettingsTab =
  'USERS' | 'MEDICINES' | 'SUPPLIERS' | 'SHELVES' | 'TERMINALS' | 'RULES' | 'IMPORT';

export function AdministrationScreen(): React.JSX.Element {
  const can = usePermissions();
  const system = can(PERMISSIONS.SETTINGS_MANAGE_SYSTEM);
  const tabs = [
    ...(can(PERMISSIONS.SETTINGS_MANAGE_USERS)
      ? [{ icon: Users, id: 'USERS' as const, label: 'Staff' }]
      : []),
    ...(system ? [{ icon: Pill, id: 'MEDICINES' as const, label: 'Medicines' }] : []),
    ...(system ? [{ icon: Truck, id: 'SUPPLIERS' as const, label: 'Suppliers' }] : []),
    ...(can(PERMISSIONS.INVENTORY_SHELF_MANAGE)
      ? [{ icon: LayoutGrid, id: 'SHELVES' as const, label: 'Shelves' }]
      : []),
    ...(system ? [{ icon: Monitor, id: 'TERMINALS' as const, label: 'Terminals' }] : []),
    ...(system
      ? [{ icon: SlidersHorizontal, id: 'RULES' as const, label: 'Shop rules & tax' }]
      : []),
    ...(system ? [{ icon: FileUp, id: 'IMPORT' as const, label: 'Data import' }] : []),
  ];
  const [tab, setTab] = useState<SettingsTab>(tabs[0]?.id ?? 'USERS');
  return (
    <div className="page">
      <PageHeader
        title="Settings"
        description="Staff, products, suppliers and the rules the shop runs by."
      />
      <Tabs label="Settings sections" tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'USERS' ? <UsersTab /> : null}
      {tab === 'MEDICINES' ? <MedicinesTab /> : null}
      {tab === 'SUPPLIERS' ? <SuppliersTab /> : null}
      {tab === 'SHELVES' ? <ShelvesTab /> : null}
      {tab === 'TERMINALS' ? <TerminalsTab /> : null}
      {tab === 'RULES' ? <PoliciesTab /> : null}
      {tab === 'IMPORT' ? <ImportsTab /> : null}
    </div>
  );
}
