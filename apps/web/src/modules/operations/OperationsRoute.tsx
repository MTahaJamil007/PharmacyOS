import { AppShell } from '../../components/AppShell';
import { OperationsScreen } from './OperationsScreen';

export default function OperationsRoute(): React.JSX.Element {
  return (
    <AppShell>
      <OperationsScreen />
    </AppShell>
  );
}
