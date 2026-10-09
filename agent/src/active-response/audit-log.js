import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Durable JSONL audit log for active response. */
export class ResponseAuditLog {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.path = join(dataDir, 'audit', 'active-response.jsonl');
  }

  async init() {
    await mkdir(join(this.path, '..'), { recursive: true });
  }

  /** @param {object} record */
  async write(record) {
    const row = {
      id: randomUUID(),
      ...record,
      recorded_at: new Date().toISOString(),
    };
    await appendFile(this.path, JSON.stringify(row) + '\n');
    return row;
  }
}
