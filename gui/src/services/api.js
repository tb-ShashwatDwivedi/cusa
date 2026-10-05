const BASE = import.meta.env.VITE_AGENT_API || 'http://127.0.0.1:8710';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const api = {
  status: () => get('/api/status'),
  health: () => get('/api/health'),
  metrics: () => get('/api/metrics'),
  collectors: () => get('/api/collectors'),
  config: () => get('/api/config'),
  queue: () => get('/api/queue'),
  diagnostics: () => get('/api/diagnostics'),
};
