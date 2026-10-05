export function PageHeader({ title, description, actions }) {
  return (
    <header className="page-header">
      <div>
        <h2>{title}</h2>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function StatCard({ label, value, hint, tone = 'default', loading, mono }) {
  if (loading) {
    return (
      <div className="stat-card stat-card--loading" aria-hidden="true">
        <div className="skeleton skeleton-label" />
        <div className="skeleton skeleton-value" />
      </div>
    );
  }

  return (
    <div className={`stat-card stat-card--${tone}`}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value${mono ? ' mono' : ''}`}>{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function StatusPill({ label, tone = 'neutral', pulse }) {
  return (
    <span className={`status-pill status-pill--${tone}`}>
      <span className={`status-dot ${pulse ? 'status-dot--pulse' : ''}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function ErrorBanner({ children }) {
  return (
    <div className="error-banner" role="alert">
      {children}
    </div>
  );
}

export function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {detail && <p className="empty-detail">{detail}</p>}
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <section className="section">
      {title && <h3 className="section-title">{title}</h3>}
      {children}
    </section>
  );
}

export function DataTable({ columns, rows, emptyMessage }) {
  if (!rows?.length) {
    return <EmptyState title={emptyMessage || 'No records'} />;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.mono ? 'mono' : ''}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {columns.map((col) => (
                <td key={col.key} className={col.mono ? 'mono' : ''}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeBlock({ children }) {
  return <pre className="code-block">{children}</pre>;
}

export function PathList({ paths }) {
  if (!paths?.length) {
    return <EmptyState title="No paths configured" detail="Add FIM paths in agent policy to begin monitoring." />;
  }

  return (
    <ul className="path-list">
      {paths.map((path) => (
        <li key={path} className="path-item">
          <code>{path}</code>
        </li>
      ))}
    </ul>
  );
}

export function MetricGrid({ children }) {
  return <div className="metric-grid">{children}</div>;
}
