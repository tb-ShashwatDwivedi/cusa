import { eventLoopUtilization as eluImport } from 'node:perf_hooks';

/** SEA / some embedders ship perf_hooks without eventLoopUtilization — must not call at load. */
const eventLoopUtilization =
  typeof eluImport === 'function' ? eluImport : null;

const MB = 1024 * 1024;

/** @returns {object} */
export function memorySnapshot() {
  const mem = process.memoryUsage();
  const snap = {
    rss_mb: roundMb(mem.rss),
    heap_used_mb: roundMb(mem.heapUsed),
    heap_total_mb: roundMb(mem.heapTotal),
    external_mb: roundMb(mem.external),
    array_buffers_mb: roundMb(mem.arrayBuffers ?? 0),
  };
  let resource;
  try {
    resource = process.resourceUsage();
  } catch {
    resource = null;
  }
  return {
    memory: snap,
    uptime_sec: Math.floor(process.uptime()),
    resource: resource
      ? {
          maxRss_mb: roundMb(resource.maxRSS * 1024),
          userCpuMicros: resource.userCPUTime,
          systemCpuMicros: resource.systemCPUTime,
        }
      : undefined,
    handles: activeHandleEstimate(),
  };
}

function roundMb(n) {
  return Math.round((n / MB) * 100) / 100;
}

/** Best-effort handle counts (Node does not expose full FD list without async_hooks). */
export function activeHandleEstimate() {
  const handles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
  const requests = typeof process._getActiveRequests === 'function' ? process._getActiveRequests() : [];
  let timers = 0;
  let sockets = 0;
  let other = 0;
  for (const h of handles) {
    const name = h?.constructor?.name || '';
    if (name.includes('Timer') || name === 'Timeout') timers += 1;
    else if (name.includes('Socket') || name === 'TCP') sockets += 1;
    else other += 1;
  }
  return {
    activeHandles: handles.length,
    activeRequests: requests.length,
    timers,
    sockets,
    other,
  };
}

/** @type {import('node:perf_hooks').EventLoopUtilization | null} */
let lastElu = null;

/** @returns {{ idle: number, active: number, utilization: number, available?: boolean }} */
export function eventLoopSnapshot() {
  if (!eventLoopUtilization) {
    return { idle: 0, active: 0, utilization: 0, available: false };
  }
  if (lastElu === null) {
    lastElu = eventLoopUtilization();
  }
  const elu = eventLoopUtilization(lastElu);
  lastElu = eventLoopUtilization();
  return {
    idle: elu.idle,
    active: elu.active,
    utilization: elu.utilization,
    available: true,
  };
}

/**
 * Low-frequency memory sampler for logs/metrics.
 * @param {import('pino').Logger} [logger]
 * @param {object} [opts]
 */
export function startMemorySampler(logger, opts = {}) {
  const intervalMs = opts.intervalMs ?? 5 * 60 * 1000;
  const warnRssMb = opts.warnRssMb ?? 200;
  const timers = [];
  const sample = (label) => {
    const snap = memorySnapshot();
    const elu = eventLoopSnapshot();
    const payload = { label, ...snap, eventLoop: elu };
    if (snap.memory.rss_mb >= warnRssMb) {
      logger?.warn(payload, 'Memory threshold crossed');
    } else {
      logger?.info(payload, 'Memory sample');
    }
    return payload;
  };
  const afterMin = setTimeout(() => sample('after_1_min'), 60_000);
  afterMin.unref?.();
  const periodic = setInterval(() => sample('periodic'), intervalMs);
  periodic.unref?.();
  const startup = sample('startup');
  return {
    startup,
    sample,
    stop() {
      clearTimeout(afterMin);
      clearInterval(periodic);
    },
  };
}
