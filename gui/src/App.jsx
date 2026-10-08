import { useEffect, useMemo } from 'react';
import { NavLink, Routes, Route, useLocation } from 'react-router-dom';
import {
  SquaresFour,
  Database,
  GearSix,
  FolderLock,
  ShieldCheck,
  Stethoscope,
  Shield,
  Scroll,
  Prohibit,
} from '@phosphor-icons/react';
import { api, setApiToken } from './services/api.js';
import { usePoll } from './hooks/usePoll.js';
import { StatusPill } from './components/ui.jsx';
import { EnrollmentStatus } from './components/enrollment.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Collectors from './pages/Collectors.jsx';
import Configuration from './pages/Configuration.jsx';
import Fim from './pages/Fim.jsx';
import Compliance from './pages/Compliance.jsx';
import Diagnostics from './pages/Diagnostics.jsx';
import Logs from './pages/Logs.jsx';
import Decommission from './pages/Decommission.jsx';

const links = [
  { to: '/', label: 'Dashboard', icon: SquaresFour },
  { to: '/collectors', label: 'Collectors', icon: Database },
  { to: '/configuration', label: 'Configuration', icon: GearSix },
  { to: '/fim', label: 'FIM', icon: FolderLock },
  { to: '/compliance', label: 'Compliance', icon: ShieldCheck },
  { to: '/logs', label: 'Logs', icon: Scroll },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope },
  { to: '/decommission', label: 'Decommission', icon: Prohibit },
];

const pageTitles = {
  '/': 'Dashboard',
  '/collectors': 'Collectors',
  '/configuration': 'Configuration',
  '/fim': 'File Integrity Monitoring',
  '/compliance': 'Compliance',
  '/logs': 'Logs',
  '/diagnostics': 'Diagnostics',
  '/decommission': 'Decommission',
};

export default function App() {
  const location = useLocation();
  const { data: status, error } = usePoll(() => api.status(), 5000);

  useEffect(() => {
    if (status?.localApiToken) setApiToken(status.localApiToken);
  }, [status?.localApiToken]);

  const serviceUp = !error && status?.serviceRunning !== false;
  const connected = status?.transportConnected;
  const pageTitle = pageTitles[location.pathname] || 'CUSA Agent';

  const connectionTone = error ? 'err' : connected ? 'ok' : 'warn';
  const connectionLabel = error
    ? 'Service offline'
    : connected
      ? 'Manager connected'
      : 'Manager disconnected';
  const serviceLabel = serviceUp ? 'Service running' : 'Service offline';
  const serviceTone = serviceUp ? 'ok' : 'err';

  const lastSync = useMemo(() => {
    if (!status?.lastSync) return null;
    return new Date(status.lastSync).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [status]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <Shield size={18} weight="fill" />
          </div>
          <div className="brand-copy">
            <div className="brand-title">CUSA Agent</div>
            <div className="brand-sub">Endpoint Security</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                <Icon size={18} weight="regular" />
                {l.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="shell">
        <header className="topbar">
          <span className="topbar-title">{pageTitle}</span>
          <div className="topbar-meta">
            {lastSync && <span className="sync-time">Synced {lastSync}</span>}
            <StatusPill label={serviceLabel} tone={serviceTone} pulse={serviceUp} />
            <EnrollmentStatus
              status={status?.enrollment}
              agentId={status?.agentId}
              manager={status?.manager}
              connected={connected}
              compact
            />
            <StatusPill label={connectionLabel} tone={connectionTone} pulse={connected && !error} />
          </div>
        </header>

        <main className="main">
          <div className="page">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/collectors" element={<Collectors />} />
              <Route path="/configuration" element={<Configuration />} />
              <Route path="/fim" element={<Fim />} />
              <Route path="/compliance" element={<Compliance />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/diagnostics" element={<Diagnostics />} />
              <Route path="/decommission" element={<Decommission />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
