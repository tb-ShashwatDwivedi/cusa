import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDeployOverlay, writeDeployOverlay } from '../src/platform/deploy.js';

describe('deploy overlay', () => {
  let dir;
  let deployPath;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cusa-deploy-'));
    deployPath = join(dir, 'deploy.json');
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and loads centralized manager config', async () => {
    await writeDeployOverlay(deployPath, {
      source: 'msi',
      wazuh: {
        manager: { address: '10.0.0.50', port: 1514, enrollmentPort: 1515 },
      },
    });
    const overlay = await loadDeployOverlay(deployPath);
    assert.equal(overlay.wazuh.manager.address, '10.0.0.50');
    assert.equal(overlay.source, 'msi');
    const raw = JSON.parse(await readFile(deployPath, 'utf8'));
    assert.equal(raw.schemaVersion, 1);
  });

  it('reads manager from environment', async () => {
    const prev = process.env.CUSA_MANAGER_ADDRESS;
    process.env.CUSA_MANAGER_ADDRESS = '192.168.1.10';
    const overlay = await loadDeployOverlay(join(dir, 'missing.json'));
    assert.equal(overlay.wazuh.manager.address, '192.168.1.10');
    if (prev === undefined) delete process.env.CUSA_MANAGER_ADDRESS;
    else process.env.CUSA_MANAGER_ADDRESS = prev;
  });
});
