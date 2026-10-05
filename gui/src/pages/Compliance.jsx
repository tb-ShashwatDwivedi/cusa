import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';

export default function Compliance() {
  const { data, error } = usePoll(() => api.config(), 10000);
  const policy = data?.effective?.compliance?.policyPath;

  if (error) return <div className="error-banner">Agent unreachable: {error}</div>;

  return (
    <>
      <h2>Compliance (SCA)</h2>
      <div className="grid">
        <div className="card">
          <div className="label">Policy</div>
          <div className="value" style={{ fontSize: '1rem' }}>{policy || 'Not configured'}</div>
        </div>
        <div className="card">
          <div className="label">Check interval</div>
          <div className="value" style={{ fontSize: '1rem' }}>
            {data?.effective?.compliance?.intervalMs
              ? `${Math.round(data.effective.compliance.intervalMs / 3600000)}h`
              : '—'}
          </div>
        </div>
      </div>
    </>
  );
}
