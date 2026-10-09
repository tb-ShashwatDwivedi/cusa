import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

/**
 * Lightweight anomaly scan (not kernel rootkit detection).
 * @returns {Promise<{ status: string, findings: object[] }>}
 */
export async function runRootkitScan() {
  const findings = [];
  try {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Service | Where-Object { $_.State -eq "Running" -and $_.PathName -match "\\\\Temp\\\\" } | Select-Object Name,PathName -First 5 | ConvertTo-Json -Compress',
        ], { timeout: 60000 });
        if (stdout && stdout.length > 4) {
          findings.push({ type: 'suspicious_service', detail: stdout.slice(0, 500) });
        }
      } catch {
        // ignore
      }
    } else {
      try {
        const mods = await readdir('/proc/modules');
        if (mods.length > 500) findings.push({ type: 'many_kernel_modules', count: mods.length });
      } catch {
        return { status: 'NOT_SUPPORTED', findings: [] };
      }
      try {
        const cron = await readFile('/etc/crontab', 'utf8');
        if (/\/tmp\//.test(cron)) findings.push({ type: 'suspicious_cron', detail: '/etc/crontab references /tmp' });
      } catch {
        // no crontab
      }
    }
  } catch (err) {
    return { status: 'ERROR', findings: [{ error: err.message }] };
  }
  if (!findings.length) return { status: 'PASS', findings: [] };
  const severe = findings.some((f) => f.type === 'suspicious_service');
  return { status: severe ? 'FAIL' : 'WARN', findings };
}
