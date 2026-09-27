import { performanceDiagnosticsApi } from "../services/performanceDiagnosticsApi";

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

/** long taskは50ms以上で全件届くため、体感で「止まった」と感じる長さだけMainのログへ送る。 */
const LOGGED_DURATION_MS = 200;

function report(event: DiagnosticEvent): void {
  console.info("[tasken:performance]", event);
  if (event.duration_ms < LOGGED_DURATION_MS) return;
  try {
    performanceDiagnosticsApi.report({
      kind: event.kind,
      duration_ms: event.duration_ms,
      heap_used_mb: event.heap_used_mb,
    });
  } catch {
    // 診断の送信失敗で画面の動作を変えない。
  }
}

/**
 * localStorageのflag、またはアプリ起動時の TASKEN_PERF_DIAGNOSTICS=1 で有効になる。
 * 後者はDevToolsを開けない配布版で計測を始めるための入口。
 */
export function installRendererPerformanceDiagnostics(): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  const start = () => {
    if (!cancelled) stop = startRendererPerformanceDiagnostics();
  };
  if (diagnosticsEnabled()) start();
  else
    void performanceDiagnosticsApi
      .enabled()
      .then((enabled) => {
        if (enabled) start();
      })
      .catch(() => undefined);
  return () => {
    cancelled = true;
    stop();
  };
}

function startRendererPerformanceDiagnostics(): () => void {
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
