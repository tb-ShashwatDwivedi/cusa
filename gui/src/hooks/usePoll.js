import { useState, useEffect, useRef } from 'react';

/** @param {() => Promise<any>} fetcher @param {number} intervalMs */
export function usePoll(fetcher, intervalMs = 5000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let id;

    const tick = async () => {
      if (!active || inFlight) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      inFlight = true;
      try {
        const result = await fetcherRef.current();
        if (active) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    };

    const onVisibility = () => {
      if (!document.hidden) tick();
    };

    tick();
    id = setInterval(tick, intervalMs);
    document.addEventListener?.('visibilitychange', onVisibility);

    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener?.('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return { data, error, loading };
}
