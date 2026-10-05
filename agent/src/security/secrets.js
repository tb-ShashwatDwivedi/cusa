import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const SALT = 'cusa-secrets-v1';

/** @param {string} dataDir */
export function secretsPath(dataDir) {
  return join(dataDir, 'secrets.enc');
}

/** @param {string} dataDir @param {object} secrets */
export async function saveSecrets(dataDir, secrets) {
  const key = scryptSync(process.env.CUSA_SECRET || 'cusa-local-key', SALT, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  await mkdir(dataDir, { recursive: true });
  await writeFile(secretsPath(dataDir), Buffer.concat([iv, tag, payload]));
}

/** @param {string} dataDir */
export async function loadSecrets(dataDir) {
  try {
    const buf = await readFile(secretsPath(dataDir));
    const iv = buf.subarray(0, 16);
    const tag = buf.subarray(16, 32);
    const data = buf.subarray(32);
    const key = scryptSync(process.env.CUSA_SECRET || 'cusa-local-key', SALT, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}
