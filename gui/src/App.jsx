import { NavLink, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Collectors from './pages/Collectors.jsx';
import Configuration from './pages/Configuration.jsx';
import Fim from './pages/Fim.jsx';
import Compliance from './pages/Compliance.jsx';
import Diagnostics from './pages/Diagnostics.jsx';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/collectors', label: 'Collectors' },
  { to: '/configuration', label: 'Configuration' },
  { to: '/fim', label: 'FIM' },
  { to: '/compliance', label: 'Compliance' },
  { to: '/diagnostics', label: 'Diagnostics' },
];

export default function App() {
  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>CUSA Agent</h1>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/collectors" element={<Collectors />} />
          <Route path="/configuration" element={<Configuration />} />
          <Route path="/fim" element={<Fim />} />
          <Route path="/compliance" element={<Compliance />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
        </Routes>
      </main>
    </div>
  );
}
