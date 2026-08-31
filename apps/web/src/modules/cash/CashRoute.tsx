import { AppShell } from '../../components/AppShell';
import { CashSessionScreen } from './CashSessionScreen';

export default function CashRoute(): React.JSX.Element {
  return (
    <AppShell>
      <CashSessionScreen />
    </AppShell>
  );
}
