import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell, NAVIGATION } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ReauthModal } from './components/ReauthModal';
import { Spinner } from './components/ui';
import { usePermissions } from './hooks/useSession';
import { LoginScreen } from './LoginScreen';
import { usePharmacyStore } from './store';

const PosRoute = lazy(() => import('./modules/pos/PosRoute'));
const CashRoute = lazy(() => import('./modules/cash/CashRoute'));
const InventoryRoute = lazy(() => import('./modules/inventory/InventoryRoute'));
const ReturnsRoute = lazy(() => import('./modules/returns/ReturnsRoute'));
const BudgetRoute = lazy(() => import('./modules/dashboard/BudgetRoute'));
const OwnerRoute = lazy(() => import('./modules/dashboard/OwnerRoute'));
const CustomersRoute = lazy(() => import('./modules/customers/CustomersRoute'));
const ProcurementRoute = lazy(() => import('./modules/procurement/ProcurementRoute'));
const ReportsRoute = lazy(() => import('./modules/reports/ReportsRoute'));
const OperationsRoute = lazy(() => import('./modules/operations/OperationsRoute'));
const AdministrationRoute = lazy(() => import('./modules/administration/AdministrationRoute'));

function DefaultRoute(): React.JSX.Element {
  const can = usePermissions();
  const first = NAVIGATION.flatMap((group) => group.items).find((item) => can(...item.permissions));
  return <Navigate replace to={first?.to ?? '/pos'} />;
}

function RoutedWorkspace(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
  const [reauthenticate, setReauthenticate] = useState(false);
  useEffect(() => {
    const requireAuthentication = (): void => setReauthenticate(true);
    window.addEventListener('pharmacy:unauthorized', requireAuthentication);
    return () => window.removeEventListener('pharmacy:unauthorized', requireAuthentication);
  }, []);

  if (!session && !previewMode) return <LoginScreen />;
  return (
    <AppShell>
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="route-loading">
              <Spinner label="Opening" />
            </div>
          }
        >
          <Routes>
            <Route path="/pos" element={<PosRoute />} />
            <Route path="/cash" element={<CashRoute />} />
            <Route path="/inventory" element={<InventoryRoute />} />
            <Route path="/budget" element={<BudgetRoute />} />
            <Route path="/returns" element={<ReturnsRoute />} />
            <Route path="/owner" element={<OwnerRoute />} />
            <Route path="/customers" element={<CustomersRoute />} />
            <Route path="/purchasing" element={<ProcurementRoute />} />
            <Route path="/reports" element={<ReportsRoute />} />
            <Route path="/operations" element={<OperationsRoute />} />
            <Route path="/admin" element={<AdministrationRoute />} />
            <Route path="*" element={<DefaultRoute />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      {reauthenticate ? <ReauthModal onComplete={() => setReauthenticate(false)} /> : null}
    </AppShell>
  );
}

export function App(): React.JSX.Element {
  return (
    <HashRouter>
      <RoutedWorkspace />
    </HashRouter>
  );
}
