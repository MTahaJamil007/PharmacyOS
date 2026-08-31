import { useEffect, useState } from 'react';

import { checkLanHealth } from '../api';

export type LanStatus = 'CHECKING' | 'READY' | 'UNAVAILABLE';

export function useLanStatus(): LanStatus {
  const [status, setStatus] = useState<LanStatus>('CHECKING');
  useEffect(() => {
    let active = true;
    const probe = async (): Promise<void> => {
      try {
        await checkLanHealth();
        if (active) setStatus('READY');
      } catch {
        if (active) setStatus('UNAVAILABLE');
      }
    };
    void probe();
    const timer = window.setInterval(() => void probe(), 15_000);
    const online = (): void => void probe();
    const offline = (): void => setStatus('UNAVAILABLE');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
  return status;
}
