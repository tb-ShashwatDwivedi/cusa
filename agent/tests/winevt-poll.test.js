import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPollCommand } from '../src/collectors/windows/winevt-poll.js';

describe('winevt poll script', () => {
  it('uses FormatDescription for Message', () => {
    const script = buildPollCommand('Security', 100);
    assert.ok(script.includes('FormatDescription()'));
    assert.ok(script.includes('Get-WinEvent'));
    assert.ok(script.includes('EventRecordID > 100'));
  });
});
