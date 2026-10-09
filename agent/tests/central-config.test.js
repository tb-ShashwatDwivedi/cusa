import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWazuhAgentConf } from '../src/wazuh/v4/central-config.js';

describe('central config', () => {
  it('parses localfile and syscheck from agent.conf xml', () => {
    const xml = `
      <agent_config>
        <localfile><location>Security</location><log_format>eventchannel</log_format></localfile>
        <wodle name="syscheck"><directories>/var/log</directories></wodle>
        <sca><policy>custom_policy.yml</policy></sca>
      </agent_config>`;
    const patch = parseWazuhAgentConf(xml);
    assert.ok(patch.collectors.eventChannel.channels.includes('Security'));
    assert.ok(patch.fim.paths.includes('/var/log'));
    assert.equal(patch.compliance.policyPath, 'custom_policy.yml');
  });
});
