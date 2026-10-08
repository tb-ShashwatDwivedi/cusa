import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';

const execFileAsync = promisify(execFile);

/** @returns {boolean} */
export function dpapiAvailable() {
  return process.platform === 'win32';
}

/** @param {string} plain */
async function protectSecret(plain) {
  const b64 = Buffer.from(plain, 'utf8').toString('base64');
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$p=[Convert]::FromBase64String('${b64}')`,
    '$e=[Security.Cryptography.ProtectedData]::Protect($p,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)',
    '[Convert]::ToBase64String($e)',
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
    timeout: 15000,
  });
  return stdout.trim();
}

/** @param {string} protectedB64 */
async function unprotectSecret(protectedB64) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$e=[Convert]::FromBase64String('${protectedB64}')`,
    '$p=[Security.Cryptography.ProtectedData]::Unprotect($e,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)',
    '[Text.Encoding]::UTF8.GetString($p)',
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
    timeout: 15000,
  });
  return stdout.trim();
}

/** @param {string} cacheDir */
export async function getMachineSecret(cacheDir) {
  if (process.env.CUSA_SECRET) return process.env.CUSA_SECRET;
  const keyFile = join(cacheDir, 'machine.key.dpapi');
  if (dpapiAvailable()) {
    try {
      const blob = (await readFile(keyFile, 'utf8')).trim();
      return await unprotectSecret(blob);
    } catch {
      const seed = randomBytes(32).toString('hex');
      await mkdir(cacheDir, { recursive: true });
      await writeFile(keyFile, await protectSecret(seed), { encoding: 'utf8', mode: 0o600 });
      return seed;
    }
  }
  return 'cusa-local-key';
}
