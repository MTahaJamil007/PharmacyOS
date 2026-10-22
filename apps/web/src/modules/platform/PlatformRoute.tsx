import { AppShell } from '../../components/AppShell';
import { PlatformScreen } from './PlatformScreen';

export default function PlatformRoute(): React.JSX.Element {
  return (
    <AppShell>
      <PlatformScreen />
    </AppShell>
  );
}
