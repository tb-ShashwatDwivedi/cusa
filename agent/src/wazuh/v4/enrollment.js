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
 * @param {boolean} [opts.insecure] when true, skip TLS verification (lab only; default secure)
 * @param {string} [opts.agentVersion] Wazuh-style V: field (e.g. Wazuh v4.11.2)
 */
const ENROLL_SOCKET_MS = 12_000;

export function enroll(opts) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    // Secure by default: verify the manager unless the operator explicitly opts out
    // (insecure:true) or supplies a CA. Fail-closed matches docs/security-model.md. CYB-5300.
    const verify = opts.insecure === true ? false : true;
    const tlsOpts = {
      host: opts.host,
      port: opts.port,
      rejectUnauthorized: verify,
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

    const timer = setTimeout(() => {
      socket.destroy();
      finish(reject, new Error('Enrollment timed out'));
    }, ENROLL_SOCKET_MS);
    timer.unref?.();

    const chunks = [];
    socket.on('data', (d) => chunks.push(d));
    socket.on('error', (err) => finish(reject, err));
    socket.on('end', () => {
      const buf = Buffer.concat(chunks);
      let body = buf;
      if (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (len > 0 && len <= buf.length - 4) body = buf.subarray(4, 4 + len);
      }
      const raw = body.toString('utf8');
      const match = raw.match(/OSSEC K:'(\d+)\s+(\S+)\s+(\S+)\s+(\S+)'/);
      if (!match) return finish(reject, new Error(`Enrollment failed: ${raw}`));
      finish(resolve, { id: match[1], name: match[2], ip: match[3], key: match[4] });
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

/** Drop stored agent identity (e.g. after manager address change). */
export async function clearIdentity(dataDir) {
  const secrets = await loadSecrets(dataDir);
  delete secrets.identity;
  await saveSecrets(dataDir, secrets);
}
