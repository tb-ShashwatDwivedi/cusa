import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';

export default function Dashboard() {
  const { data: status, error } = usePoll(() => api.status());
  const { data: queue } = usePoll(() => api.queue());
  const { data: health } = usePoll(() => api.health());

  if (error) return <div className="error-banner">Agent unreachable: {error}. Start the agent service first.</div>;

  const connected = status?.transportConnected;
  const metrics = status?.metrics || {};

  return (
    <>
      <h2>Dashboard</h2>
      <div className="grid">
        <Card label="Agent ID" value={status?.agentId || '—'} />
        <Card label="Hostname" value={status?.hostname || '—'} />
        <Card label="Version" value={status?.version || '—'} />
        <Card label="Manager" value={status?.manager || 'Not configured'} />
        <Card
          label="Connection"
          value={connected ? 'Connected' : 'Disconnected'}
          className={connected ? 'status-ok' : 'status-err'}
        />
        <Card label="Enrollment" value={status?.enrollment || '—'} />
        <Card label="Config Version" value={status?.configVersion ?? 0} />
        <Card label="Events/sec" value={metrics.eventsPerSec || '0.00'} />
        <Card label="Queue Depth" value={queue?.depth ?? 0} />
        <Card label="Memory (MB)" value={metrics.memoryMb ?? '—'} />
        <Card label="Uptime (sec)" value={metrics.uptimeSec ?? '—'} />
        <Card
          label="Health"
          value={health?.status || '—'}
          className={health?.status === 'healthy' ? 'status-ok' : 'status-warn'}
        />
      </div>
    </>
  );
}

function Card({ label, value, className = '' }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`value ${className}`}>{value}</div>
    </div>
  );
}
