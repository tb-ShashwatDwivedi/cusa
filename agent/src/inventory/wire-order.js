/** Wazuh wazuh-db FK order: netproto before netaddr; os/hw before dependents. */
export const INVENTORY_WIRE_ORDER = [
  'system',
  'hardware',
  'interfaces',
  'protocols',
  'networks',
  'packages',
  'hotfixes',
  'ports',
  'processes',
];

const rank = new Map(INVENTORY_WIRE_ORDER.map((c, i) => [c, i]));

/** @param {object[]} items */
export function sortInventoryForWire(items) {
  return [...items].sort(
    (a, b) => (rank.get(a.category) ?? 999) - (rank.get(b.category) ?? 999),
  );
}
