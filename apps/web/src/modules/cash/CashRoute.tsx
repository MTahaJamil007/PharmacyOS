import { AppShell } from '../../components/AppShell';
import { CashCounterScreen } from './CashCounterScreen';

export default function CashRoute(): React.JSX.Element {
  return (
    <AppShell>
      <CashCounterScreen />
    </AppShell>
  );
}
