import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWinevtPayload, isWinevtPayload } from '../src/collectors/windows/winevt-format.js';
import { serializeEvent } from '../src/wazuh/v4/event-serializer.js';
import { formatKeepalive } from '../src/wazuh/v4/keepalive.js';

describe('windows eventchannel payload', () => {
  it('builds Message+Event JSON required by winevtchannel decoder', () => {
    const xml = "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><EventID>4624</EventID></System></Event>";
    const raw = buildWinevtPayload({ Message: 'An account was successfully logged on.', Event: xml });
    const parsed = JSON.parse(raw);
    assert.equal(parsed.Event, xml);
    assert.ok(parsed.Message.includes('logged on'));
    assert.ok(isWinevtPayload(raw));
  });

  it('serializes as f:EventChannel:<json>', () => {
    const xml = "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-Security-Auditing'/><EventID>4624</EventID></System></Event>";
    const raw = buildWinevtPayload({ Message: 'ok', Event: xml });
    const line = serializeEvent({
      source: { platform: 'windows', collector: 'event-channel', channel: 'EventChannel' },
      raw,
    });
    assert.ok(line.startsWith('f:EventChannel:'));
    const body = JSON.parse(line.slice('f:EventChannel:'.length));
    assert.ok(body.Event.includes('<EventID>4624</EventID>'));
  });

  it('rejects missing Event XML', () => {
    assert.throws(() => buildWinevtPayload({ Message: 'x' }), /Event XML/);
  });
});

describe('wazuh keepalive', () => {
  it('is multi-line with merged.mg and agent_ip', () => {
    const text = formatKeepalive({
      osLabel: 'Microsoft Windows 11 Pro [Ver: 10.0.26100.2033]',
      agentVersion: 'v4.11.2',
      configMd5: 'a'.repeat(32),
      mergedMd5: 'b'.repeat(32),
      agentIp: '192.168.7.21',
    });
    const lines = text.split('\n');
    assert.ok(lines[0].startsWith('#!-Microsoft Windows 11 Pro'));
    assert.ok(lines[0].includes('Wazuh v4.11.2'));
    assert.equal(lines[1], `${'b'.repeat(32)} merged.mg`);
    assert.equal(lines[2], '#"_agent_ip":192.168.7.21');
    assert.equal(lines[3], '');
  });
});
