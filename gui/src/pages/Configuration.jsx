import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';
import { useAgentStatus } from '../context/StatusContext.jsx';
import {
  Badge,
  ErrorBanner,
  PageHeader,
} from '../components/ui.jsx';
import { EnrollmentStatus } from '../components/enrollment.jsx';

const FIELDS = [
  { path: 'wazuh.manager.address', label: 'Manager address', type: 'text' },
  { path: 'wazuh.manager.port', label: 'Manager port', type: 'number' },
  { path: 'wazuh.manager.enrollmentPort', label: 'Enrollment port (authd)', type: 'number' },
  { path: 'wazuh.version', label: 'Wazuh protocol version', type: 'text' },
  { path: 'collectors.eventChannel.enabled', label: 'Windows event channel', type: 'boolean' },
  { path: 'collectors.sysmon.enabled', label: 'Sysmon collector', type: 'boolean' },
  { path: 'collectors.defender.enabled', label: 'Defender collector', type: 'boolean' },
  { path: 'collectors.powershell.enabled', label: 'PowerShell collector', type: 'boolean' },
  { path: 'collectors.journald.enabled', label: 'Journald collector', type: 'boolean' },
  { path: 'collectors.syslog.enabled', label: 'Syslog collector', type: 'boolean' },
  { path: 'collectors.auditd.enabled', label: 'Auditd collector', type: 'boolean' },
  { path: 'queue.memoryLimit', label: 'Queue memory limit', type: 'number' },
  { path: 'queue.diskLimitMb', label: 'Queue disk limit (MB)', type: 'number' },
  { path: 'logging.level', label: 'Log level', type: 'select', options: ['trace', 'debug', 'info', 'warn', 'error'] },
  { path: 'fim.paths', label: 'FIM paths (comma-separated)', type: 'paths' },
  { path: 'compliance.policyPath', label: 'Compliance policy path', type: 'text' },
  { path: 'api.port', label: 'Local API port', type: 'number' },
];

function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  const out = { ...obj };
  let cur = out;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...(cur[keys[i]] || {}) };
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return out;
}

function isLocked(path, locked) {
  return locked.some((l) => path === l || path.startsWith(`${l}.`));
}

function toDisplay(path, value, type) {
  if (type === 'secret') return '';
  if (type === 'paths') return Array.isArray(value) ? value.join(', ') : '';
  if (type === 'boolean') return value === true;
  return value ?? '';
}

function fromInput(path, raw, type) {
  if (type === 'boolean') return raw === true || raw === 'true';
  if (type === 'number') return raw === '' ? null : Number(raw);
  if (type === 'paths') {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw === '' ? null : raw;
}

export default function Configuration() {
  const { data, error, loading } = usePoll(api.config, 15000);
  const { data: status } = useAgentStatus();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const cfg = data?.effective || {};
  const locked = data?.locked || [];

  useEffect(() => {
    if (!data?.effective) return;
    const initial = {};
    for (const field of FIELDS) {
      initial[field.path] = toDisplay(field.path, getByPath(data.effective, field.path), field.type);
    }
    setDraft(initial);
    setSaved(false);
  }, [data]);

  const onChange = (path, value) => {
    setDraft((d) => ({ ...d, [path]: value }));
    setSaved(false);
  };

  const onSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      let patch = {};
      for (const field of FIELDS) {
        if (isLocked(field.path, locked)) continue;
        if (field.type === 'secret' && !draft[field.path]) continue;
        const next = fromInput(field.path, draft[field.path], field.type);
        const prev = getByPath(cfg, field.path);
        const same = field.type === 'paths'
          ? JSON.stringify(prev || []) === JSON.stringify(next || [])
          : prev === next;
        if (!same) patch = setByPath(patch, field.path, next);
      }
      if (!Object.keys(patch).length) {
        setSaved(true);
        return;
      }
      await api.patchConfig(patch);
      setSaved(true);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return <ErrorBanner>Agent unreachable: {error}</ErrorBanner>;
  }

  return (
    <>
      <PageHeader
        title="Configuration"
        description="Edit manager address and collector settings. Enrollment uses the built-in CyberSIO credentials. Changing the manager re-registers the agent."
        actions={
          <button type="button" className="btn-primary" onClick={onSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        }
      />

      {saveError && <ErrorBanner>{saveError}</ErrorBanner>}
      {saved && !saveError && (
        <div className="success-banner" role="status">Configuration saved and applied.</div>
      )}

      <EnrollmentStatus
        status={status?.enrollment}
        agentId={status?.agentId}
        manager={status?.manager}
        connected={status?.transportConnected}
        configured={status?.enrollmentConfigured}
      />

      {loading && !data ? (
        <div className="empty-state">
          <p className="empty-title">Loading configuration…</p>
        </div>
      ) : (
        <div className="config-form">
          {FIELDS.reduce((sections, field) => {
            const section = field.section || 'General';
            if (!sections.find((s) => s.title === section)) {
              sections.push({ title: section, fields: [] });
            }
            sections.find((s) => s.title === section).fields.push(field);
            return sections;
          }, []).map((section) => (
            <div key={section.title} className="config-section">
              {section.title !== 'General' && (
                <h3 className="config-section-title">{section.title}</h3>
              )}
              {section.fields.map((field) => {
                const fieldLocked = isLocked(field.path, locked);
                const id = `cfg-${field.path}`;
                const inputType = field.type === 'number'
                  ? 'number'
                  : field.type === 'secret'
                    ? 'password'
                    : 'text';
                return (
                  <label key={field.path} className={`config-field${fieldLocked ? ' config-field--locked' : ''}`}>
                    <span className="config-label">
                      {field.label}
                      {fieldLocked && <Badge tone="locked">Locked</Badge>}
                    </span>
                    {field.type === 'boolean' ? (
                      <input
                        id={id}
                        type="checkbox"
                        checked={!!draft[field.path]}
                        disabled={fieldLocked}
                        onChange={(e) => onChange(field.path, e.target.checked)}
                      />
                    ) : field.type === 'select' ? (
                      <select
                        id={id}
                        value={draft[field.path] || ''}
                        disabled={fieldLocked}
                        onChange={(e) => onChange(field.path, e.target.value)}
                      >
                        {field.options.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={id}
                        type={inputType}
                        className="mono"
                        value={draft[field.path] ?? ''}
                        disabled={fieldLocked}
                        onChange={(e) => onChange(field.path, e.target.value)}
                      />
                    )}
                    <span className="config-path mono">{field.path}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
