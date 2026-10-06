import tls from 'node:tls';
import { saveSecrets, loadSecrets } from '../../security/secrets.js';

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {string} opts.agentName
 * @param {string} [opts.password]
 * @param {string} [opts.groups]
 * @param {string} [opts.ca]
 * @param {string} [opts.agentVersion] Wazuh-style V: field (e.g. Wazuh v4.11.2)
 */
export function enroll(opts) {
  return new Promise((resolve, reject) => {
    const tlsOpts = {
      host: opts.host,
      port: opts.port,
      rejectUnauthorized: opts.ca ? true : false,
      ca: opts.ca,
    };
    const socket = tls.connect(tlsOpts, () => {
      let msg = `OSSEC A:'${opts.agentName}'`;
      if (opts.groups) msg += ` G:'${opts.groups}'`;
      msg += ` V:'${opts.agentVersion || 'Wazuh v4.11.2'}'`;
      if (opts.password) msg = `OSSEC PASS: ${opts.password} ${msg}`;
      const buf = Buffer.from(msg, 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32LE(buf.length, 0);
      socket.write(Buffer.concat([header, buf]));
    });

    const chunks = [];
    socket.on('data', (d) => chunks.push(d));
    socket.on('error', reject);
    socket.on('end', () => {
      const buf = Buffer.concat(chunks);
      let body = buf;
      if (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (len > 0 && len <= buf.length - 4) body = buf.subarray(4, 4 + len);
      }
      const raw = body.toString('utf8');
      const match = raw.match(/OSSEC K:'(\d+)\s+(\S+)\s+(\S+)\s+(\S+)'/);
      if (!match) return reject(new Error(`Enrollment failed: ${raw}`));
      resolve({ id: match[1], name: match[2], ip: match[3], key: match[4] });
    });
  });
}

/** @param {string} dataDir @param {object} identity */
export async function persistIdentity(dataDir, identity) {
  const secrets = await loadSecrets(dataDir);
  secrets.identity = identity;
  await saveSecrets(dataDir, secrets);
  return identity;
}

/** @param {string} dataDir */
export async function loadIdentity(dataDir) {
  const secrets = await loadSecrets(dataDir);
  return secrets.identity || null;
}
