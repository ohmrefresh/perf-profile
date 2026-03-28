/**
 * semaphore.ts
 * Concurrency limiter for Prometheus MCP tool calls.
 * Hard limit: MAX_CONCURRENT = 4 simultaneous Prometheus queries.
 */

export class Semaphore {
  private readonly max: number;
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    this.max = max;
  }

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (this.current < this.max) {
          this.current++;
          resolve(() => this.release());
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  private release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }

  get activeCount(): number  { return this.current; }
  get pendingCount(): number { return this.queue.length; }
}

/**
 * Run all tasks with max MAX_CONCURRENT simultaneous executions.
 * Remaining tasks are queued (FIFO) and dispatched as slots free.
 */
export const MAX_CONCURRENT = 4;

export async function runWithPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = MAX_CONCURRENT
): Promise<T[]> {
  const semaphore = new Semaphore(concurrency);
  return Promise.all(
    tasks.map(async (task) => {
      const release = await semaphore.acquire();
      try {
        return await task();
      } finally {
        release();
      }
    })
  );
}

/**
 * Build task list for one profile run.
 * Orchestrator calls this — baseline-diff skipped when env_name=qa.
 */
export function buildTaskList(params: {
  app_name: string;
  env_name: string;
  period: string;
}): Array<{ skill: string; agent: string; params: Record<string, string> }> {
  const { app_name, env_name, period } = params;
  const isQa = env_name === 'qa';

  const tasks = [
    { skill: 'query_range',        agent: 'traffic-share',   params: { app_name, env_name, period } },
    { skill: 'histogram_quantile', agent: 'latency-profile', params: { app_name, env_name, period } },
    { skill: 'instant_query',      agent: 'error-rate',      params: { app_name, env_name, period, status_pattern: '5..' } },
  ];

  if (!isQa) {
    tasks.push(
      { skill: 'offset_query', agent: 'baseline-diff', params: { app_name, env_name, period } }
    );
  }

  return tasks;
}

/**
 * Compute step duration from period string.
 * Targets ~300 data points. Floor at 15s.
 */
export function computeStep(period: string): string {
  const map: Record<string, number> = {
    '1h':  3600,
    '24h': 86400,
    '3d':  259200,
    '7d':  604800,
    '14d': 1209600,
  };
  const seconds = map[period] ?? 86400;
  const step = Math.max(15, Math.floor(seconds / 300));
  return `${step}s`;
}
