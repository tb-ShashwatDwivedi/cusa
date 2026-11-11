import { useState } from 'react';
import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';
import { useAgentStatus } from '../context/StatusContext.jsx';
import {
  ErrorBanner,
  MetricGrid,
  PageHeader,
  Section,
  StatCard,
  StatusPill,
} from '../components/ui.jsx';
import { EnrollmentStatus, enrollmentLabel, enrollmentTone } from '../components/enrollment.jsx';

function fmt(value, fallback = 'n/a') {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
}

export default function Dashboard() {
  const { data: status, error, loading } = useAgentStatus();
  const { data: health, loading: healthLoading } = usePoll(api.health, 15000);
  const { data: service } = usePoll(api.service, 15000);
  const [svcBusy, setSvcBusy] = useState(false);
  const [svcError, setSvcError] = useState(null);
  const [svcMessage, setSvcMessage] = useState(null);

  const runServiceAction = async (action) => {
    setSvcBusy(true);
    setSvcError(null);
    setSvcMessage(null);
    try {
      const result = await api.serviceControl(action);
      setSvcMessage(result.message || `${action} requested`);
    } catch (err) {
      setSvcError(err.message);
    } finally {
      setSvcBusy(false);
    }
  };

  const connected = status?.transportConnected;
  const metrics = status?.metrics || {};
  const healthy = health?.status === 'healthy';
  const queue = status?.queue;
  const busy = loading || healthLoading;

  return (
    <>
      <PageHeader
        title="Operations overview"
        description="Live agent identity, connectivity, and runtime metrics from the local endpoint service."
        actions={
          <div className="service-controls">
            <button
              type="button"
              className="btn-secondary"
              disabled={svcBusy || service?.state === 'running'}
              onClick={() => runServiceAction('start')}
            >
              Start
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={svcBusy || (!service?.processRunning && service?.state !== 'running')}
              onClick={() => runServiceAction('stop')}
            >
              Stop
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={svcBusy}
              onClick={() => runServiceAction('restart')}
            >
              Restart
            </button>
          </div>
        }
      />

      {error && (
        <ErrorBanner>
          Agent unreachable: {error}. Use Start below if the Windows service is stopped.
        </ErrorBanner>
      )}
      {svcError && <ErrorBanner>{svcError}</ErrorBanner>}
      {svcMessage && (
        <div className="success-banner" role="status">{svcMessage}</div>
      )}

      <div className="hero-strip">
        <div className="hero-strip-main">
          <span className="hero-strip-title">{fmt(status?.hostname, 'Endpoint')}</span>
          <span className="hero-strip-sub">
            {fmt(status?.agentId, 'agent-id pending')} · v{fmt(status?.version, '0.0.0')}
          </span>
        </div>
        <div className="hero-strip-badges">
          <EnrollmentStatus
            status={status?.enrollment}
            agentId={status?.agentId}
            manager={status?.manager}
            connected={connected}
            compact
          />
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
            value={enrollmentLabel(status?.enrollment)}
            hint={status?.agentId ? `ID ${status.agentId}` : undefined}
            loading={busy && !status}
            tone={enrollmentTone(status?.enrollment, connected)}
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
