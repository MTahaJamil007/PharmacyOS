import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { ErrorBoundary } from './components/ErrorBoundary';
import { ReauthModal } from './components/ReauthModal';
import { LoginScreen } from './LoginScreen';
import { usePharmacyStore } from './store';

const PosRoute = lazy(() => import('./modules/pos/PosRoute'));
const CashRoute = lazy(() => import('./modules/cash/CashRoute'));
const InventoryRoute = lazy(() => import('./modules/inventory/InventoryRoute'));
const ShelvesRoute = lazy(() => import('./modules/shelves/ShelvesRoute'));
const ReturnsRoute = lazy(() => import('./modules/returns/ReturnsRoute'));
const OwnerRoute = lazy(() => import('./modules/dashboard/OwnerRoute'));
const CustomersRoute = lazy(() => import('./modules/customers/CustomersRoute'));
const ProcurementRoute = lazy(() => import('./modules/procurement/ProcurementRoute'));
const ReportsRoute = lazy(() => import('./modules/reports/ReportsRoute'));
const OperationsRoute = lazy(() => import('./modules/operations/OperationsRoute'));
const AdministrationRoute = lazy(() => import('./modules/administration/AdministrationRoute'));
const PlatformRoute = lazy(() => import('./modules/platform/PlatformRoute'));

function RoutedWorkspace(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const location = useLocation();
  const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
  const [reauthenticate, setReauthenticate] = useState(false);
  useEffect(() => {
    const requireAuthentication = (): void => setReauthenticate(true);
    window.addEventListener('pharmacy:unauthorized', requireAuthentication);
    return () => window.removeEventListener('pharmacy:unauthorized', requireAuthentication);
  }, []);

  if (!session && !previewMode) return <LoginScreen />;
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<main className="route-loading">Opening workspace…</main>}>
        <Routes>
          <Route path="/pos" element={<PosRoute />} />
          <Route path="/cash" element={<CashRoute />} />
          <Route path="/inventory" element={<InventoryRoute />} />
          <Route path="/shelves" element={<ShelvesRoute />} />
          <Route path="/returns" element={<ReturnsRoute />} />
          <Route path="/owner" element={<OwnerRoute />} />
          <Route path="/customers" element={<CustomersRoute />} />
          <Route path="/purchasing" element={<ProcurementRoute />} />
          <Route path="/reports" element={<ReportsRoute />} />
          <Route path="/operations" element={<OperationsRoute />} />
          <Route path="/admin" element={<AdministrationRoute />} />
          <Route path="/platform" element={<PlatformRoute />} />
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
