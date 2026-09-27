type MainDiagnosticKind = "event_loop_lag" | "workspace_load";
type RendererDiagnosticKind = "long_task" | "event_loop_lag";

type DiagnosticEvent =
  | {
      source: "main";
      kind: MainDiagnosticKind;
      duration_ms: number;
      result_size_kb?: number;
    }
  | {
      source: "renderer";
      kind: RendererDiagnosticKind;
      duration_ms: number;
      heap_used_mb?: number;
    };

const RENDERER_KINDS = new Set<RendererDiagnosticKind>(["long_task", "event_loop_lag"]);

let writeDiagnostic: (line: string) => void = (line) => console.info("[tasken:performance]", line);

/**
 * 配布版ではConsoleを見られないため、起動側がmain.logへの書き込みを渡す。
 * 「急に止まった」時刻とログの時刻を突き合わせて、MainとRendererのどちらが止まったか切り分ける。
 */
export function setPerformanceDiagnosticsWriter(writer: (line: string) => void): void {
  writeDiagnostic = writer;
}

function report(event: DiagnosticEvent): void {
  writeDiagnostic(JSON.stringify(event));
}

export function performanceDiagnosticsEnabled(): boolean {
  return process.env.TASKEN_PERF_DIAGNOSTICS === "1";
}

function roundedNumber(value: unknown, max: number): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) return null;
  return Math.round(number);
}

/** Rendererから届いた値は固定kindと数値だけを通し、任意の文字列をログへ入れない。 */
export function recordRendererPerformance(value: unknown): void {
  if (!performanceDiagnosticsEnabled()) return;
  if (!value || typeof value !== "object") return;
  const input = value as Record<string, unknown>;
  const kind = input.kind as RendererDiagnosticKind;
  if (!RENDERER_KINDS.has(kind)) return;
  const durationMs = roundedNumber(input.duration_ms, 3_600_000);
  if (durationMs === null) return;
  const heapUsedMb = roundedNumber(input.heap_used_mb, 1_048_576);
  report({
    source: "renderer",
    kind,
    duration_ms: durationMs,
    ...(heapUsedMb === null ? {} : { heap_used_mb: heapUsedMb }),
  });
}

export function measureMainPerformance<T>(kind: "workspace_load", operation: () => T): T {
  if (!performanceDiagnosticsEnabled()) return operation();

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
  enabled = performanceDiagnosticsEnabled(),
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
