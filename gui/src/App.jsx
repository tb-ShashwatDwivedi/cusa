import { useMemo } from 'react';
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
} from '@phosphor-icons/react';
import { api } from './services/api.js';
import { usePoll } from './hooks/usePoll.js';
import { StatusPill } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Collectors from './pages/Collectors.jsx';
import Configuration from './pages/Configuration.jsx';
import Fim from './pages/Fim.jsx';
import Compliance from './pages/Compliance.jsx';
import Diagnostics from './pages/Diagnostics.jsx';
import Logs from './pages/Logs.jsx';

const links = [
  { to: '/', label: 'Dashboard', icon: SquaresFour },
  { to: '/collectors', label: 'Collectors', icon: Database },
  { to: '/configuration', label: 'Configuration', icon: GearSix },
  { to: '/fim', label: 'FIM', icon: FolderLock },
  { to: '/compliance', label: 'Compliance', icon: ShieldCheck },
  { to: '/logs', label: 'Logs', icon: Scroll },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope },
];

const pageTitles = {
  '/': 'Dashboard',
  '/collectors': 'Collectors',
  '/configuration': 'Configuration',
  '/fim': 'File Integrity Monitoring',
  '/compliance': 'Compliance',
  '/logs': 'Logs',
  '/diagnostics': 'Diagnostics',
};

export default function App() {
  const location = useLocation();
  const { data: status, error } = usePoll(() => api.status(), 5000);

  const connected = status?.transportConnected;
  const pageTitle = pageTitles[location.pathname] || 'CUSA Agent';

  const connectionTone = error ? 'err' : connected ? 'ok' : 'warn';
  const connectionLabel = error ? 'Agent offline' : connected ? 'Connected' : 'Disconnected';

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

        <div className="sidebar-footer">
          <div className="agent-mini">
            <StatusPill label={connectionLabel} tone={connectionTone} pulse={connected && !error} />
          </div>
        </div>
      </aside>

      <div className="shell">
        <header className="topbar">
          <span className="topbar-title">{pageTitle}</span>
          <div className="topbar-meta">
            {lastSync && <span className="sync-time">Synced {lastSync}</span>}
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
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
