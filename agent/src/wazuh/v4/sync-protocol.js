import { randomUUID } from 'node:crypto';
import { serializeStateItem } from './event-serializer.js';

const ACK_TIMEOUT_MS = 3000;

/**
 * State sync dispatcher — legacy (4.x managers) vs session markers (5.x-released).
 * @see docs/wazuh-compatibility.md §9
 */

/** @param {import('./client.js').WazuhAdapter} adapter @param {object} opts */
export async function runSync(adapter, opts) {
  const { syncMode = 'legacy', items = [] } = opts;
  if (!items.length) return { sessionId: null, sent: 0, mode: syncMode };
  if (syncMode === 'legacy') return runLegacySync(adapter, items);
  return runSyncSession(adapter, opts);
}

/**
 * Wazuh 4.x (incl. 4.11): send `d:index:json` per item — no Start/End session.
 * @param {import('./client.js').WazuhAdapter} adapter
 * @param {object[]} items
 */
async function runLegacySync(adapter, items) {
  for (const item of items) {
    await adapter.sendPlaintext(serializeStateItem(item));
  }
  return { sessionId: null, sent: items.length, mode: 'legacy' };
}

/**
 * Session-oriented sync (5.x-released target).
 * ponytail: text session markers until FlatBuffers wire format is available.
 * @param {import('./client.js').WazuhAdapter} adapter @param {object} opts
 */
async function runSyncSession(adapter, opts) {
  const { module = 'syscollector', items = [], mode = 'delta' } = opts;
  const sessionId = randomUUID();
  const send = (plaintext) => adapter.sendPlaintext(plaintext);

  await send(`#SYNC Start module=${module} mode=${mode} session=${sessionId}`);
  await waitForAck(adapter, `StartAck:${sessionId}`, ACK_TIMEOUT_MS);

  for (const item of items) {
    await send(serializeStateItem(item));
  }

  await send(`#SYNC End session=${sessionId}`);
  await waitForAck(adapter, `EndAck:${sessionId}`, ACK_TIMEOUT_MS);

  return { sessionId, sent: items.length, mode: 'session' };
}

/** @param {import('./client.js').WazuhAdapter} adapter @param {string} marker @param {number} ms */
function waitForAck(adapter, marker, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const handler = (text) => {
      if (text.includes(marker) || text.includes('Ack')) {
        clearTimeout(timer);
        adapter.offSyncAck?.(handler);
        resolve();
      }
    };
    adapter.onSyncAck?.(handler);
  });
}
