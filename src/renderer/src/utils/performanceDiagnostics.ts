export const PERFORMANCE_DIAGNOSTICS_STORAGE_KEY = "tasken.performanceDiagnostics";

type DiagnosticKind = "long_task" | "event_loop_lag";

type DiagnosticEvent = {
  source: "renderer";
  kind: DiagnosticKind;
  duration_ms: number;
  heap_used_mb?: number;
};

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number;
  };
};

function diagnosticsEnabled(): boolean {
  try {
    return window.localStorage.getItem(PERFORMANCE_DIAGNOSTICS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function coarseHeapUsedMb(): number | undefined {
  const bytes = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  if (!Number.isFinite(bytes)) return undefined;
  return Math.round(Number(bytes) / 1024 / 1024 / 8) * 8;
}

function report(event: DiagnosticEvent): void {
  console.info("[tasken:performance]", event);
}

export function installRendererPerformanceDiagnostics(): () => void {
  if (!diagnosticsEnabled()) return () => undefined;

  let observer: PerformanceObserver | null = null;
  if (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        report({
          source: "renderer",
          kind: "long_task",
          duration_ms: Math.round(entry.duration),
          heap_used_mb: coarseHeapUsedMb(),
        });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  }

  const sampleIntervalMs = 1_000;
  const lagThresholdMs = 200;
  let expectedAt = performance.now() + sampleIntervalMs;
  const timer = window.setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - expectedAt);
    expectedAt = now + sampleIntervalMs;
    if (lag >= lagThresholdMs) {
      report({
        source: "renderer",
        kind: "event_loop_lag",
        duration_ms: Math.round(lag),
        heap_used_mb: coarseHeapUsedMb(),
      });
    }
  }, sampleIntervalMs);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    observer?.disconnect();
    window.removeEventListener("pagehide", stop);
  };
  window.addEventListener("pagehide", stop, { once: true });
  return stop;
}
