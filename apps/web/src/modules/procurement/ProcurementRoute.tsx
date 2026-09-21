import { AppShell } from '../../components/AppShell';
import { ProcurementScreen } from './ProcurementScreen';

export default function ProcurementRoute(): React.JSX.Element {
  return (
    <AppShell>
      <ProcurementScreen />
    </AppShell>
  );
}
