import { useState, useEffect } from 'react';

/** @param {() => Promise<any>} fetcher @param {number} intervalMs */
export function usePoll(fetcher, intervalMs = 5000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const result = await fetcher();
        if (active) { setData(result); setError(null); }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { active = false; clearInterval(id); };
  }, [fetcher, intervalMs]);

  return { data, error, loading };
}
