import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyFixedEnrollment, FIXED_ENROLLMENT, redactEnrollment } from '../src/wazuh/enrollment-defaults.js';
import { serializeStateItem } from '../src/wazuh/v4/event-serializer.js';

describe('enrollment credentials', () => {
  it('always applies wazuh-wui API and authd credentials', () => {
    const config = applyFixedEnrollment({ wazuh: { enrollment: { groups: ['default'] } } });
    assert.equal(config.wazuh.enrollment.password, FIXED_ENROLLMENT.password);
    assert.equal(config.wazuh.enrollment.apiUser, 'wazuh-wui');
    assert.equal(config.wazuh.enrollment.apiPassword, 'wazuh-wui');
  });

  it('overwrites any user-supplied enrollment secrets', () => {
    const config = applyFixedEnrollment({
      wazuh: { enrollment: { password: 'other', apiUser: 'admin', apiPassword: 'secret' } },
    });
    assert.equal(config.wazuh.enrollment.password, 'wazuh-wui');
    assert.equal(config.wazuh.enrollment.apiUser, 'wazuh-wui');
    assert.equal(config.wazuh.enrollment.apiPassword, 'wazuh-wui');
  });

  it('redacts secrets for the GUI', () => {
    const redacted = redactEnrollment({ password: 'wazuh-wui', apiPassword: 'wazuh-wui', apiUser: 'wazuh-wui' });
    assert.equal(redacted.password, true);
    assert.equal(redacted.apiPassword, true);
    assert.equal(redacted.apiUser, 'wazuh-wui');
  });
});

describe('4.11 state serialize', () => {
  it('uses syscollector location instead of OpenSearch index names', () => {
    const line = serializeStateItem({
      index: 'wazuh-states-inventory-system',
      data: { os: 'win32' },
    });
    assert.equal(line, 'd:syscollector:{"os":"win32"}');
  });
});
