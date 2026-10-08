import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const TOKEN_FILE = 'api.token';

/** @param {string} cacheDir */
export async function ensureApiToken(cacheDir) {
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, TOKEN_FILE);
  try {
    const token = (await readFile(path, 'utf8')).trim();
    if (token.length >= 16) return token;
  } catch {
    // generate
  }
  const token = randomBytes(32).toString('hex');
  await writeFile(path, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

/** @param {import('fastify').FastifyRequest} req @param {string} token */
export function hasValidToken(req, token) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const alt = req.headers['x-cusa-token'];
  return bearer === token || alt === token;
}
