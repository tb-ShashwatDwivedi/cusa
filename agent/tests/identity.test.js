import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EndpointIdentity } from '../src/identity/endpoint-identity.js';

describe('endpoint identity', () => {
  it('caches hostname and network fields', () => {
    const id = new EndpointIdentity();
    const a = id.snapshot('001');
    const b = id.snapshot('001');
    assert.equal(a.hostname, b.hostname);
    assert.ok(Array.isArray(a.ips));
    assert.equal(a.agent_id, '001');
  });
});
