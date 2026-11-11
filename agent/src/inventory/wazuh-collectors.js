/** Wazuh syscollector collector names and state index patterns (4.11). */

/** Types must match analysisd `get_field_list()` suffix after `dbsync_` (Wazuh 4.11 syscollector.c). */
export const COLLECTORS = {
  system: 'dbsync_osinfo',
  hardware: 'dbsync_hwinfo',
  interfaces: 'dbsync_network_iface',
  networks: 'dbsync_network_address',
  packages: 'dbsync_packages',
  ports: 'dbsync_ports',
  processes: 'dbsync_processes',
  protocols: 'dbsync_network_protocol',
  hotfixes: 'dbsync_hotfixes',
};

/** Categories with no wazuh-db dbsync handler — skip on wire (still scanned locally). */
export const UNSUPPORTED_WIRE_CATEGORIES = new Set(['services', 'users', 'groups']);

/** @param {string} category @returns {string} */
export function indexForCategory(category) {
  const map = {
    system: 'wazuh-states-inventory-system',
    hardware: 'wazuh-states-inventory-hardware',
    interfaces: 'wazuh-states-inventory-interfaces',
    networks: 'wazuh-states-inventory-networks',
    packages: 'wazuh-states-inventory-packages',
    ports: 'wazuh-states-inventory-ports',
    processes: 'wazuh-states-inventory-processes',
    protocols: 'wazuh-states-inventory-protocols',
    hotfixes: 'wazuh-states-inventory-hotfixes',
    services: 'wazuh-states-inventory-services',
    users: 'wazuh-states-inventory-users',
    groups: 'wazuh-states-inventory-groups',
  };
  return map[category] || `wazuh-states-inventory-${category}`;
}

/** @param {'create'|'update'|'delete'} op */
export function inventoryEventType(op) {
  if (op === 'create') return 'created';
  if (op === 'delete') return 'deleted';
  return 'updated';
}
