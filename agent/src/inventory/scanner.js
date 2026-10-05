import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export class InventoryScanner {
  constructor() {
    this.lastScan = null;
  }

  async scanSystem() {
    const items = [];
    const base = {
      hostname: os.hostname(),
      os: process.platform,
      arch: os.arch(),
      cpus: os.cpus().length,
      memory: os.totalmem(),
      uptime: os.uptime(),
    };
    items.push({
      id: 'system-1',
      index: 'wazuh-states-inventory-system',
      operation: 'update',
      timestamp: new Date().toISOString(),
      data: base,
    });

    if (process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Product | Select-Object Name,Version | ConvertTo-Json -Compress',
        ], { timeout: 120000 });
        const pkgs = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
        for (const pkg of pkgs.slice(0, 200)) {
          items.push({
            id: `pkg-${pkg.Name}-${pkg.Version}`,
            index: 'wazuh-states-inventory-packages',
            operation: 'update',
            timestamp: new Date().toISOString(),
            data: pkg,
          });
        }
      } catch {
        // WMI may be slow/unavailable
      }
    } else {
      try {
        const { stdout } = await execFileAsync('dpkg-query', ['-W', '-f=${Package}\t${Version}\n']);
        for (const line of stdout.split('\n').filter(Boolean).slice(0, 500)) {
          const [name, version] = line.split('\t');
          items.push({
            id: `pkg-${name}`,
            index: 'wazuh-states-inventory-packages',
            operation: 'update',
            timestamp: new Date().toISOString(),
            data: { name, version },
          });
        }
      } catch {
        // not debian
      }
    }

    try {
      if (process.platform === 'win32') {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile', '-Command',
          'Get-Process | Select-Object Id,ProcessName,CPU | ConvertTo-Json -Compress',
        ], { timeout: 30000 });
        const procs = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
        for (const p of procs.slice(0, 100)) {
          items.push({
            id: `proc-${p.Id}`,
            index: 'wazuh-states-inventory-processes',
            operation: 'update',
            timestamp: new Date().toISOString(),
            data: p,
          });
        }
      } else {
        const { stdout } = await execFileAsync('ps', ['-eo', 'pid,comm', '--no-headers']);
        for (const line of stdout.split('\n').filter(Boolean).slice(0, 100)) {
          const [pid, ...rest] = line.trim().split(/\s+/);
          items.push({
            id: `proc-${pid}`,
            index: 'wazuh-states-inventory-processes',
            operation: 'update',
            timestamp: new Date().toISOString(),
            data: { pid, name: rest.join(' ') },
          });
        }
      }
    } catch {
      // process list unavailable
    }

    try {
      if (process.platform === 'win32') {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile', '-Command',
          'Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress',
        ], { timeout: 30000 });
        const ports = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
        for (const p of ports.slice(0, 100)) {
          items.push({
            id: `port-${p.LocalAddress}-${p.LocalPort}`,
            index: 'wazuh-states-inventory-ports',
            operation: 'update',
            timestamp: new Date().toISOString(),
            data: p,
          });
        }
      }
    } catch {
      // ports unavailable
    }

    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const addr of addrs || []) {
        items.push({
          id: `iface-${name}-${addr.address}`,
          index: 'wazuh-states-inventory-interfaces',
          operation: 'update',
          timestamp: new Date().toISOString(),
          data: { name, ...addr },
        });
      }
    }

    this.lastScan = new Date().toISOString();
    return items;
  }
}
