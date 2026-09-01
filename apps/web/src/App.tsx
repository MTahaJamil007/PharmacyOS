import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from './components/ErrorBoundary';
import { ReauthModal } from './components/ReauthModal';
import { LoginScreen } from './LoginScreen';
import { usePharmacyStore } from './store';

const PosRoute = lazy(() => import('./modules/pos/PosRoute'));
const CashRoute = lazy(() => import('./modules/cash/CashRoute'));
const InventoryRoute = lazy(() => import('./modules/inventory/InventoryRoute'));
const ReturnsRoute = lazy(() => import('./modules/returns/ReturnsRoute'));
const BudgetRoute = lazy(() => import('./modules/dashboard/BudgetRoute'));
const OwnerRoute = lazy(() => import('./modules/dashboard/OwnerRoute'));
const CustomersRoute = lazy(() => import('./modules/customers/CustomersRoute'));
const AdministrationRoute = lazy(() => import('./modules/administration/AdministrationRoute'));

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
    <ErrorBoundary>
      <Suspense fallback={<main className="route-loading">Opening workspace…</main>}>
        <Routes>
          <Route path="/pos" element={<PosRoute />} />
          <Route path="/cash" element={<CashRoute />} />
          <Route path="/inventory" element={<InventoryRoute />} />
          <Route path="/budget" element={<BudgetRoute />} />
          <Route path="/returns" element={<ReturnsRoute />} />
          <Route path="/owner" element={<OwnerRoute />} />
          <Route path="/customers" element={<CustomersRoute />} />
          <Route path="/admin" element={<AdministrationRoute />} />
          <Route path="*" element={<Navigate replace to="/pos" />} />
        </Routes>
      </Suspense>
      {reauthenticate ? <ReauthModal onComplete={() => setReauthenticate(false)} /> : null}
    </ErrorBoundary>
  );
}

export function App(): React.JSX.Element {
  return (
    <HashRouter>
      <RoutedWorkspace />
    </HashRouter>
  );
}
