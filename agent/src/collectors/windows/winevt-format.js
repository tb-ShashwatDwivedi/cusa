/**
 * Build Wazuh windows_eventchannel payload.
 * Wire: f:EventChannel:{"Message":"...","Event":"<Event xmlns=...>"}
 * @see docs/README.md §4
 */

/**
 * @param {{ Message?: string, Event: string }} parts
 * @returns {string} compact JSON for the log field
 */
export function buildWinevtPayload(parts) {
  if (!parts?.Event || typeof parts.Event !== 'string') {
    throw new Error('Windows EventChannel payload requires Event XML string');
  }
  return JSON.stringify({
    Message: parts.Message || '',
    Event: parts.Event,
  });
}

/** True when JSON already has the required Event field. */
export function isWinevtPayload(raw) {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof obj?.Event === 'string' && obj.Event.includes('<Event');
  } catch {
    return false;
  }
}
