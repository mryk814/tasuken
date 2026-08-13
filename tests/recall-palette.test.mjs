import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { filterCommandEntries, prepareCommandEntries } from "../src/shared/commandPalette.mjs";

const bundle = await build({
  entryPoints: [path.resolve("src/renderer/src/features/workspace/lib/recallPaletteEntries.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { buildRecallPaletteEntries } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function fixture() {
  const themes = [{ id: "theme-hidden", name: "非表示Theme", group: "隠しGroup" }];
  const domain = {
    projects: [], repository_contexts: [], schedules: [], sketches: [], references: [], task_dependencies: [],
    plan_dependencies: [], knowledge_edges: [], ai_proposals: [], change_events: [], work_receipts: [],
    plan_nodes: [{ id: "p1", title: "中間判定", description: "アルデバラン閾値を決める", type: "milestone", state: "planned", sort_order: 0, project_id: "theme-hidden" }],
    tasks: [{
      id: "t1", title: "測定を進める", description: "試料のオリオン濃度を確認", state: "doing", priority: "normal", project_id: "theme-hidden",
      checklist_items: [{ id: "check-1", title: "シリウス検量線を作る", done: false, sort_order: 0 }],
    }],
    notes: [{ id: "n1", title: "会議記録", body_markdown: "判断根拠は**アウローラ条件**", note_type: "note", project_id: "theme-hidden" }],
    waitings: [{ id: "w1", title: "回答待ち", description: "旋光度アルファの返答を待つ", waiting_for: "分析室", next_action: "金曜に催促", state: "waiting", project_id: "theme-hidden" }],
    capture_entries: [{ id: "c1", title: "走り書き", text: "候補語ベテルギウスを後で分類", captured_at: "2026-08-13T09:00:00Z", state: "untriaged", project_id: "theme-hidden" }],
    knowledge_nodes: [{ id: "k1", title: "触媒仮説", body: "失活原因はコバルト被毒", node_type: "claim", project_id: "theme-hidden" }],
    resources: [
      { id: "r1", title: "AI相談", url: "https://example.test/chat/1", resource_scope: "chat_ref", body_markdown: "疎行列ゼータ戦略を採用", chat_group: "設計", project_id: "theme-hidden" },
      { id: "r2", title: "通常資料", url: "https://example.test/doc", resource_scope: "note", body_markdown: "通常資料のケフェウス本文", project_id: "theme-hidden" },
    ],
  };
  const artifacts = [{ id: "a1", title: "結果", filename: "polaris-results.csv", stored_path: "/managed/vega/result.csv", original_path: null, target: null, source_type: "task", source_id: "t1", theme_id: "theme-hidden" }];
  const data = { artifacts };
  return { data, domain, themes };
}

test("Recall Paletteは本文・待ち・記録・Knowledge・ChatをWorkspace横断検索する", () => {
  const entries = prepareCommandEntries(buildRecallPaletteEntries(fixture()));
  const cases = [
    ["オリオン濃度", "task:t1"],
    ["シリウス検量線", "task:t1"],
    ["アルデバラン閾値", "plan:p1"],
    ["アウローラ条件", "note:n1"],
    ["旋光度アルファ", "waiting:w1"],
    ["ベテルギウス", "capture:c1"],
    ["コバルト被毒", "knowledge:k1"],
    ["疎行列ゼータ", "chat:r1"],
    ["ケフェウス本文", "resource:r2"],
    ["polaris-results", "artifact:a1"],
    ["/managed/vega", "artifact:a1"],
  ];
  for (const [query, expected] of cases) {
    assert.deepEqual(filterCommandEntries(entries, query).map((entry) => entry.id), [expected], query);
  }
});

test("Recall Paletteは全Theme投影と既存画面へのtargetを返す", () => {
  const entries = buildRecallPaletteEntries(fixture());
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get("task:t1").context.includes("非表示Theme"), true);
  assert.deepEqual(byId.get("plan:p1").target, { kind: "drawer", route: "timeline", entityType: "plan_node", entityId: "p1", mode: "edit" });
  assert.deepEqual(byId.get("note:n1").target, { kind: "drawer", route: "notes", entityType: "note", entityId: "n1" });
  assert.deepEqual(byId.get("waiting:w1").target, { kind: "drawer", route: "waiting", entityType: "waiting", entityId: "w1", mode: "edit" });
  assert.deepEqual(byId.get("capture:c1").target, { kind: "drawer", route: "inbox", entityType: "capture_entry", entityId: "c1", mode: "edit" });
  assert.deepEqual(byId.get("knowledge:k1").target, { kind: "drawer", route: "knowledge", entityType: "knowledge_node", entityId: "k1", mode: "view" });
  assert.deepEqual(byId.get("chat:r1").target, { kind: "drawer", route: "chat-refs", entityType: "resource", entityId: "r1", mode: "edit" });
  assert.deepEqual(byId.get("resource:r2").target, { kind: "drawer", route: "notes", entityType: "resource", entityId: "r2" });
});

test("Ctrl+K契約はPaletteへ一本化し、入力中の既存ショートカットを守る", () => {
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const palette = readFileSync("src/renderer/src/features/workspace/components/CommandPalette.tsx", "utf8");
  const root = readFileSync("src/renderer/src/tasken-root/TaskenRootApp.tsx", "utf8");
  const rootCss = readFileSync("src/renderer/src/tasken-root/tasken-root.css", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");
  const shell = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");

  assert.match(app, /if \(!event\.shiftKey && isEditing\) return/);
  assert.match(app, /setShowCommandPalette\(\(current\) => !current\)/);
  assert.doesNotMatch(app, /querySelector\("\[data-search\]"\)/);
  assert.match(palette, /event\.key === "Escape"[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(palette, /role="combobox"/);
  assert.match(palette, /tabIndex=\{-1\}/);
  assert.match(palette, /aria-live="polite"/);
  assert.match(palette, /event\.key === "Tab"[\s\S]*?event\.preventDefault\(\)/);
  assert.match(palette, /nativeEvent\.isComposing[\s\S]*?nativeEvent\.keyCode === 229/);
  assert.match(palette, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(palette, /const resultsPending = query !== deferredQuery/);
  assert.match(palette, /if \(resultsPending \|\| entry\.disabledReason\) return/);
  assert.match(palette, /aria-busy=\{resultsPending\}/);
  assert.match(app, /const pending = drawerAutosavePromise\.current[\s\S]*?await pending[\s\S]*?isDrawerFormDirty\(\)/);
  assert.match(app, /const submittedSignature = formSignature\(form\)[\s\S]*?drawerFormInitialSignature\.current = submittedSignature/);
  assert.match(app, /recalledGroup[\s\S]*?setActiveGroups\(\[\.\.\.activeGroups, recalledGroup\]\)/);
  assert.match(app, /\.drawer input, \.drawer textarea, \.drawer button/);
  assert.match(root, /nativeEvent\.isComposing[\s\S]*?nativeEvent\.keyCode === 229/);
  assert.match(root, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(root, /Math\.max\(0, Math\.min\(current, matches\.length - 1\)\)/);
  assert.match(rootCss, /:focus-visible[\s\S]*?box-shadow: var\(--focus-ring\)/);
  assert.match(styles, /\.command-palette-result-status\s*\{[\s\S]*?color: var\(--color-text-secondary\)/);
  assert.match(shell, /Ctrl[\s\S]*Shift[\s\S]*K[\s\S]*入力中に全体検索を開く/);
});
