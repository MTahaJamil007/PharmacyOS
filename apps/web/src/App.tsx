import { useEffect, useState } from 'react';

import { LoginScreen } from './LoginScreen';
import { OperationalWorkspace, type OperationalView } from './OperationalWorkspace';
import { PosWorkspace } from './PosWorkspace';
import { usePharmacyStore } from './store';

export function App(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
  const [route, setRoute] = useState(window.location.hash.slice(1) || 'pos');
  useEffect(() => {
    const updateRoute = (): void => setRoute(window.location.hash.slice(1) || 'pos');
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);
  if (!session && !previewMode) return <LoginScreen />;
  if (['cash', 'inventory', 'budget', 'returns', 'owner'].includes(route)) {
    return <OperationalWorkspace view={route as OperationalView} />;
  }
  return <PosWorkspace />;
}
