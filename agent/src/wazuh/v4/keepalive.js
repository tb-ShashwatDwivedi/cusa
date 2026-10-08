import os from 'node:os';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Wazuh 4.x remoted keepalive (multi-line).
 * @see docs/README.md §3.3
 */

export function pickAgentIp() {
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

/** @param {string} [version] e.g. Wazuh v4.11.2 */
export function md5EmptyConfig(version = 'Wazuh v4.11.2') {
  return createHash('md5').update(`cusa-empty-config:${version}`).digest('hex');
}

/** Stock Windows uname-style string for remoted OS detection. */
export async function getWindowsOsLabel() {
  if (process.platform !== 'win32') {
    return `${os.type()} ${os.release()}`;
  }
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version | ForEach-Object { \"$($_.Caption.Trim()) [Ver: $($_.Version)]\" })",
      ],
      { timeout: 15000 },
    );
    const line = stdout.trim().replace(/\s+/g, ' ');
    if (line) return line.startsWith('Microsoft') ? line : `Microsoft ${line}`;
  } catch {
    // fall through
  }
  return `Microsoft Windows [Ver: ${os.release()}.0]`;
}

/**
 * @param {object} opts
 * @param {string} opts.osLabel
 * @param {string} [opts.agentVersion] e.g. v4.11.2
 * @param {string} [opts.configMd5]
 * @param {string} [opts.mergedMd5]
 * @param {string} [opts.agentIp]
 */
export function formatKeepalive(opts) {
  const agentVersion = opts.agentVersion || 'v4.11.2';
  const configMd5 = opts.configMd5 || md5EmptyConfig(`Wazuh ${agentVersion}`);
  const mergedMd5 = opts.mergedMd5 || createHash('md5').update('empty-merged.mg').digest('hex');
  const ip = opts.agentIp || pickAgentIp();
  const line1 = `#!-${opts.osLabel} - Wazuh ${agentVersion} / ${configMd5}`;
  const line2 = `${mergedMd5} merged.mg`;
  const line3 = `#"_agent_ip":${ip}`;
  return `${line1}\n${line2}\n${line3}\n`;
}
