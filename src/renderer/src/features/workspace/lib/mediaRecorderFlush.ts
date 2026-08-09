interface MediaRecorderDataFlushTarget {
  addEventListener(type: "dataavailable", listener: EventListener): void;
  removeEventListener(type: "dataavailable", listener: EventListener): void;
  requestData(): void;
}

interface MediaRecorderDataFlushOptions {
  quietMs?: number;
  timeoutMs?: number;
}

/**
 * A timeslice event may already be queued when requestData() is called. Wait
 * until the requested event and any earlier event have both gone quiet before
 * advancing the durable Main session to paused.
 */
export function waitForMediaRecorderDataFlush(
  recorder: MediaRecorderDataFlushTarget,
  options: MediaRecorderDataFlushOptions = {},
): Promise<void> {
  const quietMs = options.quietMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 3_000;
  return new Promise((resolve, reject) => {
    let quietTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const cleanup = () => {
      recorder.removeEventListener("dataavailable", onDataAvailable);
      if (quietTimer !== null) globalThis.clearTimeout(quietTimer);
      if (timeoutTimer !== null) globalThis.clearTimeout(timeoutTimer);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const onDataAvailable: EventListener = () => {
      if (quietTimer !== null) globalThis.clearTimeout(quietTimer);
      quietTimer = globalThis.setTimeout(finish, quietMs);
    };
    recorder.addEventListener("dataavailable", onDataAvailable);
    timeoutTimer = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("録音データのflushが時間内に完了しませんでした。"));
    }, timeoutMs);
    try {
      recorder.requestData();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
