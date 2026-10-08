import { createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

const AES_IV = Buffer.from('FEDCBA0987654321', 'utf8');

/** @param {string} pass @param {string} name @param {string} id */
export function deriveEncryptionKey(pass, name, id) {
  const sum2 = createHash('md5').update(pass).digest('hex');
  const sum1 = createHash('md5')
    .update(createHash('md5').update(name).digest('hex') + createHash('md5').update(id).digest('hex'))
    .digest('hex')
    .slice(0, 15);
  return Buffer.from(sum2 + sum1, 'utf8');
}

/** @param {string} event @param {{global:number,local:number}} counters */
export function buildBlock(event, counters) {
  const random = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  const global = String(counters.global).padStart(10, '0');
  const local = String(counters.local).padStart(4, '0');
  const msg = Buffer.from(`${random}${global}:${local}:${event}`, 'utf8');
  const md5 = createHash('md5').update(msg).digest('hex');
  return Buffer.concat([Buffer.from(md5, 'utf8'), msg]);
}

/** @param {Buffer} compressed */
function wazuhPadding(compressed) {
  const extra = compressed.length % 8;
  const pad = extra > 0 ? 8 - extra : 8;
  return Buffer.concat([Buffer.alloc(pad, 0x21), compressed]);
}

/** @param {Buffer} block @param {Buffer} key */
export function encryptBlock(block, key) {
  const compressed = deflateSync(block);
  const padded = wazuhPadding(compressed);
  const cipher = createCipheriv('aes-256-cbc', key.subarray(0, 32), AES_IV);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return Buffer.concat([Buffer.from('#AES:'), encrypted]);
}

/** Strip optional !<agentId>! prefix before #AES: or : */
function stripAgentPrefix(data) {
  if (data[0] !== 0x21) return data; // '!'
  const end = data.indexOf(0x21, 1);
  if (end < 0) return data;
  return data.subarray(end + 1);
}

/** Wazuh client.keys IDs are 3-digit zero-padded. */
export function padAgentId(agentId) {
  return String(agentId ?? '').padStart(3, '0');
}

/** @param {string} agentId @param {Buffer} aesPayload payload starting with #AES: */
export function wrapAgentPayload(agentId, aesPayload) {
  return Buffer.concat([Buffer.from(`!${padAgentId(agentId)}!`), aesPayload]);
}

/** @param {string} plaintext @param {{global:number,local:number}} counters @param {Buffer} key @param {string} [agentId] */
export function encryptMessage(plaintext, counters, key, agentId) {
  const aesPayload = encryptBlock(buildBlock(plaintext, counters), key);
  return agentId ? wrapAgentPayload(agentId, aesPayload) : aesPayload;
}

/** @param {Buffer} payload @param {Buffer} key */
export function decryptMessage(payload, key) {
  let data = stripAgentPrefix(payload);
  if (data.subarray(0, 5).toString() === '#AES:') data = data.subarray(5);
  const decipher = createDecipheriv('aes-256-cbc', key.subarray(0, 32), AES_IV);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  let start = 0;
  while (start < decrypted.length && decrypted[start] === 0x21) start++;
  const inflated = inflateSync(decrypted.subarray(start));
  const text = inflated.toString('utf8');
  const body = text.slice(32);
  const c1 = body.indexOf(':');
  const c2 = body.indexOf(':', c1 + 1);
  return c2 >= 0 ? body.slice(c2 + 1) : body;
}
