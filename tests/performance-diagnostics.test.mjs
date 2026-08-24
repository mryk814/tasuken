import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath) {
  return readFileSync(path.resolve(relativePath), "utf8");
}

test("renderer performance diagnostics are opt-in and clean themselves up", () => {
  const diagnostics = source("src/renderer/src/utils/performanceDiagnostics.ts");
  assert.match(diagnostics, /tasken\.performanceDiagnostics/);
  assert.match(diagnostics, /=== "1"/);
  assert.match(diagnostics, /supportedEntryTypes\?\.includes\("longtask"\)/);
  assert.match(diagnostics, /event_loop_lag/);
  assert.match(diagnostics, /clearInterval/);
  assert.match(diagnostics, /observer\?\.disconnect/);
});

test("performance telemetry contains only fixed kinds, duration, and coarse heap", () => {
  const diagnostics = source("src/renderer/src/utils/performanceDiagnostics.ts");
  const eventType = diagnostics.match(/type DiagnosticEvent = \{[\s\S]*?\n\};/)?.[0] || "";
  assert.match(eventType, /kind:/);
  assert.match(eventType, /source: "renderer"/);
  assert.match(eventType, /duration_ms:/);
  assert.match(eventType, /heap_used_mb\?:/);
  assert.doesNotMatch(eventType, /title|body|url|path|query|content/i);
});

test("main performance diagnostics are opt-in and content-free", () => {
  const diagnostics = source("src/main/services/performanceDiagnostics.ts");
  assert.match(diagnostics, /TASKEN_PERF_DIAGNOSTICS/);
  assert.match(diagnostics, /event_loop_lag/);
  assert.match(diagnostics, /workspace_load/);
  assert.match(diagnostics, /result_size_kb/);
  assert.match(diagnostics, /clearInterval/);
  assert.doesNotMatch(diagnostics, /title|body|url|path|query|content/i);
});

test("workspace reload is measured only through the opt-in main diagnostic helper", () => {
  const service = source("src/main/services/workspaceService.ts");
  assert.match(service, /measureMainPerformance\("workspace_load"/);
  assert.match(service, /repository\.loadWorkspace\(includeDeleted\)/);
  assert.match(source("src/main/services/performanceDiagnostics.ts"), /TASKEN_PERF_DIAGNOSTICS/);
});

test("both process bootstraps install diagnostics without enabling them", () => {
  assert.match(source("src/renderer/src/main.tsx"), /installRendererPerformanceDiagnostics\(\)/);
  assert.match(source("src/main/index.ts"), /installMainPerformanceDiagnostics\(\)/);
});
