import { AppShell } from '../../components/AppShell';
import { ShelfPlannerScreen } from './ShelfPlannerScreen';

export default function ShelvesRoute(): React.JSX.Element {
  return (
    <AppShell>
      <ShelfPlannerScreen />
    </AppShell>
  );
}
