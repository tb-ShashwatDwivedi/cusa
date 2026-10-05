const BASE = import.meta.env.VITE_AGENT_API || 'http://127.0.0.1:8710';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function patch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${path}: ${res.status}`);
  }
  return res.json();
}

export const api = {
  status: () => get('/api/status'),
  health: () => get('/api/health'),
  metrics: () => get('/api/metrics'),
  collectors: () => get('/api/collectors'),
  config: () => get('/api/config'),
  patchConfig: (patch) => patch('/api/config', { patch }),
  queue: () => get('/api/queue'),
  diagnostics: () => get('/api/diagnostics'),
  logs: ({ category, limit, since, search } = {}) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (limit) params.set('limit', String(limit));
    if (since) params.set('since', since);
    if (search) params.set('search', search);
    const qs = params.toString();
    return get(`/api/logs${qs ? `?${qs}` : ''}`);
  },
  logById: (id) => get(`/api/logs/${id}`),
  fim: () => get('/api/fim'),
  compliance: () => get('/api/compliance'),
};
