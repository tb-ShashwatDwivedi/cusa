export class Scheduler {
  constructor() {
    this.tasks = [];
  }

  /** @param {string} name @param {number} intervalMs @param {() => Promise<void>} fn */
  schedule(name, intervalMs, fn) {
    const run = async () => {
      try {
        await fn();
      } catch {
        // logged by caller
      }
      if (this.tasks.find((t) => t.name === name)?.active) {
        setTimeout(run, intervalMs);
      }
    };
    const task = { name, intervalMs, fn, active: true };
    this.tasks.push(task);
    setTimeout(run, intervalMs);
    return task;
  }

  stopAll() {
    for (const t of this.tasks) t.active = false;
    this.tasks = [];
  }
}
