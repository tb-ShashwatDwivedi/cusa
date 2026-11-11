import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortInventoryForWire } from '../src/inventory/wire-order.js';
import { toDbsyncWireBody, normalizeArch } from '../src/inventory/dbsync-wire.js';

describe('inventory wire order', () => {
  it('sorts protocols before networks', () => {
    const sorted = sortInventoryForWire([
      { category: 'networks', id: 'n1' },
      { category: 'protocols', id: 'p1' },
      { category: 'system', id: 's1' },
      { category: 'interfaces', id: 'i1' },
    ]);
    assert.deepEqual(sorted.map((i) => i.category), [
      'system',
      'interfaces',
      'protocols',
      'networks',
    ]);
  });

  it('interfaces mtu is always positive for wazuh-db', () => {
    const body = toDbsyncWireBody({
      category: 'interfaces',
      operation: 'create',
      id: 'iface-wifi',
      data: { name: 'Wi-Fi', mtu: null, state: 'up' },
    });
    assert.ok(body.data.mtu > 0);
  });

  it('normalizes Windows architecture labels', () => {
    assert.equal(normalizeArch('64-bit'), 'x86_64');
    assert.equal(normalizeArch(9), 'x86_64');
  });
});
