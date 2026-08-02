import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

const timeline = await importBundled("src/renderer/src/features/workspace/lib/slideTimeline.ts");
const timelineSource = readFileSync("src/renderer/src/features/workspace/lib/slideTimeline.ts", "utf8");
const pageSource = readFileSync("src/renderer/src/features/workspace/pages/TimelinePage.tsx", "utf8");
const dialogSource = readFileSync("src/renderer/src/features/workspace/components/SlideTimelineDialog.tsx", "utf8");
const serviceSource = readFileSync("src/main/services/workspaceService.ts", "utf8");
const ipcSource = readFileSync("src/shared/ipc/contracts.ts", "utf8");

function domainFixture() {
  return {
    projects: [],
    capture_entries: [],
    tasks: [
      { id: "t1", project_id: "p1", title: "分析設計", state: "doing", priority: "normal", created_at: "2026-07-01" },
      { id: "t2", project_id: "p2", title: "別Theme", state: "todo", priority: "normal", created_at: "2026-07-01" },
    ],
    waitings: [],
    plan_nodes: [],
    schedules: [
      { id: "s1", owner_type: "task", owner_id: "t1", start_date: "2026-07-03", end_date: "2026-07-20", date_kind: "range", confidence: "fixed", granularity: "day" },
    ],
    notes: [],
    resources: [],
    sketches: [],
    knowledge_nodes: [],
    references: [],
    task_dependencies: [],
    plan_dependencies: [],
    knowledge_edges: [],
    ai_proposals: [],
    change_events: [
      { id: "e1", entity_type: "task", entity_id: "t1", changed_at: "2026-07-10T10:00:00Z", change_type: "updated", source: "manual" },
      { id: "e2", entity_type: "task", entity_id: "t2", changed_at: "2026-07-10T10:00:00Z", change_type: "updated", source: "manual" },
    ],
  };
}

test("Theme and period produce distinct Task and Activity candidates", () => {
  const result = timeline.buildSlideTimelineCandidates(
    domainFixture(),
    [{ id: "u1", theme_id: "p1", date: "2026-07-12", summary: "レビュー完了" }],
    { themeId: "p1", start: "2026-07-01", end: "2026-07-31" },
  );
  assert.deepEqual(result.map((item) => item.kind), ["task", "activity", "activity"]);
  assert.equal(result[0].start, "2026-07-03");
  assert.equal(result[0].end, "2026-07-20");
  assert.ok(result.every((item) => item.projectId === "p1"));
});

test("16:9 SVG distinguishes task bars and activity diamonds and supports transparent background", () => {
  const candidates = timeline.buildSlideTimelineCandidates(
    domainFixture(),
    [],
    { themeId: "p1", start: "2026-07-01", end: "2026-07-31" },
  );
  const svg = timeline.buildSlideTimelineSvg({
    title: "長期テーマの振り返り",
    subtitle: "TaskとActivity",
    themeName: "材料A評価",
    start: "2026-07-01",
    end: "2026-07-31",
    unit: "week",
    background: "transparent",
    items: candidates,
  });
  assert.match(svg, /width="1600" height="900"/);
  assert.match(svg, />TASK</);
  assert.match(svg, />ACT</);
  assert.match(svg, /<rect[^>]+rx="8"[^>]+fill="#8a2f3b"/);
  assert.match(svg, /<path d="M [^"]+" fill="#2f6fa6"/);
  assert.doesNotMatch(svg, /width="1600" height="900" fill="#fffdfb"/);
});

test("dense output stays bounded and tells the user to select fewer items", () => {
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    kind: index % 2 ? "activity" : "task",
    title: `項目 ${index}`,
    start: "2026-07-10",
    end: "2026-07-10",
    projectId: "p1",
    status: "todo",
    detail: "予定",
  }));
  const svg = timeline.buildSlideTimelineSvg({
    title: "100件",
    subtitle: "",
    themeName: "Theme",
    start: "2026-07-01",
    end: "2026-07-31",
    unit: "week",
    background: "white",
    items,
  });
  assert.match(svg, /ほか 76 件/);
  assert.match(svg, /fill="#fffdfb"/);
});

test("Timeline UI connects preview, selection, PNG clipboard, and SVG save boundaries", () => {
  assert.match(pageSource, /SlideTimelineDialog/);
  assert.match(pageSource, />スライド用</);
  assert.match(dialogSource, /PowerPoint用にコピー/);
  assert.match(dialogSource, /slideTimelineSvgToPng\(svg, 2\)/);
  assert.match(dialogSource, /workspaceApi\.copyImage/);
  assert.match(timelineSource, /data:image\/svg\+xml;charset=utf-8/);
  assert.doesNotMatch(timelineSource, /createObjectURL/);
  assert.match(dialogSource, /workspaceApi\.exportSlideTimeline/);
  assert.match(dialogSource, /selectedIds/);
  assert.match(serviceSource, /exportSlideTimeline/);
  assert.match(serviceSource, /fs\.writeFileSync\(result\.filePath, request\.svg, "utf8"\)/);
  assert.match(ipcSource, /clipboardWriteImage/);
  assert.match(ipcSource, /slideTimelineExport/);
});
