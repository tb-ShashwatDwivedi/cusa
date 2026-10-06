import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveEncryptionKey,
  encryptMessage,
  decryptMessage,
} from '../src/wazuh/v4/crypto.js';

describe('wazuh v4 crypto', () => {
  it('derives key from enrollment material', () => {
    const key = deriveEncryptionKey(
      '2801fb64625a4ca5523395d8ab7370dbed275a227688542493c6577c3d9fdf2c',
      'myagent',
      '003',
    );
    assert.equal(key.length, 47);
  });

  it('round-trips encrypt/decrypt', () => {
    const key = deriveEncryptionKey('testkey12345678901234567890123456789012', 'agent1', '001');
    const plaintext = '1:/var/log/test:hello world';
    const encrypted = encryptMessage(plaintext, { global: 1, local: 1 }, key, '001');
    const decrypted = decryptMessage(encrypted, key);
    assert.equal(decrypted, plaintext);
  });

  it('prefixes outbound payload with agent id for remoted', () => {
    const key = deriveEncryptionKey('testkey12345678901234567890123456789012', 'agent1', '003');
    const encrypted = encryptMessage('1:a:b', { global: 12, local: 3 }, key, '003');
    assert.equal(encrypted.subarray(0, 5).toString(), '!003!');
    assert.equal(encrypted.subarray(5, 10).toString(), '#AES:');
  });

  it('pads global and local counters per Wazuh wire format', () => {
    const key = deriveEncryptionKey('testkey12345678901234567890123456789012', 'agent1', '001');
    const encrypted = encryptMessage('1:loc:msg', { global: 123, local: 4 }, key);
    const decrypted = decryptMessage(encrypted, key);
    assert.equal(decrypted, '1:loc:msg');
  });
});
