import { AppShell } from '../../components/AppShell';
import { CustomersScreen } from './CustomersScreen';

export default function CustomersRoute(): React.JSX.Element {
  return (
    <AppShell>
      <CustomersScreen />
    </AppShell>
  );
}
