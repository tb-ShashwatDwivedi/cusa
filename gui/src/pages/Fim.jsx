import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';
import {
  DataTable,
  ErrorBanner,
  MetricGrid,
  PageHeader,
  Section,
  StatCard,
} from '../components/ui.jsx';

export default function Fim() {
  const { data, error, loading } = usePoll(() => api.fim(), 5000);

  if (error) {
    return <ErrorBanner>Agent unreachable: {error}</ErrorBanner>;
  }

  const baseline = data?.baseline || {};
  const rows = Object.entries(baseline).map(([path, info]) => ({
    id: path,
    path,
    size: info.size ?? '—',
    hash: info.hash ? `${info.hash.slice(0, 12)}…` : 'dir',
  }));

  const columns = [
    { key: 'path', label: 'Path', mono: true, render: (r) => r.path },
    { key: 'size', label: 'Size', mono: true },
    { key: 'hash', label: 'SHA-256', mono: true },
  ];

  return (
    <>
      <PageHeader
        title="File integrity monitoring"
        description="Monitored paths with SHA-256 baselines synced via Wazuh state protocol."
      />

      <MetricGrid>
        <StatCard label="Monitored paths" value={data?.paths?.length ?? 0} loading={loading && !data} />
        <StatCard label="Baseline entries" value={data?.count ?? 0} loading={loading && !data} mono />
      </MetricGrid>

      <Section title="Baseline">
        {loading && !data ? (
          <div className="empty-state">
            <p className="empty-title">Loading FIM baseline…</p>
          </div>
        ) : (
          <DataTable columns={columns} rows={rows} emptyMessage="No baseline entries yet" />
        )}
      </Section>
    </>
  );
}
