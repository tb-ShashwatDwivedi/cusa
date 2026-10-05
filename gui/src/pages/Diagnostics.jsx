import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';

export default function Diagnostics() {
  const { data, error } = usePoll(() => api.diagnostics(), 3000);

  if (error) return <div className="error-banner">Agent unreachable: {error}</div>;

  return (
    <>
      <h2>Diagnostics</h2>
      <pre style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '1rem',
        overflow: 'auto',
        fontSize: '0.85rem',
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </>
  );
}
