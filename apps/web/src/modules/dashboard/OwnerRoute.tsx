import { AppShell } from '../../components/AppShell';
import { OwnerAssistant } from './OwnerAssistant';

export default function OwnerRoute(): React.JSX.Element {
  return (
    <AppShell>
      <OwnerAssistant />
    </AppShell>
  );
}
