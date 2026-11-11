import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSelfCollectorWinevt } from '../src/collectors/windows/winevt-filter.js';

describe('winevt self-collector filter', () => {
  it('drops events that embed our Get-WinEvent poll script', () => {
    const row = {
      Event: '<Event><System><EventID>600</EventID></System></Event>',
      Message: 'HostApplication=powershell.exe -Command Get-WinEvent -LogName Security',
    };
    assert.equal(isSelfCollectorWinevt(row), true);
  });

  it('allows normal security events', () => {
    const row = {
      Event: '<Event><System><EventID>4624</EventID></System></Event>',
      Message: 'An account was successfully logged on.',
    };
    assert.equal(isSelfCollectorWinevt(row), false);
  });
});
