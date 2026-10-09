import os from 'node:os';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { AGENT_VERSION } from '../core/version.js';

/** Cached endpoint identity (refresh on long interval). */
export class EndpointIdentity {
  constructor() {
    this.cache = null;
    this.cacheAt = 0;
    this.ttlMs = 5 * 60 * 1000;
  }

  /** @param {string | null} agentId */
  snapshot(agentId = null) {
    const now = Date.now();
    if (this.cache && now - this.cacheAt < this.ttlMs) {
      return { ...this.cache, agent_id: agentId || this.cache.agent_id };
    }
    const ifaces = networkInterfaces();
    const ips = [];
    const macs = [];
    for (const addrs of Object.values(ifaces)) {
      for (const a of addrs || []) {
        if (!a.internal) ips.push(a.address);
        if (a.mac && a.mac !== '00:00:00:00:00:00') macs.push(a.mac);
      }
    }
    const primaryIp = ips.find((ip) => !ip.includes(':')) || ips[0] || null;
    const machineId = createHash('sha256')
      .update(`${os.hostname()}:${os.userInfo().username}:${os.arch()}`)
      .digest('hex')
      .slice(0, 32);
    this.cache = {
      agent_id: agentId,
      agent_version: AGENT_VERSION,
      hostname: os.hostname(),
      computer_name: os.hostname(),
      os: process.platform === 'win32' ? 'Windows' : 'Linux',
      os_version: os.release(),
      os_build: process.platform === 'win32' ? os.release() : os.release(),
      architecture: os.arch(),
      machine_id: machineId,
      primary_ip: primaryIp,
      ips,
      macs,
    };
    this.cacheAt = now;
    return { ...this.cache, agent_id: agentId || this.cache.agent_id };
  }
}

export const endpointIdentity = new EndpointIdentity();
