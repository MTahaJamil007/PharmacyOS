import { AppShell } from '../../components/AppShell';
import { OwnerAssistant } from './OwnerAssistant';
import { OwnerDashboard } from './OwnerDashboard';

export default function OwnerRoute(): React.JSX.Element {
  return (
    <AppShell>
      <OwnerDashboard />
      <OwnerAssistant />
    </AppShell>
  );
}
