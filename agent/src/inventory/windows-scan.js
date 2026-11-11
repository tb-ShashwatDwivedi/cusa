import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { parsePsJson } from './parse-ps-json.js';
import { indexForCategory } from './wazuh-collectors.js';
import { tcpStateName } from './dbsync-wire.js';

const execFileAsync = promisify(execFile);

function packageItemId(name, version, location) {
  const h = createHash('sha256')
    .update([name, version || '', location || ''].join('\0'))
    .digest('hex')
    .slice(0, 40);
  return `pkg-${h}`;
}

function item(id, category, data) {
  return {
    id,
    index: indexForCategory(category),
    category,
    operation: 'update',
    timestamp: new Date().toISOString(),
    data,
  };
}

async function ps(command, timeout = 120000, maxBuffer = 8 * 1024 * 1024) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { timeout, maxBuffer },
  );
  return stdout;
}

/** @returns {Promise<{ items: object[], error?: string }>} */
export async function scanWindowsSystem() {
  try {
    const stdout = await ps(
      'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime,TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json -Compress',
      60000,
    );
    const rows = parsePsJson(stdout);
    const winOs = rows[0] || {};
    const bootMs = winOs.LastBootUpTime ? Date.parse(winOs.LastBootUpTime) : NaN;
    const uptimeSec = Number.isFinite(bootMs) ? Math.max(0, Math.floor((Date.now() - bootMs) / 1000)) : undefined;
    return {
      items: [
        item('system-1', 'system', {
          hostname: os.hostname(),
          os_name: winOs.Caption,
          os_version: winOs.Version,
          os_build: winOs.BuildNumber,
          platform: 'windows',
          os_type: 'windows',
          arch: winOs.OSArchitecture || process.arch,
          os_major: winOs.Version?.split('.')?.[0],
          os_minor: winOs.Version?.split('.')?.[1],
          os_release: winOs.Version,
          boot_time: winOs.LastBootUpTime,
          uptime_seconds: uptimeSec,
          memory_total_kb: winOs.TotalVisibleMemorySize,
          memory_free_kb: winOs.FreePhysicalMemory,
        }),
      ],
    };
  } catch (err) {
    return {
      items: [
        item('system-1', 'system', {
          hostname: os.hostname(),
          os: process.platform,
          os_version: os.release(),
          arch: os.arch(),
        }),
      ],
      error: err.message,
    };
  }
}

/** @returns {Promise<{ items: object[], error?: string }>} */
export async function scanWindowsHardware() {
  try {
    const stdout = await ps(
      `$cs = Get-CimInstance Win32_ComputerSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; @{ MemoryMB = [math]::Round($cs.TotalPhysicalMemory/1MB,2); CpuCores = $cpu.NumberOfLogicalProcessors; CpuPhysical = $cpu.NumberOfCores; CpuName = $cpu.Name; CpuMhz = $cpu.MaxClockSpeed; BoardSerial = $cs.SerialNumber; BoardManufacturer = $cs.Manufacturer; BoardModel = $cs.Model; Architecture = $cpu.Architecture } | ConvertTo-Json -Compress`,
      60000,
    );
    const row = parsePsJson(stdout)[0] || {};
    return {
      items: [
        item('hardware-1', 'hardware', {
          hostname: os.hostname(),
          cpu: {
            name: row.CpuName,
            cores: row.CpuCores ?? os.cpus().length,
            physical_cores: row.CpuPhysical,
            mhz: row.CpuMhz,
          },
          memory: { total_mb: row.MemoryMB ?? Math.round(os.totalmem() / (1024 * 1024)) },
          board: {
            serial: row.BoardSerial,
            manufacturer: row.BoardManufacturer,
            model: row.BoardModel,
          },
          architecture: String(row.Architecture || os.arch()),
        }),
      ],
    };
  } catch (err) {
    return {
      items: [
        item('hardware-1', 'hardware', {
          hostname: os.hostname(),
          cpu: { cores: os.cpus().length },
          memory: { total_mb: Math.round(os.totalmem() / (1024 * 1024)) },
          architecture: os.arch(),
        }),
      ],
      error: err.message,
    };
  }
}

/** @param {number} limit */
export async function scanWindowsInterfaces(limit = 200) {
  try {
    const stdout = await ps(
      `Get-NetAdapter | ForEach-Object { $nl = (Get-NetIPInterface -InterfaceAlias $_.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).NlMtu; $mtu = if ($null -ne $_.Mtu -and $_.Mtu -gt 0) { $_.Mtu } elseif ($null -ne $nl -and $nl -gt 0) { $nl } else { 1500 }; [PSCustomObject]@{ Name=$_.Name; MacAddress=$_.MacAddress; Mtu=$mtu; Status=$_.Status; MediaType=$_.MediaType; InterfaceDescription=$_.InterfaceDescription } } | ConvertTo-Json -Compress`,
      90000,
    );
    const rows = parsePsJson(stdout).slice(0, limit);
    const items = rows.map((r) =>
      item(`iface-${r.Name}`, 'interfaces', {
        name: r.Name,
        mac: r.MacAddress,
        mtu: r.Mtu,
        state: String(r.Status || '').toLowerCase(),
        type: r.MediaType || r.InterfaceDescription,
      }),
    );
    return { items };
  } catch (err) {
    return { items: [], error: err.message };
  }
}

/** @param {number} limit */
export async function scanWindowsNetworks(limit = 500) {
  try {
    const stdout = await ps(
      'Get-NetIPAddress -AddressFamily IPv4,IPv6 -ErrorAction SilentlyContinue | Select-Object InterfaceAlias,IPAddress,PrefixLength,AddressFamily | ConvertTo-Json -Compress',
      60000,
    );
    const rows = parsePsJson(stdout).slice(0, limit);
    const items = rows.map((r, i) => {
      const prefix = r.PrefixLength;
      return item(`net-${r.InterfaceAlias}-${r.IPAddress}-${i}`, 'networks', {
        name: r.InterfaceAlias,
        interface: r.InterfaceAlias,
        address: r.IPAddress,
        ip: r.IPAddress,
        protocol: r.AddressFamily,
        family: r.AddressFamily,
        netmask: prefix != null ? prefixToMask(r.AddressFamily, prefix) : undefined,
      });
    });
    return { items };
  } catch (err) {
    return { items: [], error: err.message };
  }
}

function prefixToMask(family, prefix) {
  if (family === 'IPv6') return undefined;
  const bits = Number(prefix);
  if (!bits || bits > 32) return undefined;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return [24, 16, 8, 0].map((s) => (mask >>> s) & 255).join('.');
}

/** @param {number} limit */
export async function scanWindowsPorts(limit = 500) {
  try {
    const stdout = await ps(
      `$c = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess,State -First ${limit}; $p = Get-Process -Id ($c.OwningProcess | Select-Object -Unique) -ErrorAction SilentlyContinue; $c | ForEach-Object { $n = ($p | Where-Object { $_.Id -eq $_.OwningProcess } | Select-Object -First 1).ProcessName; [PSCustomObject]@{ LocalAddress=$_.LocalAddress; LocalPort=$_.LocalPort; OwningProcess=$_.OwningProcess; State=$_.State; ProcessName=$n } } | ConvertTo-Json -Compress`,
      120000,
    );
    const rows = parsePsJson(stdout);
    const items = rows.map((p) =>
      item(
        `port-tcp-${p.LocalAddress}-${p.LocalPort}-${p.OwningProcess}`,
        'ports',
        {
          local_address: p.LocalAddress,
          local_port: p.LocalPort,
          pid: p.OwningProcess,
          process_name: p.ProcessName,
          state: tcpStateName(p.State),
          protocol: 'tcp',
        },
      ),
    );
    return { items };
  } catch (err) {
    return { items: [], error: err.message };
  }
}

/** Per-interface IPv4/IPv6 protocol rows (feeds sys_netproto before netaddr). */
export async function scanWindowsNetProtocols(limit = 100) {
  try {
    const stdout = await ps(
      'Get-NetIPInterface -AddressFamily IPv4,IPv6 -ErrorAction SilentlyContinue | Select-Object InterfaceAlias,AddressFamily,Dhcp | ConvertTo-Json -Compress',
      60000,
    );
    const rows = parsePsJson(stdout).slice(0, limit);
    const gateways = new Map();
    try {
      const gwOut = await ps(
        'Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | Select-Object NextHop,InterfaceAlias | ConvertTo-Json -Compress',
        30000,
      );
      for (const r of parsePsJson(gwOut)) {
        if (r.InterfaceAlias && r.NextHop) gateways.set(r.InterfaceAlias, r.NextHop);
      }
    } catch {
      // optional
    }
    const items = [];
    const seen = new Set();
    for (const r of rows) {
      const family = r.AddressFamily === 23 || r.AddressFamily === 'IPv6' ? 'ipv6' : 'ipv4';
      const key = `${r.InterfaceAlias}-${family}`;
      if (!r.InterfaceAlias || seen.has(key)) continue;
      seen.add(key);
      const dhcp = String(r.Dhcp || '').toLowerCase() === 'enabled' ? 'enabled' : 'disabled';
      items.push(
        item(`proto-${key}`, 'protocols', {
          iface: r.InterfaceAlias,
          interface: r.InterfaceAlias,
          type: family,
          gateway: gateways.get(r.InterfaceAlias) || '',
          dhcp,
        }),
      );
    }
    return { items };
  } catch (err) {
    return { items: [], error: err.message };
  }
}

/** @param {number} limit */
export async function scanWindowsPackages(limit = 2000) {
  try {
    const stdout = await ps(
      `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation -First ${limit} | ConvertTo-Json -Compress`,
      180000,
    );
    const pkgs = parsePsJson(stdout);
    const seen = new Set();
    const items = [];
    for (const pkg of pkgs) {
      const key = `${pkg.DisplayName}:${pkg.DisplayVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const loc = pkg.InstallLocation || ' ';
      items.push(
        item(packageItemId(pkg.DisplayName, pkg.DisplayVersion, loc), 'packages', {
          name: pkg.DisplayName,
          version: pkg.DisplayVersion,
          vendor: pkg.Publisher,
          publisher: pkg.Publisher,
          install_location: loc,
        }),
      );
    }
    return { items };
  } catch (err) {
    return { items: [], error: err.message };
  }
}

/** @param {number} limit */
export async function scanWindowsHotfixes(limit = 500) {
  try {
    const stdout = await ps(
      'Get-CimInstance Win32_QuickFixEngineering | Select-Object HotFixID,Description,InstalledOn | ConvertTo-Json -Compress',
      120000,
    );
    const fixes = parsePsJson(stdout).slice(0, limit);
    const items = fixes.map((f) =>
      item(`hf-${f.HotFixID}`, 'hotfixes', {
        hotfix_id: f.HotFixID,
        kb: f.HotFixID,
        description: f.Description,
        installed_on: f.InstalledOn,
      }),
    );
    return { items };
  } catch (err) {
    return { items: [], error: err.message };
  }
}
