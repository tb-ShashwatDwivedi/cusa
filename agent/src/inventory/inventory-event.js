import { COLLECTORS, indexForCategory, inventoryEventType } from './wazuh-collectors.js';

/**
 * Map internal scanner item → Wazuh inventory wire event (module + collector + WCS data).
 * @param {object} item { id, index, operation, data, category?, collector? }
 */
export function toInventoryWireEvent(item) {
  const category = item.category || categoryFromIndex(item.index);
  const collector = item.collector || COLLECTORS[category] || 'dbsync_unknown';
  const created = new Date().toISOString();
  const type = inventoryEventType(item.operation || 'update');
  return {
    collector,
    module: 'inventory',
    index: item.index || indexForCategory(category),
    id: item.id,
    data: {
      event: {
        type,
        created,
        changed_fields: item.changed_fields || [],
      },
      host: item.data?.host ? item.data.host : wrapHostData(item.data, category),
    },
  };
}

/** @param {string} index */
function categoryFromIndex(index) {
  const m = String(index || '').match(/inventory-([a-z]+)/);
  return m?.[1] || 'system';
}

/** @param {object} data @param {string} category */
function wrapHostData(data, category) {
  if (!data || typeof data !== 'object') return {};
  const host = {};
  switch (category) {
    case 'interfaces':
      host.interface = {
        name: data.name,
        mac_address: data.mac || data.mac_address,
        mtu: data.mtu,
        state: data.state,
        type: data.type,
      };
      break;
    case 'networks':
      host.ip = data.address || data.ip;
      host.netmask = data.netmask;
      host.broadcast = data.broadcast;
      host.network = {
        interface: data.interface || data.name,
        protocol: data.protocol || data.family,
      };
      break;
    case 'packages':
      host.package = {
        name: data.name,
        version: data.version,
        vendor: data.vendor || data.publisher,
        architecture: data.architecture || data.arch,
      };
      break;
    case 'ports':
      host.port = {
        local_ip: data.local_address || data.local_ip,
        local_port: data.local_port,
        protocol: data.protocol,
        state: data.state,
      };
      host.process = data.process_name
        ? { name: data.process_name, pid: data.pid }
        : data.pid != null
          ? { pid: data.pid }
          : undefined;
      break;
    case 'hotfixes':
      host.os = {
        patch: {
          id: data.hotfix_id || data.kb || data.HotFixID,
          name: data.description,
          installed: data.installed_on,
        },
      };
      break;
    case 'hardware':
      host.cpu = data.cpu;
      host.memory = data.memory;
      host.architecture = data.architecture;
      break;
    case 'system':
      host.hostname = data.hostname;
      host.os = {
        name: data.os_name || data.os,
        version: data.os_version,
        platform: data.platform,
        type: data.os_type,
        build: data.os_build,
      };
      break;
    case 'processes':
      host.process = {
        name: data.name,
        pid: data.pid,
        args: data.command_line,
        executable: data.path,
        parent: data.ppid != null ? { pid: data.ppid } : undefined,
      };
      break;
    case 'services':
      host.service = {
        name: data.name,
        state: data.state,
        description: data.description,
        executable: data.executable_path,
      };
      break;
    case 'users':
      host.user = { name: data.name, enabled: data.enabled };
      break;
    case 'groups':
      host.group = { name: data.name, members: data.members };
      break;
    default:
      return { ...data };
  }
  return host;
}
