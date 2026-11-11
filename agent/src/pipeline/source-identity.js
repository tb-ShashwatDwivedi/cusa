import { createHash } from 'node:crypto';

/**
 * Stable source identity for replay suppression (never EventID-only).
 * @param {object} event canonical event
 * @returns {string | null} null when identity is uncertain
 */
export function sourceEventIdentity(event) {
  const meta = event.metadata?.windows;
  if (meta?.channel && meta.recordId != null) {
    const parts = [
      event.host?.machine_id || event.host?.hostname || '',
      meta.channel,
      meta.provider || '',
      String(meta.recordId),
      meta.logCreationTime || '',
    ];
    return parts.join('|');
  }
  const src = event.source || {};
  if (src.collector && event.metadata?.sourceRecordId != null) {
    return [
      event.host?.machine_id || '',
      src.collector,
      src.channel || '',
      String(event.metadata.sourceRecordId),
    ].join('|');
  }
  return null;
}

/** @param {string} id */
export function hashIdentity(id) {
  return createHash('sha256').update(id).digest('hex').slice(0, 32);
}
