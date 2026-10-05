import { randomUUID } from 'node:crypto';
import { serializeStateItem } from './event-serializer.js';

const ACK_TIMEOUT_MS = 3000;

/**
 * Session-oriented state sync over secure messages.
 * ponytail: text session markers until FlatBuffers wire format is available.
 * @see docs/wazuh-compatibility.md §9
 */

/** @param {import('./client.js').WazuhAdapter} adapter @param {object} opts */
export async function runSyncSession(adapter, opts) {
  const { module = 'syscollector', items = [], mode = 'delta' } = opts;
  if (!items.length) return { sessionId: null, sent: 0 };
  const sessionId = randomUUID();
  const send = (plaintext) => adapter.sendPlaintext(plaintext);

  await send(`#SYNC Start module=${module} mode=${mode} session=${sessionId}`);
  await waitForAck(adapter, `StartAck:${sessionId}`, ACK_TIMEOUT_MS);

  for (const item of items) {
    await send(serializeStateItem(item));
  }

  await send(`#SYNC End session=${sessionId}`);
  await waitForAck(adapter, `EndAck:${sessionId}`, ACK_TIMEOUT_MS);

  return { sessionId, sent: items.length };
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
