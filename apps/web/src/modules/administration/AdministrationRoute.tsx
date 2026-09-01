import { AppShell } from '../../components/AppShell';
import { AdministrationScreen } from './AdministrationScreen';

export default function AdministrationRoute(): React.JSX.Element {
  return (
    <AppShell>
      <AdministrationScreen />
    </AppShell>
  );
}
