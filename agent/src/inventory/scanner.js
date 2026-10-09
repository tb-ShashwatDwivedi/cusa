import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

function item(id, index, data) {
  return {
    id,
    index,
    operation: 'update',
    timestamp: new Date().toISOString(),
    data,
  };
}

export class InventoryScanner {
  async scanSystem() {
    const items = [];
    items.push(
      item('system-1', 'wazuh-states-inventory-system', {
        hostname: os.hostname(),
        os: process.platform,
        os_version: os.release(),
        arch: os.arch(),
        cpus: os.cpus().length,
        memory: os.totalmem(),
        uptime: os.uptime(),
        machine_id: os.hostname(),
      }),
    );

    if (process.platform === 'win32') {
      items.push(...await this.scanWindowsPackages());
      items.push(...await this.scanWindowsHotfixes());
      items.push(...await this.scanWindowsServices());
      items.push(...await this.scanWindowsUsers());
      items.push(...await this.scanWindowsProcesses());
      items.push(...await this.scanWindowsPorts());
      items.push(...await this.scanWindowsNetwork());
    } else {
      items.push(...await this.scanLinuxPackages());
      items.push(...await this.scanLinuxServices());
      items.push(...await this.scanLinuxUsers());
      items.push(...await this.scanLinuxProcesses());
      items.push(...await this.scanLinuxPorts());
      items.push(...await this.scanLinuxNetwork());
    }

    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const addr of addrs || []) {
        items.push(item(`iface-${name}-${addr.address}`, 'wazuh-states-inventory-interfaces', { name, ...addr }));
      }
    }
    return items;
  }

  async scanWindowsPackages() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue |
          Where-Object { $_.DisplayName } |
          Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation -First 300 |
          ConvertTo-Json -Compress`,
      ], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      const pkgs = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
      const seen = new Set();
      for (const pkg of pkgs) {
        const key = `${pkg.DisplayName}:${pkg.DisplayVersion}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item(`pkg-${key}`, 'wazuh-states-inventory-packages', {
          name: pkg.DisplayName,
          version: pkg.DisplayVersion,
          publisher: pkg.Publisher,
          install_location: pkg.InstallLocation,
        }));
      }
    } catch {
      // registry unavailable
    }
    return items;
  }

  async scanWindowsHotfixes() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_QuickFixEngineering | Select-Object HotFixID,Description,InstalledOn | ConvertTo-Json -Compress',
      ], { timeout: 120000 });
      const fixes = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
      for (const f of fixes.slice(0, 500)) {
        items.push(item(`hf-${f.HotFixID}`, 'wazuh-states-inventory-hotfixes', {
          hotfix_id: f.HotFixID,
          description: f.Description,
          installed_on: f.InstalledOn,
        }));
      }
    } catch {
      // WMI unavailable
    }
    return items;
  }

  async scanWindowsServices() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,PathName,StartName,Description | ConvertTo-Json -Compress',
      ], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      const svcs = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
      for (const s of svcs.slice(0, 400)) {
        items.push(item(`svc-${s.Name}`, 'wazuh-states-inventory-services', {
          name: s.Name,
          display_name: s.DisplayName,
          state: s.State,
          startup_type: s.StartMode,
          executable_path: s.PathName,
          service_account: s.StartName,
          description: s.Description,
        }));
      }
    } catch {
      // skip
    }
    return items;
  }

  async scanWindowsUsers() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-LocalUser | Select-Object Name,Enabled | ConvertTo-Json -Compress',
      ], { timeout: 60000 });
      const users = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
      for (const u of users) {
        items.push(item(`user-${u.Name}`, 'wazuh-states-inventory-users', {
          name: u.Name,
          enabled: u.Enabled,
        }));
      }
      const { stdout: groups } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-LocalGroup | Select-Object Name | ConvertTo-Json -Compress',
      ], { timeout: 60000 });
      const grps = JSON.parse(groups.startsWith('[') ? groups : `[${groups}]`);
      for (const g of grps) {
        items.push(item(`grp-${g.Name}`, 'wazuh-states-inventory-groups', { name: g.Name }));
      }
    } catch {
      // skip
    }
    return items;
  }

  async scanWindowsProcesses() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
      ], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      const procs = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
      for (const p of procs.slice(0, 200)) {
        items.push(item(`proc-${p.ProcessId}`, 'wazuh-states-inventory-processes', {
          pid: p.ProcessId,
          ppid: p.ParentProcessId,
          name: p.Name,
          path: p.ExecutablePath,
          command_line: p.CommandLine,
        }));
      }
    } catch {
      // skip
    }
    return items;
  }

  async scanWindowsPorts() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-NetTCPConnection -State Listen,Established -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess,State | ConvertTo-Json -Compress',
      ], { timeout: 60000 });
      const ports = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
      for (const p of ports.slice(0, 300)) {
        items.push(item(`port-tcp-${p.LocalAddress}-${p.LocalPort}-${p.OwningProcess}`, 'wazuh-states-inventory-ports', {
          protocol: 'tcp',
          local_address: p.LocalAddress,
          local_port: p.LocalPort,
          pid: p.OwningProcess,
          state: p.State,
        }));
      }
    } catch {
      // skip
    }
    return items;
  }

  async scanWindowsNetwork() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Select-Object NextHop,InterfaceAlias -First 5 | ConvertTo-Json -Compress',
      ], { timeout: 30000 });
      const routes = JSON.parse(stdout.startsWith('[') ? stdout : `[${stdout}]`);
      for (const r of routes) {
        items.push(item(`route-${r.NextHop}`, 'wazuh-states-inventory-routes', {
          gateway: r.NextHop,
          interface: r.InterfaceAlias,
        }));
      }
      const { stdout: dns } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object ServerAddresses,InterfaceAlias | ConvertTo-Json -Compress',
      ], { timeout: 30000 });
      items.push(item('dns-1', 'wazuh-states-inventory-dns', { raw: dns.slice(0, 2000) }));
    } catch {
      // skip
    }
    return items;
  }

  async scanLinuxPackages() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('dpkg-query', ['-W', '-f=${Package}\t${Version}\t${Architecture}\n']);
      for (const line of stdout.split('\n').filter(Boolean).slice(0, 800)) {
        const [name, version, architecture] = line.split('\t');
        items.push(item(`pkg-${name}`, 'wazuh-states-inventory-packages', { name, version, architecture }));
      }
    } catch {
      try {
        const { stdout } = await execFileAsync('rpm', ['-qa', '--qf', '%{NAME}\t%{VERSION}\t%{ARCH}\n']);
        for (const line of stdout.split('\n').filter(Boolean).slice(0, 800)) {
          const [name, version, architecture] = line.split('\t');
          items.push(item(`pkg-${name}`, 'wazuh-states-inventory-packages', { name, version, architecture }));
        }
      } catch {
        // no package manager
      }
    }
    return items;
  }

  async scanLinuxServices() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('systemctl', ['list-units', '--type=service', '--all', '--no-pager', '--no-legend']);
      for (const line of stdout.split('\n').filter(Boolean).slice(0, 400)) {
        const parts = line.trim().split(/\s+/);
        const unit = parts[0];
        const active = parts[2];
        const sub = parts[3];
        items.push(item(`svc-${unit}`, 'wazuh-states-inventory-services', {
          unit,
          active_state: active,
          sub_state: sub,
        }));
      }
    } catch {
      // no systemd
    }
    return items;
  }

  async scanLinuxUsers() {
    const items = [];
    try {
      const passwd = await readFile('/etc/passwd', 'utf8');
      for (const line of passwd.split('\n').filter(Boolean).slice(0, 500)) {
        const [name] = line.split(':');
        items.push(item(`user-${name}`, 'wazuh-states-inventory-users', { name }));
      }
      const group = await readFile('/etc/group', 'utf8');
      for (const line of group.split('\n').filter(Boolean).slice(0, 500)) {
        const [name, , , members] = line.split(':');
        items.push(item(`grp-${name}`, 'wazuh-states-inventory-groups', { name, members: members?.split(',') || [] }));
      }
    } catch {
      // permission
    }
    return items;
  }

  async scanLinuxProcesses() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('ps', ['-eo', 'pid,ppid,user,pcpu,pmem,comm,args', '--no-headers']);
      for (const line of stdout.split('\n').filter(Boolean).slice(0, 200)) {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
        if (!m) continue;
        items.push(item(`proc-${m[1]}`, 'wazuh-states-inventory-processes', {
          pid: Number(m[1]),
          ppid: Number(m[2]),
          user: m[3],
          cpu: m[4],
          memory: m[5],
          name: m[6],
          command_line: m[7],
        }));
      }
    } catch {
      // skip
    }
    return items;
  }

  async scanLinuxPorts() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('ss', ['-tunlpH']);
      for (const line of stdout.split('\n').filter(Boolean).slice(0, 300)) {
        items.push(item(`port-${line.slice(0, 80)}`, 'wazuh-states-inventory-ports', { line }));
      }
    } catch {
      // skip
    }
    return items;
  }

  async scanLinuxNetwork() {
    const items = [];
    try {
      const { stdout } = await execFileAsync('ip', ['route']);
      for (const line of stdout.split('\n').filter(Boolean).slice(0, 50)) {
        if (line.startsWith('default')) {
          items.push(item(`route-${line}`, 'wazuh-states-inventory-routes', { line }));
        }
      }
    } catch {
      // skip
    }
    return items;
  }
}
