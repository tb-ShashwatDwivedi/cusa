import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class ComplianceEngine {
  /** @param {object} config */
  constructor(config) {
    this.policyPath = config.policyPath;
    this.policy = null;
    this.policyHash = null;
    this.policyVersion = null;
  }

  async load() {
    if (!this.policyPath) return;
    const raw = await readFile(this.policyPath, 'utf8');
    this.policy = JSON.parse(raw);
    this.policyHash = createHash('sha256').update(raw).digest('hex');
    this.policyVersion = this.policy.version || '1';
  }

  async runChecks() {
    if (!this.policy?.checks) return [];
    const results = [];
    const prev = this.policy._lastResults || {};
    for (const check of this.policy.checks) {
      const result = await this.runCheck(check);
      const prevStatus = prev[check.id];
      result.delta = prevStatus && prevStatus !== result.status ? 'changed' : 'same';
      results.push(result);
      prev[check.id] = result.status;
    }
    this.policy._lastResults = prev;
    return results;
  }

  async runCheck(check) {
    let status = 'not_applicable';
    let evidence = null;
    try {
      if (check.type === 'file_exists') {
        await readFile(check.path);
        status = 'passed';
        evidence = `File exists: ${check.path}`;
      } else if (check.type === 'command') {
        const { stdout } = await execFileAsync(check.command, check.args || [], { timeout: 15000, maxBuffer: 65536 });
        const match = check.expect ? stdout.includes(check.expect) : stdout.length > 0;
        status = match ? 'passed' : 'failed';
        evidence = stdout.slice(0, 500);
      }
    } catch (err) {
      status = check.type === 'file_exists' ? 'failed' : 'failed';
      evidence = err.message;
    }
    return {
      checkId: check.id,
      policyId: this.policy.id,
      policy_version: this.policyVersion,
      policy_hash: this.policyHash,
      status,
      severity: check.severity || 'medium',
      evidence,
      timestamp: new Date().toISOString(),
    };
  }
}
