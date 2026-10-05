import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';

export default function Configuration() {
  const { data, error } = usePoll(() => api.config(), 10000);
  const cfg = data?.effective || {};
  const locked = new Set(data?.locked || []);

  if (error) return <div className="error-banner">Agent unreachable: {error}</div>;

  const rows = [
    { key: 'wazuh.manager.address', value: cfg.wazuh?.manager?.address, locked: locked.has('wazuh.manager.address') },
    { key: 'wazuh.version', value: cfg.wazuh?.version },
    { key: 'collectors.eventChannel', value: cfg.collectors?.eventChannel?.enabled ? 'YES' : 'NO' },
    { key: 'collectors.sysmon', value: cfg.collectors?.sysmon?.enabled ? 'YES' : 'NO', locked: true },
    { key: 'queue.memoryLimit', value: cfg.queue?.memoryLimit },
    { key: 'queue.diskLimitMb', value: cfg.queue?.diskLimitMb },
    { key: 'fim.paths', value: (cfg.fim?.paths || []).join(', ') || '—' },
    { key: 'api.port', value: cfg.api?.port },
  ];

  return (
    <>
      <h2>Configuration</h2>
      <table>
        <thead>
          <tr><th>Setting</th><th>Value</th><th>Source</th><th>Locked</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td>{String(r.value ?? '—')}</td>
              <td><span className="tag central">CyberSIO Policy</span></td>
              <td>{r.locked ? <span className="tag locked">YES</span> : 'NO'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
