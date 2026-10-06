import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolvePaths, PROGRAM_DATA_WIN } from '../src/platform/paths.js';

describe('platform paths', () => {
  it('resolves structured ProgramData layout', () => {
    const p = resolvePaths(PROGRAM_DATA_WIN);
    assert.equal(p.root, PROGRAM_DATA_WIN);
    assert.equal(p.configLocal, join(PROGRAM_DATA_WIN, 'config', 'config.local.json'));
    assert.equal(p.secrets, join(PROGRAM_DATA_WIN, 'secrets', 'secrets.enc'));
    assert.equal(p.state, join(PROGRAM_DATA_WIN, 'state', 'state.json'));
    assert.equal(p.logs, join(PROGRAM_DATA_WIN, 'logs', 'agent'));
    assert.equal(p.queue, join(PROGRAM_DATA_WIN, 'queue'));
  });
});
