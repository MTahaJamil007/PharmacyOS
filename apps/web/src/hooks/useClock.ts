import { useEffect, useState } from 'react';

export function useClock(timeZone?: string): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [timeZone]);
  return now;
}
