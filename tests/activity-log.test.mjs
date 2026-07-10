import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const activityLog = await importBundled("src/renderer/src/features/workspace/lib/activityLog.ts");

test("activity log summarizes completed work and empty sections for a date", () => {
  const markdown = activityLog.buildActivityLog({
    date: "2026-07-02",
    domain: {
      projects: [{ id: "theme-1", name: "材料A" }],
      tasks: [
        { id: "task-1", project_id: "theme-1", title: "測定を終える", state: "done", completed_at: "2026-07-02T10:00:00.000Z" },
        { id: "task-2", project_id: "theme-1", title: "別日の完了", state: "done", completed_at: "2026-07-01T10:00:00.000Z" },
      ],
      waitings: [
        { id: "waiting-1", project_id: "theme-1", title: "回答を確認", waiting_for: "Lab", state: "received", updated_at: "2026-07-02T11:00:00.000Z" },
      ],
      notes: [],
      resources: [],
      knowledge_nodes: [],
      capture_entries: [{ id: "cap-1", text: "作業メモ", captured_at: "2026-07-02T12:00:00.000Z", state: "untriaged" }],
    },
    statusUpdates: [{ id: "status-1", theme_id: "theme-1", date: "2026-07-02", summary: "一区切り" }],
    themes: [{ id: "theme-1", name: "材料A", code: "MAT-A", description: "材料評価テーマ" }],
  });

  assert.match(markdown, /^# Activity Log 2026-07-02/);
  assert.match(markdown, /## 登場したTheme\n- 材料A \/ MAT-A \/ 材料評価テーマ/);
  assert.match(markdown, /- \[x\] 材料A \(MAT-A\) \/ 測定を終える/);
  assert.doesNotMatch(markdown, /別日の完了/);
  assert.match(markdown, /- 材料A \(MAT-A\) \/ 回答を確認 \/ Lab/);
  assert.match(markdown, /## 作成・更新したNotes\n- なし/);
  assert.match(markdown, /- 材料A \(MAT-A\): 一区切り/);
  assert.match(markdown, /- 作業メモ/);
});

test("activity log resolves current official theme name code and description by id", () => {
  const renamed = activityLog.buildActivityLog({
    date: "2026-07-02",
    domain: {
      tasks: [
        { id: "task-1", project_id: "theme-1", title: "測定", state: "done", completed_at: "2026-07-02T10:00:00.000Z" },
      ],
      waitings: [],
      notes: [],
      resources: [],
      knowledge_nodes: [],
      capture_entries: [],
    },
    statusUpdates: [],
    themes: [{ id: "theme-1", name: "材料A改", code: "MAT-A2", description: "改訂後の概要" }],
  });

  assert.match(renamed, /- 材料A改 \/ MAT-A2 \/ 改訂後の概要/);
  assert.match(renamed, /- \[x\] 材料A改 \(MAT-A2\) \/ 測定/);
});

test("activity log marks missing themes without inventing fake personal work", () => {
  const markdown = activityLog.buildActivityLog({
    date: "2026-07-02",
    domain: {
      tasks: [
        { id: "task-1", project_id: "gone-theme", title: "孤児タスク", state: "done", completed_at: "2026-07-02T10:00:00.000Z" },
        { id: "task-2", project_id: null, title: "個人タスク", state: "done", completed_at: "2026-07-02T11:00:00.000Z" },
      ],
      waitings: [],
      notes: [],
      resources: [],
      knowledge_nodes: [],
      capture_entries: [],
    },
    statusUpdates: [{ id: "status-1", theme_id: null, date: "2026-07-02", summary: "全体メモ" }],
    themes: [],
  });

  assert.match(markdown, /- 削除済みTheme \/ gone-the \/ —/);
  assert.match(markdown, /- \[x\] 削除済みTheme \(gone-the\) \/ 孤児タスク/);
  assert.match(markdown, /- \[x\] 個人業務 \/ 個人タスク/);
  assert.match(markdown, /- 全体: 全体メモ/);
  // Theme なし活動は「登場したTheme」に載せない
  assert.doesNotMatch(markdown, /## 登場したTheme\n- 個人業務/);
});

test("resolveActivityTheme and format helpers stay readable for external markdown", () => {
  const live = activityLog.resolveActivityTheme(
    [{ id: "t1", name: "材料A", code: "MAT-A", description: "評価中" }],
    "t1",
  );
  assert.equal(activityLog.formatActivityThemeLabel(live), "材料A (MAT-A)");
  assert.equal(activityLog.formatActivityThemeDetail(live), "- 材料A / MAT-A / 評価中");

  const bare = activityLog.resolveActivityTheme([{ id: "t2", name: "雑務" }], "t2");
  assert.equal(activityLog.formatActivityThemeLabel(bare), "雑務");
  assert.equal(activityLog.formatActivityThemeDetail(bare), "- 雑務 / — / —");

  const none = activityLog.resolveActivityTheme([], null);
  assert.equal(none.name, "個人業務");
  assert.equal(activityLog.formatActivityThemeLabel(none), "個人業務");
});
