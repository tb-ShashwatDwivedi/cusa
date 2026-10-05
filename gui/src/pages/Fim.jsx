import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';

export default function Fim() {
  const { data, error } = usePoll(() => api.config(), 10000);
  const paths = data?.effective?.fim?.paths || [];

  if (error) return <div className="error-banner">Agent unreachable: {error}</div>;

  return (
    <>
      <h2>File Integrity Monitoring</h2>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="label">Monitored paths</div>
        <div className="value" style={{ fontSize: '1rem' }}>
          {paths.length ? paths.join(', ') : 'No paths configured'}
        </div>
      </div>
      <p style={{ color: 'var(--muted)' }}>
        FIM uses filesystem watchers with SHA-256 baselines. Changes sync via Wazuh state protocol.
      </p>
    </>
  );
}
