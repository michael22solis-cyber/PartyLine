// Fair concurrency limiter: at most `concurrency` jobs run at once; waiting jobs are served round-robin by key
// (one key per player), so one chatty player can't starve everyone else. Queues are bounded and waits time out.

export class BusyError extends Error {
  constructor(message = 'Busy, try again in a moment.') { super(message); this.status = 503; this.code = 'busy'; }
}

export function createLimiter({ concurrency = 8, maxQueue = 200, perKeyQueue = 4, queueTimeoutMs = 30_000 } = {}) {
  let running = 0;
  const queues = new Map(); // key -> [job]
  const order = []; // round-robin order of keys with waiting jobs
  let waiting = 0;

  function next() {
    while (running < concurrency && order.length) {
      const key = order.shift();
      const q = queues.get(key);
      const job = q.shift();
      if (q.length) order.push(key); else queues.delete(key);
      waiting -= 1;
      clearTimeout(job.timer);
      start(job);
    }
  }

  function start(job) {
    running += 1;
    Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => { running -= 1; next(); });
  }

  function run(key, fn) {
    return new Promise((resolve, reject) => {
      const job = { fn, resolve, reject };
      if (running < concurrency && !order.length) { start(job); return; }
      const q = queues.get(key) || [];
      if (waiting >= maxQueue || q.length >= perKeyQueue) { reject(new BusyError()); return; }
      job.timer = setTimeout(() => {
        const list = queues.get(key);
        const i = list ? list.indexOf(job) : -1;
        if (i >= 0) {
          list.splice(i, 1);
          waiting -= 1;
          if (!list.length) { queues.delete(key); order.splice(order.indexOf(key), 1); }
          reject(new BusyError('Timed out waiting for a free line.'));
        }
      }, queueTimeoutMs);
      job.timer.unref?.();
      if (!queues.has(key)) { queues.set(key, q); order.push(key); }
      q.push(job);
      waiting += 1;
    });
  }

  return { run, stats: () => ({ running, waiting, keys: order.length }) };
}
