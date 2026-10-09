import { endpointIdentity } from '../identity/endpoint-identity.js';

/** @param {object} event @param {string | null} agentId */
export function enrichEvent(event, agentId) {
  const id = endpointIdentity.snapshot(agentId);
  event.agentId = agentId || id.agent_id || event.agentId;
  event.agent = {
    id: event.agentId,
    name: id.hostname,
    version: id.agent_version,
  };
  event.host = {
    ...(event.host || {}),
    hostname: id.hostname,
    os: id.os,
    os_version: id.os_version,
    os_build: id.os_build,
    architecture: id.architecture,
    machine_id: id.machine_id,
    ip: id.ips,
    mac: id.macs,
    primary_ip: id.primary_ip,
  };
  event.metadata = {
    ...(event.metadata || {}),
    agent_version: id.agent_version,
    enrichment_at: new Date().toISOString(),
  };
  return event;
}
