import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';
import {
  Badge,
  DataTable,
  ErrorBanner,
  MetricGrid,
  PageHeader,
  Section,
  StatCard,
} from '../components/ui.jsx';

const STATUS_TONE = { passed: 'ok', failed: 'err', not_applicable: 'neutral' };

export default function Compliance() {
  const { data, error, loading } = usePoll(api.compliance, 15000);

  if (error) {
    return <ErrorBanner>Agent unreachable: {error}</ErrorBanner>;
  }

  const results = data?.results || [];
  const lastAt = data?.lastRun?.at
    ? new Date(data.lastRun.at).toLocaleString()
    : 'Never';

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  const columns = [
    { key: 'checkId', label: 'Check', mono: true },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>,
    },
    { key: 'severity', label: 'Severity' },
    {
      key: 'evidence',
      label: 'Evidence',
      render: (r) => (r.evidence ? String(r.evidence).slice(0, 80) : '—'),
    },
  ];

  return (
    <>
      <PageHeader
        title="Security configuration assessment"
        description="Policy checks and latest evaluation results from this endpoint."
      />

      <MetricGrid>
        <StatCard label="Policy" value={data?.policyPath || 'Not configured'} loading={loading && !data} />
        <StatCard label="Last run" value={lastAt} loading={loading && !data} />
        <StatCard label="Passed" value={passed} tone="ok" loading={loading && !data} mono />
        <StatCard label="Failed" value={failed} tone={failed ? 'err' : 'default'} loading={loading && !data} mono />
      </MetricGrid>

      <Section title="Check results">
        {loading && !data ? (
          <div className="empty-state">
            <p className="empty-title">Loading compliance results…</p>
          </div>
        ) : (
          <DataTable columns={columns} rows={results} emptyMessage="No checks run yet" />
        )}
      </Section>
    </>
  );
}
