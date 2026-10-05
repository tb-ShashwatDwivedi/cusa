import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';

export default function Collectors() {
  const { data, error } = usePoll(() => api.collectors());

  if (error) return <div className="error-banner">Agent unreachable: {error}</div>;

  const entries = Object.entries(data || {});

  return (
    <>
      <h2>Collectors</h2>
      <table>
        <thead>
          <tr><th>Collector</th><th>Status</th><th>Source</th><th>Locked</th></tr>
        </thead>
        <tbody>
          {entries.length === 0 && <tr><td colSpan={4}>No collectors running</td></tr>}
          {entries.map(([name, info]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className={info.status === 'running' ? 'status-ok' : 'status-warn'}>{info.status}</td>
              <td><span className="tag">Local</span></td>
              <td>NO</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
