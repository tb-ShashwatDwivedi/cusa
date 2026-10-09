/** ponytail: single-flight gate — upgrade to a small semaphore if inventory jobs need overlap. */
export class JobGate {
  constructor() {
    this.busy = false;
    this.queue = [];
  }

  /** @param {() => Promise<void>} fn */
  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }

  pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const { fn, resolve, reject } = this.queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        this.busy = false;
        this.pump();
      });
  }
}
