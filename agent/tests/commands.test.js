import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseManagerCommand, formatCommandAck } from '../src/wazuh/v4/commands.js';

describe('wazuh commands', () => {
  it('parses #!-req messages', () => {
    const cmd = parseManagerCommand('#!-req 42 restart-agent');
    assert.equal(cmd.counter, 42);
    assert.equal(cmd.action, 'restart_agent');
  });

  it('formats command ack', () => {
    const ack = formatCommandAck({ counter: 7, success: true, message: 'ok' });
    assert.ok(ack.startsWith('#!-agent ack 7'));
  });
});
