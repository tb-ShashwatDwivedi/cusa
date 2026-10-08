/** Wazuh remoted max message size (docs/README.md §3.2). */
export const MAX_WAZUH_PLAINTEXT_BYTES = 65536;

/** @param {string} plaintext */
export function truncatePlaintext(plaintext) {
  if (Buffer.byteLength(plaintext, 'utf8') <= MAX_WAZUH_PLAINTEXT_BYTES) return plaintext;
  const prefix = 'f:EventChannel:';
  if (!plaintext.startsWith(prefix)) {
    return Buffer.from(plaintext, 'utf8').subarray(0, MAX_WAZUH_PLAINTEXT_BYTES).toString('utf8');
  }
  try {
    const json = plaintext.slice(prefix.length);
    const obj = JSON.parse(json);
    const eventXml = typeof obj.Event === 'string' ? obj.Event : '';
    const head = `${prefix}{"Message":"","Event":"`;
    const tail = '"}';
    const budget = MAX_WAZUH_PLAINTEXT_BYTES - Buffer.byteLength(head + tail, 'utf8') - 64;
    const trimmed = Buffer.from(eventXml, 'utf8').subarray(0, Math.max(0, budget)).toString('utf8');
    return `${head}${trimmed}${tail}`;
  } catch {
    return Buffer.from(plaintext, 'utf8').subarray(0, MAX_WAZUH_PLAINTEXT_BYTES).toString('utf8');
  }
}
