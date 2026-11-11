import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fimItemToIngestEvent, isLegacySyscheckState } from '../src/fim/wire-event.js';
import { serializeEvent } from '../src/wazuh/v4/event-serializer.js';

describe('fim wire', () => {
  it('does not use queue 8 or path as location', () => {
    const ev = fimItemToIngestEvent({
      operation: 'update',
      data: { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts', size: 1 },
    });
    const line = serializeEvent(ev);
    assert.ok(line.startsWith('1:cusa-fim:'));
    assert.ok(!line.startsWith('8:'));
    assert.ok(line.includes('cusa_fim'));
  });

  it('flags legacy syscheck state queue payloads', () => {
    assert.equal(isLegacySyscheckState({ index: 'wazuh-states-fim' }), true);
    assert.equal(isLegacySyscheckState({ index: 'wazuh-states-inventory-packages', category: 'packages' }), false);
  });
});
