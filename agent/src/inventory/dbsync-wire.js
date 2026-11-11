import { createHash } from 'node:crypto';
import { COLLECTORS } from './wazuh-collectors.js';

/** Wazuh syscollector delta wire body (4.4+). @see wazuh PR 16389 */
const OP = { create: 'INSERTED', update: 'MODIFIED', delete: 'DELETED' };

function scanTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function checksum(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 40);
}

/** Wazuh dashboard / sys_osinfo architecture tokens */
export function normalizeArch(val) {
  const s = String(val ?? '').toLowerCase().trim();
  if (!s) return 'x86_64';
  if (s === '9' || s.includes('64') || s === 'x64' || s === 'amd64') return 'x86_64';
  if (s === '0' || s.includes('32') || s === 'x86' || s === 'i386') return 'x86';
  if (s.includes('arm64') || s === '12') return 'arm64';
  if (s === 'arm' || s === '5') return 'arm';
  return val;
}

function effectiveMtu(raw) {
  const n = Number(raw.mtu);
  return n > 0 ? n : 1500;
}

function boardSerial(raw, id) {
  const board = raw.board || {};
  const serial = board.serial || raw.board_serial;
  if (serial && String(serial).trim() && String(serial).toLowerCase() !== 'to be filled by o.e.m.') {
    return String(serial).trim();
  }
  return `cusa-${raw.hostname || id || 'hw'}`;
}

/** @see Wazuh sys_processes.start_time INTEGER (unix seconds) */
export function unixStartTime(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val > 1e12 ? Math.floor(val / 1000) : Math.floor(val);
  }
  const s = String(val).trim();
  const msMatch = /\/Date\((\d+)\)\//.exec(s);
  if (msMatch) return Math.floor(Number(msMatch[1]) / 1000);
  const cim = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s);
  if (cim) {
    const iso = `${cim[1]}-${cim[2]}-${cim[3]}T${cim[4]}:${cim[5]}:${cim[6]}Z`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

const TCP_STATE = {
  1: 'close',
  2: 'listen',
  3: 'syn_sent',
  4: 'syn_received',
  5: 'established',
  6: 'fin_wait1',
  7: 'fin_wait2',
  8: 'close_wait',
  9: 'closing',
  10: 'last_ack',
  11: 'time_wait',
  12: 'delete_tcb',
};

/** Windows Get-NetTCPConnection State enum → Wazuh TEXT state */
export function tcpStateName(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'string' && !/^\d+$/.test(val)) return val.toLowerCase();
  const name = TCP_STATE[Number(val)];
  return name || String(val);
}

/** Protocol type string for dbsync_network_protocol (wdb_netproto_save2). */
export function ipFamilyProto(val) {
  if (val == null) return 'ipv4';
  const s = String(val).toLowerCase();
  if (s === '2' || s === 'ipv4' || s === '0') return 'ipv4';
  if (s === '23' || s === 'ipv6' || s === '1') return 'ipv6';
  return s;
}

/** Numeric proto for dbsync_network_address (wdb_netaddr_save2 reads valueint). */
export function netAddrProtoInt(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val === 23 || val === 1 ? 1 : 0;
  const s = String(val).toLowerCase();
  if (s === 'ipv6' || s === '23' || s === '1') return 1;
  return 0;
}

/** @param {object} item */
export function toDbsyncWireBody(item) {
  const category = item.category || 'system';
  const type = item.collector || COLLECTORS[category] || `dbsync_${category}`;
  const operation = OP[item.operation] || OP.update;
  const ts = scanTime(item.timestamp ? new Date(item.timestamp) : new Date());
  const raw = item.data || {};
  const data = mapData(category, raw, item.id, ts);
  if (!data.checksum) data.checksum = checksum(data);
  if (!data.scan_time) data.scan_time = ts;
  return { data, operation, type };
}

/** @param {object} item */
export function serializeInventoryDbsync(item) {
  return `d:syscollector:${JSON.stringify(toDbsyncWireBody(item))}`;
}

/** @param {string} category @param {object} raw @param {string} id @param {string} ts */
function mapData(category, raw, id, ts) {
  switch (category) {
    case 'system': {
      const ver = String(raw.os_version || '');
      const parts = ver.split('.');
      const major = parts[0] || raw.os_major || '';
      const minor = parts[1] || raw.os_minor || '0';
      const build = raw.os_build || (parts[2] ? `${parts[0]}.${parts[1]}.${parts[2]}` : ver);
      return {
        hostname: raw.hostname,
        os_name: raw.os_name || raw.os,
        os_version: ver.includes('.') && parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : ver,
        os_build: build,
        os_major: String(major),
        os_minor: String(minor),
        os_release: raw.os_release || '',
        os_platform: raw.platform || raw.os_platform || 'windows',
        architecture: normalizeArch(raw.arch || raw.architecture),
        sysname: raw.sysname || 'windows',
        release: String(raw.os_release || raw.os_version || ''),
        version: String(raw.os_build || raw.os_version || ''),
        os_codename: raw.os_codename || '',
        os_patch: raw.os_patch || '',
        os_display_version: raw.os_display_version || raw.os_version || '',
        scan_time: ts,
      };
    }
    case 'hardware': {
      const cores = raw.cpu?.cores ?? raw.cpu_cores;
      const ramMb = raw.memory?.total_mb ?? raw.ram_total;
      const ramFreeKb = raw.memory?.free_kb ?? raw.ram_free;
      const ramTotalKb = ramMb != null ? Math.round(ramMb * 1024) : undefined;
      let ramUsage;
      if (ramTotalKb && ramFreeKb != null) {
        const used = ramTotalKb - Number(ramFreeKb);
        ramUsage = ramTotalKb > 0 ? Math.round((used / ramTotalKb) * 100) : 0;
      }
      return {
        board_serial: boardSerial(raw, id),
        cpu_name: raw.cpu?.name || raw.cpu_name || '',
        cpu_cores: cores,
        cpu_mhz: raw.cpu?.mhz != null ? Number(raw.cpu.mhz) : raw.cpu_mhz != null ? Number(raw.cpu_mhz) : undefined,
        ram_total: ramTotalKb,
        ram_free: ramFreeKb != null ? Number(ramFreeKb) : undefined,
        ram_usage: ramUsage,
        scan_time: ts,
      };
    }
    case 'packages': {
      const location = raw.install_location || raw.location || ' ';
      const archRaw = raw.architecture || raw.arch;
      const architecture = archRaw ? String(normalizeArch(archRaw)) : ' ';
      return {
        scan_time: ts,
        format: raw.format || (raw.platform === 'windows' ? 'win' : 'pkg'),
        name: raw.name,
        priority: raw.priority || ' ',
        groups: raw.groups || raw.section || ' ',
        size: Number(raw.size) || 0,
        vendor: raw.vendor || raw.publisher || '',
        install_time: raw.install_time || ' ',
        version: raw.version || '',
        architecture,
        multiarch: raw.multiarch || ' ',
        source: raw.source || ' ',
        description: raw.description || ' ',
        location,
        item_id: id,
      };
    }
    case 'hotfixes':
      return {
        hotfix: raw.hotfix_id || raw.kb || raw.HotFixID || id,
        scan_time: ts,
      };
    case 'ports':
      return {
        protocol: raw.protocol || 'tcp',
        local_ip: raw.local_address || raw.local_ip,
        local_port: Number(raw.local_port) || 0,
        state: tcpStateName(raw.state),
        pid: Number(raw.pid) || 0,
        process: raw.process_name || '',
        item_id: id,
        scan_time: ts,
      };
    case 'interfaces':
      return {
        name: raw.name,
        adapter: raw.adapter || raw.name,
        mac: raw.mac || raw.mac_address,
        mtu: effectiveMtu(raw),
        state: String(raw.state || 'unknown').toLowerCase(),
        type: raw.type || raw.media_type || '',
        item_id: id,
        scan_time: ts,
      };
    case 'networks':
      return {
        iface: raw.interface || raw.name,
        proto: netAddrProtoInt(raw.protocol || raw.family || raw.proto),
        address: raw.address || raw.ip,
        netmask: raw.netmask || '',
        broadcast: raw.broadcast || '',
        item_id: id,
      };
    case 'protocols':
      return {
        iface: raw.interface || raw.iface || raw.name || '',
        type: ipFamilyProto(raw.type || raw.proto || 'ipv4'),
        gateway: raw.gateway || '',
        dhcp: raw.dhcp || 'unknown',
        metric: Number(raw.metric) || 0,
        item_id: id,
      };
    case 'processes': {
      const mem = Number(raw.memory_bytes ?? raw.size) || 0;
      return {
        name: String(raw.name || ''),
        pid: String(Number(raw.pid) || 0),
        ppid: Number(raw.ppid) || 0,
        state: String(raw.state || ''),
        cmd: String(raw.command_line || raw.cmd || raw.path || ''),
        priority: Number(raw.priority) || 0,
        nice: Number(raw.nice) || 0,
        size: mem,
        vm_size: Number(raw.vm_size) || mem,
        nlwp: Number(raw.nlwp) || 0,
        utime: Number(raw.utime) || 0,
        stime: Number(raw.stime) || 0,
        session: Number(raw.session) || 0,
        start_time: unixStartTime(raw.start_time ?? raw.creation_date),
        scan_time: ts,
      };
    }
    case 'services':
      return {
        name: raw.name,
        state: raw.state,
        description: raw.description,
        scan_time: ts,
      };
    case 'users':
      return {
        name: raw.name,
        scan_time: ts,
      };
    default:
      return { ...raw, scan_time: ts };
  }
}
