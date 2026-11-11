/**
 * Map CUSA canonical events to Wazuh queue:location:message plaintext.
 * @see docs/README.md §3.4 / §4
 */

import { serializeInventoryDbsync } from '../../inventory/dbsync-wire.js';

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

const EVENTCHANNEL_COLLECTORS = new Set(['event-channel', 'sysmon', 'defender', 'powershell']);

/** @param {object} event */
export function serializeEvent(event) {
  const collector = event.source?.collector;
  const queue = COLLECTOR_QUEUE[collector] || '1';
  // Wazuh winevtchannel requires location exactly EventChannel for queue f.
  const location = EVENTCHANNEL_COLLECTORS.has(collector)
    ? 'EventChannel'
    : event.source?.channel || event.source?.path || collector || 'cusa';
  const raw =
    typeof event.raw === 'string' ? event.raw : JSON.stringify(event.raw ?? event);
  return `${queue}:${location}:${raw}`;
}

/** @param {object} item inventory/fim state item */
export function serializeStateItem(item) {
  const index = item.index || '';
  if (index.includes('fim') || index.includes('registry')) {
    const payload = JSON.stringify({
      source: index.includes('registry') ? 'cusa_registry' : 'cusa_fim',
      ...(item.data ?? item),
      type: item.operation === 'delete' ? 'deletion' : 'modification',
    });
    return `1:${index.includes('registry') ? 'cusa-registry' : 'cusa-fim'}:${payload}`;
  }
  if (index.includes('sca')) return `p:sca:${JSON.stringify(item.data ?? item)}`;
  if (index.includes('inventory') || item.category) {
    return serializeInventoryDbsync(item);
  }
  const payload = JSON.stringify(item.data ?? item);
  return `d:syscollector:${payload}`;
}
