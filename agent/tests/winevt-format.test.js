import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWinevtPayload, isWinevtPayload } from '../src/collectors/windows/winevt-format.js';
import { serializeEvent } from '../src/wazuh/v4/event-serializer.js';
import { formatKeepalive, NO_MERGED_MG_LINE } from '../src/wazuh/v4/keepalive.js';
import { encryptMessage, decryptMessage, deriveEncryptionKey } from '../src/wazuh/v4/crypto.js';

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
  it('matches stock notify.c shape (multiline, x merged.mg when no shared config)', () => {
    const text = formatKeepalive({
      osLabel: 'Microsoft Windows 11 Pro [Ver: 10.0.26100.2033]',
      agentVersion: 'v4.11.2',
      agentIp: '192.168.7.21',
    });
    assert.ok(text.includes('\n'), 'remoted rejects keepalives without newline');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    assert.ok(lines[0].startsWith('#!-Microsoft Windows 11 Pro'));
    assert.ok(lines[0].includes('Wazuh v4.11.2'));
    assert.ok(!lines[0].includes(' / '), 'no agent.conf md5 when unset');
    assert.equal(lines[1], NO_MERGED_MG_LINE);
    assert.equal(lines[2], '#"_agent_ip":192.168.7.21');
  });

  it('includes agent.conf md5 on first line when provided', () => {
    const md5 = 'a'.repeat(32);
    const text = formatKeepalive({
      osLabel: 'Microsoft Windows 11 Pro [Ver: 10.0.26100.2033]',
      agentVersion: 'v4.11.2',
      configMd5: md5,
      mergedMd5: 'b'.repeat(32),
    });
    assert.ok(text.startsWith(`#!-Microsoft Windows 11 Pro [Ver: 10.0.26100.2033] - Wazuh v4.11.2 / ${md5}\r\n`));
  });

  it('round-trips through Wazuh v4 crypto with newlines intact', () => {
    const text = formatKeepalive({
      osLabel: 'Microsoft Windows [Ver: 10.0.0.0]',
      agentVersion: 'v4.11.2',
    });
    const key = deriveEncryptionKey('testkey12345678901234567890123456789012', 'T-LT-0107', '018');
    const encrypted = encryptMessage(text, { global: 2, local: 1 }, key, '018');
    const decrypted = decryptMessage(encrypted, key);
    assert.equal(decrypted, text);
    assert.ok(decrypted.includes('\n'));
  });
});
