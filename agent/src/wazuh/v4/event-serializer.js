/**
 * Map CUSA canonical events to Wazuh queue:location:message plaintext.
 * @see docs/event-schema.md
 */

const COLLECTOR_QUEUE = {
  'event-channel': 'f',
  sysmon: 'f',
  defender: 'f',
  powershell: 'f',
  'file-tail': '1',
  journald: '1',
  syslog: '1',
  auditd: '1',
  fim: '8',
  compliance: 'p',
  inventory: 'd',
  agent: '1',
};

/** @param {object} event */
export function serializeEvent(event) {
  const queue = COLLECTOR_QUEUE[event.source?.collector] || '1';
  const location = event.source?.channel || event.source?.path || event.source?.collector || 'cusa';
  const raw =
    typeof event.raw === 'string' ? event.raw : JSON.stringify(event.raw ?? event);
  return `${queue}:${location}:${raw}`;
}

/** @param {object} item inventory/fim state item */
export function serializeStateItem(item) {
  const index = item.index || '';
  const payload = JSON.stringify(item.data ?? item);
  if (index.includes('fim') || index.includes('registry')) {
    const loc = item.data?.path || item.data?.key || 'syscheck';
    return `8:${loc}:${payload}`;
  }
  if (index.includes('sca')) return `p:sca:${payload}`;
  // Wazuh 4.11 syscollector location is `syscollector`, not OpenSearch index names.
  return `d:syscollector:${payload}`;
}
