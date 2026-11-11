import { useState, useCallback } from 'react';
import { X } from '@phosphor-icons/react';
import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';
import {
  Badge,
  EmptyState,
  ErrorBanner,
  PageHeader,
} from '../components/ui.jsx';

const TABS = [
  { id: 'agent', label: 'Agent' },
  { id: 'collected', label: 'Collected' },
  { id: 'system', label: 'System' },
];

const LEVEL_TONE = {
  error: 'err',
  fatal: 'err',
  warn: 'warn',
  info: 'neutral',
  debug: 'neutral',
  trace: 'neutral',
};

function formatTime(ts) {
  return new Date(ts).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });
}

function formatRaw(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return JSON.stringify(raw, null, 2);
}

export default function Logs() {
  const [tab, setTab] = useState('agent');
  const [selected, setSelected] = useState(null);
  const fetchLogs = useCallback(
    () => api.logs({ category: tab, limit: 200 }),
    [tab],
  );
  const { data, error, loading } = usePoll(fetchLogs, 5000);

  const logs = data?.logs || [];

  if (error) {
    return <ErrorBanner>Agent unreachable: {error}</ErrorBanner>;
  }

  const columns =
    tab === 'collected'
      ? ['time', 'source', 'channel', 'preview']
      : ['time', 'level', 'message'];

  return (
    <>
      <PageHeader
        title="Logs"
        description="Agent lifecycle, collected events, and system output. Click a row to view full details."
      />

      <div className="log-tabs" role="tablist" aria-label="Log categories">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`log-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => {
              setTab(t.id);
              setSelected(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={`logs-layout${selected ? ' logs-layout--open' : ''}`}>
        <div className="logs-table-pane">
          {loading && !data ? (
            <div className="table-wrap">
              <div className="empty-state">
                <p className="empty-title">Loading logs…</p>
              </div>
            </div>
          ) : logs.length === 0 ? (
            <EmptyState title="No log entries" detail="Entries appear as the agent runs." />
          ) : (
            <div className="table-wrap">
              <table className="data-table logs-table">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className={col === 'time' ? 'mono' : ''}>
                        {col.charAt(0).toUpperCase() + col.slice(1)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr
                      key={row.id}
                      className={selected?.id === row.id ? 'selected' : ''}
                      onClick={() => setSelected(row)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setSelected(row)}
                    >
                      <td className="mono">{formatTime(row.ts)}</td>
                      {tab === 'collected' ? (
                        <>
                          <td>{row.source || '—'}</td>
                          <td className="mono">{row.channel || '—'}</td>
                          <td className="log-preview">{row.preview || row.message}</td>
                        </>
                      ) : (
                        <>
                          <td>
                            <Badge tone={LEVEL_TONE[row.level] || 'neutral'}>
                              {row.level}
                            </Badge>
                          </td>
                          <td>{row.message}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selected && (
          <aside className="log-detail-panel" aria-label="Log detail">
            <div className="log-detail-header">
              <div>
                <div className="log-detail-title">{selected.message}</div>
                <div className="log-detail-meta mono">
                  {formatTime(selected.ts)} · {selected.level}
                  {selected.source && ` · ${selected.source}`}
                </div>
              </div>
              <button
                type="button"
                className="log-detail-close"
                aria-label="Close detail panel"
                onClick={() => setSelected(null)}
              >
                <X size={18} />
              </button>
            </div>
            <pre className="code-block log-detail-body">
              {formatRaw(selected.raw ?? selected.meta ?? selected)}
            </pre>
          </aside>
        )}
      </div>
    </>
  );
}
