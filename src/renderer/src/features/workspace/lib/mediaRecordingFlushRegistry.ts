const pendingMediaRecordingFlushes = new Set<Promise<boolean>>();

export function trackPendingMediaRecordingFlush(promise: Promise<boolean>): void {
  let tracked: Promise<boolean>;
  tracked = promise.then(
    (ok) => {
      pendingMediaRecordingFlushes.delete(tracked);
      return ok;
    },
    () => {
      pendingMediaRecordingFlushes.delete(tracked);
      return false;
    },
  );
  pendingMediaRecordingFlushes.add(tracked);
}

export async function flushPendingMediaRecordingFlushes(): Promise<boolean> {
  let ok = true;
  while (pendingMediaRecordingFlushes.size) {
    const results = await Promise.all([...pendingMediaRecordingFlushes]);
    if (results.some((result) => !result)) ok = false;
  }
  return ok;
}
