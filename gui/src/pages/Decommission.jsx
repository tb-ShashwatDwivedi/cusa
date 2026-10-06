import { useState } from 'react';
import { api } from '../services/api.js';
import { ErrorBanner, PageHeader } from '../components/ui.jsx';

const STEPS = ['warning', 'confirm', 'done'];

export default function Decommission() {
  const [step, setStep] = useState('warning');
  const [typed, setTyped] = useState('');
  const [includeLogs, setIncludeLogs] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function runPurge() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.decommission({ confirm: 'DECOMMISSION', includeLogs });
      setResult(res);
      setStep('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Decommission endpoint"
        description="Remove agent identity, queues, and configuration from this machine. The Windows service and program files are removed separately via uninstall."
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {step === 'warning' && (
        <section className="card decommission-card">
          <h2>Before you continue</h2>
          <ul className="decommission-list">
            <li>Stops the agent and deletes enrollment keys, secrets, queues, and local configuration.</li>
            <li>Does not uninstall the CUSA application — use Add/Remove Programs or <code>msiexec /x</code>.</li>
            <li>For silent uninstall with data purge: <code>msiexec /x CUSA.msi PURGE_DATA=1</code></li>
            <li>Agent logs are preserved unless you choose to delete them.</li>
          </ul>
          <button type="button" className="btn btn-danger" onClick={() => setStep('confirm')}>
            Continue to decommission
          </button>
        </section>
      )}

      {step === 'confirm' && (
        <section className="card decommission-card">
          <h2>Confirm decommission</h2>
          <p>
            Type <strong>DECOMMISSION</strong> to purge endpoint data. This cannot be undone.
          </p>
          <label className="field">
            <span className="field-label">Confirmation</span>
            <input
              className="field-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DECOMMISSION"
              autoComplete="off"
            />
          </label>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={includeLogs}
              onChange={(e) => setIncludeLogs(e.target.checked)}
            />
            Also delete log files under ProgramData
          </label>
          <div className="decommission-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('warning')}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={typed !== 'DECOMMISSION' || busy}
              onClick={runPurge}
            >
              {busy ? 'Purging…' : 'Purge endpoint data'}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && (
        <section className="card decommission-card">
          <h2>Decommission complete</h2>
          <p>Removed: {(result?.removed || []).join(', ') || 'nothing'}</p>
          <p className="muted">
            Re-enroll by configuring the manager again after restart, or reinstall from MSI.
          </p>
        </section>
      )}
    </>
  );
}
