/**
 * Wazuh H/E JSON batch framing (for managers that accept batched plaintext).
 * Wazuh Manager 4.11.2 remoted uses legacy per-message queue lines by default;
 * use via profile.batchJson when enabled.
 */

import { padAgentId } from './crypto.js';

/**
 * @param {object} opts
 * @param {string} opts.agentId
 * @param {string} [opts.name]
 * @param {string} [opts.version]
 * @param {object} [opts.host]
 */
export function buildAgentHeader(opts) {
  const id = padAgentId(opts.agentId);
  const header = {
    wazuh: {
      agent: {
        id,
        ...(opts.name ? { name: opts.name } : {}),
        ...(opts.version ? { version: opts.version } : {}),
        ...(opts.host ? { host: opts.host } : {}),
      },
    },
  };
  return `H ${JSON.stringify(header)}`;
}

/** @param {object} event */
export function buildEventLine(event) {
  return `E ${JSON.stringify(event)}`;
}

/**
 * @param {object} headerOpts
 * @param {object[]} events
 * @returns {string}
 */
export function createBatch(headerOpts, events) {
  const lines = [buildAgentHeader(headerOpts)];
  for (const ev of events) {
    lines.push(buildEventLine(ev));
  }
  return `${lines.join('\n')}\n`;
}
