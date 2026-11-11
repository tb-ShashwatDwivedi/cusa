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

/** MD5 hex of buffer/string (Wazuh OS_MD5_File style). */
export function md5Hex(data) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return createHash('md5').update(buf).digest('hex');
}

/** Stock agent uses "x merged.mg" when shared merged.mg is absent. */
export const NO_MERGED_MG_LINE = 'x merged.mg';

/** Build getuname()-style line body (without #!- prefix). */
export function buildUname(osLabel, agentVersion = 'v4.11.2') {
  const ver = agentVersion.startsWith('v') ? agentVersion : `v${agentVersion}`;
  const label = osLabel.trim();
  if (/\s-\sWazuh\s+v/i.test(label)) return label;
  return `${label} - Wazuh ${ver}`;
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
/**
 * Stock Wazuh 4.x keepalive (notify.c run_notify).
 * Must contain at least one `\n` or remoted logs "Invalid message from agent".
 */
export function formatKeepalive(opts) {
  const uname = buildUname(opts.osLabel, opts.agentVersion || 'v4.11.2');
  const ip = opts.agentIp || pickAgentIp();
  const lines = [];
  if (opts.configMd5) {
    lines.push(`#!-${uname} / ${opts.configMd5}`);
  } else {
    lines.push(`#!-${uname}`);
  }
  const mergedLine =
    opts.mergedMd5 && opts.mergedMd5 !== 'x'
      ? `${opts.mergedMd5} merged.mg`
      : NO_MERGED_MG_LINE;
  lines.push(mergedLine);
  if (ip) lines.push(`#"_agent_ip":${ip}`);
  // Stock Windows agents use CRLF; remoted only requires at least one \n.
  return `${lines.join('\r\n')}\r\n`;
}
