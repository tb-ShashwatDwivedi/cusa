import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class ComplianceEngine {
  /** @param {object} config */
  constructor(config) {
    this.policyPath = config.policyPath;
    this.policy = null;
  }

  async load() {
    if (!this.policyPath) return;
    const raw = await readFile(this.policyPath, 'utf8');
    this.policy = JSON.parse(raw);
  }

  async runChecks() {
    if (!this.policy?.checks) return [];
    const results = [];
    for (const check of this.policy.checks) {
      const result = await this.runCheck(check);
      results.push(result);
    }
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
        const { stdout } = await execFileAsync(check.command, check.args || [], { timeout: 15000 });
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
      status,
      severity: check.severity || 'medium',
      evidence,
      timestamp: new Date().toISOString(),
    };
  }
}
