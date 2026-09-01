import { AppShell } from '../../components/AppShell';
import { InventoryIntelligence } from './InventoryIntelligence';
import { InventoryOperations } from './InventoryOperations';

export default function InventoryRoute(): React.JSX.Element {
  return (
    <AppShell>
      <InventoryIntelligence />
      <InventoryOperations />
    </AppShell>
  );
}
