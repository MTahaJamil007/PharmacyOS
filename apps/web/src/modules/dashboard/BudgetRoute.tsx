import { AppShell } from '../../components/AppShell';
import { BudgetCalculator } from './BudgetCalculator';

export default function BudgetRoute(): React.JSX.Element {
  return (
    <AppShell>
      <BudgetCalculator />
    </AppShell>
  );
}
