export interface LatestSaveQueueState<Job, Result> {
  current: Job | null;
  latest: Job | null;
  inFlight: Promise<Result> | null;
}

export interface LatestSaveQueueOptions<Job, Result> {
  prepare?: (job: Job) => Job;
  save: (job: Job) => Promise<Result>;
  onStart?: (promise: Promise<Result>) => void;
}

/**
 * Keep draining the newest owner snapshot even when an older in-flight save
 * rejects. A close/app flush must never observe a stale rejected promise while
 * a newer job is still waiting in `latest`.
 */
export async function drainLatestSaveQueue<Job, Result>(
  queue: LatestSaveQueueState<Job, Result>,
  options: LatestSaveQueueOptions<Job, Result>,
): Promise<Result> {
  let result: Result | undefined;
  let lastError: unknown = null;
  while (queue.latest) {
    const pending = queue.latest;
    queue.latest = null;
    const job = options.prepare ? options.prepare(pending) : pending;
    queue.current = job;
    try {
      result = await options.save(job);
      lastError = null;
    } catch (error) {
      lastError = error;
    } finally {
      queue.current = null;
    }
  }
  if (lastError) throw lastError;
  if (result === undefined) throw new Error("保存キューに実行対象がありません。");
  return result;
}

export function startLatestSaveQueue<Job, Result>(
  queue: LatestSaveQueueState<Job, Result>,
  options: LatestSaveQueueOptions<Job, Result>,
): Promise<Result> {
  if (queue.inFlight) return queue.inFlight;
  const running = drainLatestSaveQueue(queue, options);
  queue.inFlight = running;
  options.onStart?.(running);
  void running.then(
    () => {
      if (queue.inFlight !== running) return;
      queue.inFlight = null;
      if (queue.latest) startLatestSaveQueue(queue, options).catch(() => undefined);
    },
    () => {
      if (queue.inFlight !== running) return;
      queue.inFlight = null;
      if (queue.latest) startLatestSaveQueue(queue, options).catch(() => undefined);
    },
  );
  return running;
}
