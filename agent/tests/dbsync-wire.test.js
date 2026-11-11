import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDbsyncWireBody,
  serializeInventoryDbsync,
  unixStartTime,
  tcpStateName,
} from '../src/inventory/dbsync-wire.js';

describe('dbsync wire', () => {
  it('maps create to INSERTED and package fields', () => {
    const body = toDbsyncWireBody({
      category: 'packages',
      operation: 'create',
      id: 'pkg-x',
      data: { name: 'Foo', version: '2', vendor: 'Bar' },
    });
    assert.equal(body.type, 'dbsync_packages');
    assert.equal(body.operation, 'INSERTED');
    assert.equal(body.data.name, 'Foo');
    assert.equal(body.data.groups, ' ');
    assert.equal(body.data.section, undefined);
    assert.match(body.data.scan_time, /^\d{4}\/\d{2}\/\d{2} /);
  });

  it('maps WMI CreationDate to unix start_time and string pid', () => {
    const body = toDbsyncWireBody({
      category: 'processes',
      operation: 'create',
      id: 'proc-4',
      data: {
        name: 'System',
        pid: 4,
        ppid: 0,
        start_time: '/Date(1791525084274)/',
        memory_bytes: 1000,
        priority: 8,
      },
    });
    assert.equal(typeof body.data.start_time, 'number');
    assert.equal(body.data.start_time, unixStartTime('/Date(1791525084274)/'));
    assert.equal(body.data.pid, '4');
    assert.equal(body.data.vm_size, 1000);
  });

  it('maps TCP state enum to listen', () => {
    assert.equal(tcpStateName(2), 'listen');
    assert.equal(tcpStateName(5), 'established');
    const body = toDbsyncWireBody({
      category: 'ports',
      operation: 'create',
      id: 'p1',
      data: { local_port: 443, state: 2, protocol: 'tcp' },
    });
    assert.equal(body.data.state, 'listen');
  });

  it('maps network address family to numeric proto for wdb/router', () => {
    const body = toDbsyncWireBody({
      category: 'networks',
      operation: 'create',
      id: 'n1',
      data: { interface: 'Ethernet', address: '10.0.0.1', family: 2 },
    });
    assert.equal(body.data.proto, 0);
    const v6 = toDbsyncWireBody({
      category: 'networks',
      operation: 'create',
      id: 'n2',
      data: { interface: 'Ethernet', address: 'fe80::1', family: 23 },
    });
    assert.equal(v6.data.proto, 1);
  });

  it('serializeInventoryDbsync prefixes d:syscollector', () => {
    const line = serializeInventoryDbsync({
      category: 'hotfixes',
      operation: 'delete',
      data: { hotfix_id: 'KB9' },
    });
    assert.ok(line.startsWith('d:syscollector:'));
    const body = JSON.parse(line.slice('d:syscollector:'.length));
    assert.equal(body.operation, 'DELETED');
    assert.equal(body.data.hotfix, 'KB9');
  });
});
