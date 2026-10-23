import { AppShell } from '../../components/AppShell';
import { InventoryHub } from './InventoryHub';

export default function InventoryRoute(): React.JSX.Element {
  return (
    <AppShell>
      <InventoryHub />
    </AppShell>
  );
}
