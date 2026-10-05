import { randomUUID } from 'node:crypto';
import os from 'node:os';

/** @param {object} partial @param {object} [ctx] */
export function normalizeEvent(partial, ctx = {}) {
  const now = new Date().toISOString();
  const event = {
    eventId: partial.eventId || randomUUID(),
    timestamp: partial.timestamp || now,
    collectedAt: now,
    source: partial.source,
    host: partial.host || {
      hostname: os.hostname(),
      os: process.platform === 'win32' ? 'Windows' : 'Linux',
      osVersion: os.release(),
      architecture: os.arch(),
      ips: [],
      macs: [],
    },
    event: partial.event || { category: 'unknown' },
    user: partial.user,
    process: partial.process,
    network: partial.network,
    file: partial.file,
    raw: partial.raw,
    metadata: partial.metadata,
  };
  if (ctx.agentId) event.agentId = ctx.agentId;
  return event;
}
