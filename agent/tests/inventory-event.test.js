import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toInventoryWireEvent } from '../src/inventory/inventory-event.js';
import { serializeStateItem } from '../src/wazuh/v4/event-serializer.js';

describe('inventory wire events', () => {
  it('maps package item to module inventory', () => {
    const wire = toInventoryWireEvent({
      id: 'pkg-a',
      index: 'wazuh-states-inventory-packages',
      category: 'packages',
      operation: 'create',
      data: { name: 'App', version: '1', vendor: 'Co' },
    });
    assert.equal(wire.module, 'inventory');
    assert.equal(wire.collector, 'dbsync_packages');
    assert.equal(wire.data.event.type, 'created');
    assert.equal(wire.data.host.package.name, 'App');
  });

  it('serializeStateItem uses native dbsync syscollector body', () => {
    const line = serializeStateItem({
      index: 'wazuh-states-inventory-hotfixes',
      category: 'hotfixes',
      id: 'hf-KB1',
      operation: 'update',
      data: { hotfix_id: 'KB1' },
    });
    assert.ok(line.startsWith('d:syscollector:'));
    const body = JSON.parse(line.slice('d:syscollector:'.length));
    assert.equal(body.type, 'dbsync_hotfixes');
    assert.equal(body.operation, 'MODIFIED');
    assert.equal(body.data.hotfix, 'KB1');
    assert.ok(body.data.scan_time);
    assert.ok(body.data.checksum);
  });
});
