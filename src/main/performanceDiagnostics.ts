type MainDiagnosticKind = "event_loop_lag" | "workspace_load";

type MainDiagnosticEvent = {
  source: "main";
  kind: MainDiagnosticKind;
  duration_ms: number;
  result_size_kb?: number;
};

function report(event: MainDiagnosticEvent): void {
  console.info("[tasken:performance]", event);
}

function diagnosticsEnabled(): boolean {
  return process.env.TASKEN_PERF_DIAGNOSTICS === "1";
}

export function measureMainPerformance<T>(kind: "workspace_load", operation: () => T): T {
  if (!diagnosticsEnabled()) return operation();

  const startedAt = performance.now();
  const result = operation();
  const durationMs = Math.round(performance.now() - startedAt);

  try {
    const serialized = JSON.stringify(result);
    const resultSizeKb =
      typeof serialized === "string" ? Math.round(Buffer.byteLength(serialized, "utf8") / 1024) : 0;
    report({ source: "main", kind, duration_ms: durationMs, result_size_kb: resultSizeKb });
  } catch {
    // Diagnostics must not change a successful workspace load when its result cannot be serialized.
    report({ source: "main", kind, duration_ms: durationMs, result_size_kb: -1 });
  }

  return result;
}

export function installMainPerformanceDiagnostics(
  enabled = process.env.TASKEN_PERF_DIAGNOSTICS === "1",
): () => void {
  if (!enabled) return () => undefined;

  const sampleIntervalMs = 1_000;
  const lagThresholdMs = 200;
  let expectedAt = Date.now() + sampleIntervalMs;
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = Math.max(0, now - expectedAt);
    expectedAt = now + sampleIntervalMs;
    if (lag >= lagThresholdMs) {
      report({ source: "main", kind: "event_loop_lag", duration_ms: Math.round(lag) });
    }
  }, sampleIntervalMs);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}
