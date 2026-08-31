import { AppShell } from '../../components/AppShell';
import { InventoryIntelligence } from './InventoryIntelligence';

export default function InventoryRoute(): React.JSX.Element {
  return (
    <AppShell>
      <InventoryIntelligence />
    </AppShell>
  );
}
