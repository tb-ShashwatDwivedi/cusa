import { StatusPill } from './ui.jsx';

export function enrollmentLabel(status) {
  if (status === 'enrolled') return 'Enrolled';
  if (status === 'pending') return 'Enrollment pending';
  if (!status) return 'Not enrolled';
  return String(status);
}

export function enrollmentTone(status, connected) {
  if (status === 'enrolled' && connected) return 'ok';
  if (status === 'enrolled') return 'warn';
  if (status === 'pending') return 'warn';
  return 'err';
}

export function EnrollmentStatus({
  status,
  agentId,
  manager,
  connected,
  configured,
  compact,
}) {
  const tone = enrollmentTone(status, connected);
  const label = enrollmentLabel(status);

  if (compact) {
    return <StatusPill label={label} tone={tone} pulse={status === 'enrolled' && connected} />;
  }

  let detail = 'No manager configured — set manager address and save';
  if (status === 'enrolled') {
    detail = `Agent ID ${agentId || 'unknown'} registered with ${manager || 'manager'}`;
  } else if (status === 'pending' && !manager) {
    detail = 'No manager configured — set manager address and save';
  } else if (status === 'pending') {
    detail = `Waiting to enroll with ${manager} — check manager is reachable on 1515/55000 and 1514`;
  }

  return (
    <div className={`enrollment-banner enrollment-banner--${tone}`} role="status">
      <div className="enrollment-banner-main">
        <StatusPill label={label} tone={tone} pulse={status === 'enrolled' && connected} />
        <span className="enrollment-banner-detail">{detail}</span>
      </div>
    </div>
  );
}
