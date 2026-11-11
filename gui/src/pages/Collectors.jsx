import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';
import {
  Badge,
  DataTable,
  ErrorBanner,
  PageHeader,
  StatusPill,
} from '../components/ui.jsx';

export default function Collectors() {
  const { data, error, loading } = usePoll(api.collectors, 15000);

  if (error) {
    return <ErrorBanner>Agent unreachable: {error}</ErrorBanner>;
  }

  const entries = Object.entries(data || {});

  const rows = entries.map(([name, info]) => ({
    id: name,
    name,
    status: info.status,
    source: 'Local',
    locked: false,
  }));

  const columns = [
    {
      key: 'name',
      label: 'Collector',
      mono: true,
      render: (row) => row.name,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <StatusPill
          label={row.status}
          tone={row.status === 'running' ? 'ok' : 'warn'}
          pulse={row.status === 'running'}
        />
      ),
    },
    {
      key: 'source',
      label: 'Source',
      render: () => <Badge tone="neutral">Local</Badge>,
    },
    {
      key: 'locked',
      label: 'Locked',
      render: (row) => (
        <Badge tone={row.locked ? 'locked' : 'neutral'}>
          {row.locked ? 'Yes' : 'No'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Collectors"
        description="Telemetry collectors registered on this endpoint and their current runtime state."
      />

      {loading && !data ? (
        <div className="table-wrap">
          <div className="empty-state">
            <p className="empty-title">Loading collectors</p>
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          emptyMessage="No collectors running"
        />
      )}
    </>
  );
}
