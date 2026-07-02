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
    themes: [{ id: "theme-1", name: "材料A" }],
  });

  assert.match(markdown, /^# Activity Log 2026-07-02/);
  assert.match(markdown, /- \[x\] 材料A \/ 測定を終える/);
  assert.doesNotMatch(markdown, /別日の完了/);
  assert.match(markdown, /- 材料A \/ 回答を確認 \/ Lab/);
  assert.match(markdown, /## 作成・更新したNotes\n- なし/);
  assert.match(markdown, /- 材料A: 一区切り/);
  assert.match(markdown, /- 作業メモ/);
});
