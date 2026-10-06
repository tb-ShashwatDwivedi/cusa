import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePaths } from '../src/platform/paths.js';
import { purgeAgentData } from '../src/platform/decommission.js';

describe('decommission purge', () => {
  let root;
  /** @type {ReturnType<typeof resolvePaths>} */
  let paths;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'cusa-decom-'));
    paths = resolvePaths(root);
    await mkdir(join(root, 'config'), { recursive: true });
    await mkdir(join(root, 'secrets'), { recursive: true });
    await mkdir(join(root, 'logs', 'agent'), { recursive: true });
    await writeFile(paths.configLocal, '{}');
    await writeFile(paths.secrets, 'cipher');
    await writeFile(join(paths.logs, 'cusa-2026-01-01.log'), 'line\n');
    await writeFile(paths.installMarker, '1');
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('purges identity and config but keeps logs by default', async () => {
    const result = await purgeAgentData(paths);
    assert.equal(result.purged, true);
    assert.ok(result.removed.includes('config'));
    assert.ok(result.removed.includes('secrets'));
    await access(join(root, 'logs', 'agent', 'cusa-2026-01-01.log'));
  });

  it('can include logs when requested', async () => {
    await mkdir(join(root, 'config'), { recursive: true });
    await writeFile(paths.configLocal, '{}');
    const result = await purgeAgentData(paths, { includeLogs: true });
    assert.ok(result.removed.includes('logs'));
  });
});
