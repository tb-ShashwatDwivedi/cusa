import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';
import {
  ErrorBanner,
  MetricGrid,
  PageHeader,
  Section,
  StatCard,
  StatusPill,
} from '../components/ui.jsx';

function fmt(value, fallback = 'n/a') {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
}

export default function Dashboard() {
  const { data: status, error, loading } = usePoll(() => api.status());
  const { data: queue, loading: queueLoading } = usePoll(() => api.queue());
  const { data: health, loading: healthLoading } = usePoll(() => api.health());

  if (error) {
    return (
      <ErrorBanner>
        Agent unreachable: {error}. Start the agent service before opening the console.
      </ErrorBanner>
    );
  }

  const connected = status?.transportConnected;
  const metrics = status?.metrics || {};
  const healthy = health?.status === 'healthy';
  const busy = loading || queueLoading || healthLoading;

  return (
    <>
      <PageHeader
        title="Operations overview"
        description="Live agent identity, connectivity, and runtime metrics from the local endpoint service."
      />

      <div className="hero-strip">
        <div className="hero-strip-main">
          <span className="hero-strip-title">{fmt(status?.hostname, 'Endpoint')}</span>
          <span className="hero-strip-sub">
            {fmt(status?.agentId, 'agent-id pending')} · v{fmt(status?.version, '0.0.0')}
          </span>
        </div>
        <div className="hero-strip-badges">
          <StatusPill
            label={connected ? 'Manager connected' : 'Manager disconnected'}
            tone={connected ? 'ok' : 'err'}
            pulse={connected}
          />
          <StatusPill
            label={healthy ? 'Health check passed' : fmt(health?.status, 'Health unknown')}
            tone={healthy ? 'ok' : 'warn'}
          />
        </div>
      </div>

      <Section title="Identity">
        <MetricGrid>
          <StatCard label="Agent ID" value={fmt(status?.agentId)} loading={busy && !status} />
          <StatCard label="Hostname" value={fmt(status?.hostname)} loading={busy && !status} />
          <StatCard label="Version" value={fmt(status?.version)} loading={busy && !status} mono />
          <StatCard
            label="Enrollment"
            value={fmt(status?.enrollment)}
            loading={busy && !status}
            tone="accent"
          />
        </MetricGrid>
      </Section>

      <Section title="Connectivity">
        <MetricGrid>
          <StatCard
            label="Manager"
            value={fmt(status?.manager, 'Not configured')}
            loading={busy && !status}
          />
          <StatCard
            label="Connection"
            value={connected ? 'Connected' : 'Disconnected'}
            tone={connected ? 'ok' : 'err'}
            loading={busy && !status}
          />
          <StatCard
            label="Config version"
            value={fmt(status?.configVersion, '0')}
            loading={busy && !status}
            mono
          />
        </MetricGrid>
      </Section>

      <Section title="Performance">
        <MetricGrid>
          <StatCard
            label="Events per second"
            value={fmt(metrics.eventsPerSec, '0.00')}
            loading={busy && !status}
            mono
          />
          <StatCard
            label="Queue depth"
            value={fmt(queue?.depth, '0')}
            loading={busy && !queue}
            mono
          />
          <StatCard
            label="Memory (MB)"
            value={fmt(metrics.memoryMb)}
            loading={busy && !status}
            mono
          />
          <StatCard
            label="Uptime (sec)"
            value={fmt(metrics.uptimeSec)}
            loading={busy && !status}
            mono
          />
          <StatCard
            label="Health"
            value={fmt(health?.status)}
            tone={healthy ? 'ok' : 'warn'}
            loading={busy && !health}
          />
        </MetricGrid>
      </Section>
    </>
  );
}
