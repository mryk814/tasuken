import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  addDraftSnapshot,
  addSourceDraft,
  buildDraftRerequest,
  normalizeDraftWorkspace,
} from "../src/shared/draftWorkspace.mjs";

test("Draft WorkspaceはSourceとSnapshotを正規化し、保持数を制限する", () => {
  let workspace = normalizeDraftWorkspace(null);
  for (let index = 0; index < 14; index += 1) {
    workspace = addSourceDraft(workspace, {
      id: `source-${index}`,
      body: `# Source ${index}`,
      created_at: `2026-08-02T00:${String(index).padStart(2, "0")}:00.000Z`,
      ai_service: "ChatGPT",
    });
  }
  for (let index = 0; index < 23; index += 1) {
    workspace = addDraftSnapshot(workspace, {
      id: `snapshot-${index}`,
      label: `版 ${index}`,
      body: `working ${index}`,
      created_at: `2026-08-02T01:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }

  assert.equal(workspace.sources.length, 12);
  assert.equal(workspace.sources[0].id, "source-2");
  assert.equal(workspace.active_source_id, "source-13");
  assert.equal(workspace.snapshots.length, 20);
  assert.equal(workspace.snapshots[0].id, "snapshot-3");
});

test("AI再依頼は元指示とWorking Draftを含み、Sourceの追加はWorking本文を所有しない", () => {
  const workspace = addSourceDraft(null, {
    id: "source-1",
    body: "# AI原稿",
    instruction: "短く書く",
    created_at: "2026-08-02T00:00:00.000Z",
  });
  assert.equal("working_body" in workspace, false);
  const prompt = buildDraftRerequest({
    title: "研究メモ",
    workingBody: "# 編集版\n\n判断を書く",
    source: workspace.sources[0],
    request: "結論を先にしてください。",
  });
  assert.match(prompt, /元の指示[\s\S]*短く書く/);
  assert.match(prompt, /現在のWorking Draft[\s\S]*判断を書く/);
  assert.match(prompt, /今回の依頼[\s\S]*結論を先に/);
});

test("Draft Workspace UIは通常Note保存、Diff部分採用、Undo、履歴へ縦接続される", () => {
  const dialog = readFileSync("src/renderer/src/features/workspace/components/DraftWorkspaceDialog.tsx", "utf8");
  const notes = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.match(dialog, /properties_json:[\s\S]*draft_workspace/);
  assert.match(dialog, /body_markdown: nextWorkingBody/);
  assert.match(dialog, /restoreMarkdownDiffHunk\(workingBody, hunk\)/);
  assert.match(dialog, /pushUndo\(workingBody\)/);
  assert.match(dialog, /addDraftSnapshot/);
  assert.match(dialog, /未保存の入力があります/);
  assert.match(dialog, /http:.*https:/);
  assert.match(dialog, /Source Draftを追加しました。Working Draftは上書きしていません/);
  assert.match(dialog, /AIへの再依頼文をコピーしました/);
  assert.match(notes, /AI Draft/);
  assert.match(notes, /Draft Workspace/);
  assert.match(app, /notes:draft-workspace/);
  assert.match(css, /\.draft-workspace-dialog/);
});
