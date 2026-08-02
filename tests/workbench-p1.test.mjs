import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  commandMatchScore,
  filterCommandEntries,
  normalizeCommandQuery,
} from "../src/shared/commandPalette.mjs";
import {
  buildContextPackMarkdown,
  contextPackExcerpt,
} from "../src/shared/contextPack.mjs";

test("Command Paletteは日本語・英語keywordを正規化して横断検索する", () => {
  const entries = [
    { id: "task:1", label: "実験条件を確認", category: "Tasks", keywords: ["task", "材料"] },
    { id: "note:1", label: "解析メモ", category: "Notes / Documents", keywords: ["markdown", "ベイズ"] },
  ];
  assert.equal(normalizeCommandQuery("  ＴＡＳＫ  "), "task");
  assert.ok(commandMatchScore(entries[0], "材料 task") > 0);
  assert.deepEqual(filterCommandEntries(entries, "ベイズ").map((entry) => entry.id), ["note:1"]);
  assert.deepEqual(filterCommandEntries(entries, "存在しない"), []);
});

test("Context Packは選択項目だけを構造化し、長文Noteを無条件に全文投入しない", () => {
  const longBody = "長い本文。".repeat(400);
  const markdown = buildContextPackMarkdown({
    theme: { name: "材料探索", description: "候補材料の比較" },
    purpose: "次の実験を決める",
    request: "不足情報を列挙してください。",
    generatedAt: "2026-08-02T00:00:00.000Z",
    candidates: [
      { id: "task-1", type: "task", title: "測定する", selected: true, completed: false },
      { id: "note-1", type: "note", title: "実験メモ", body: longBody, selected: true },
      { id: "resource-1", type: "resource", title: "秘密のリンク", url: "https://example.com", selected: false },
      { id: "artifact-1", type: "artifact", title: "結果.xlsx", summary: "xlsx / C:/results", selected: true },
    ],
  });
  assert.match(markdown, /# Context: 材料探索/);
  assert.match(markdown, /- \[ \] 測定する/);
  assert.match(markdown, /### 実験メモ/);
  assert.match(markdown, /…（長文のため省略）/);
  assert.match(markdown, /結果\.xlsx/);
  assert.doesNotMatch(markdown, /秘密のリンク/);
  assert.ok(contextPackExcerpt(longBody).length < longBody.length);
});

test("P1 UIは固定registry、最近履歴、Theme導線、Repository保存へ接続される", () => {
  const app = fs.readFileSync(new URL("../src/renderer/src/features/workspace/WorkspaceApp.tsx", import.meta.url), "utf8");
  const palette = fs.readFileSync(new URL("../src/renderer/src/features/workspace/components/CommandPalette.tsx", import.meta.url), "utf8");
  const contextPack = fs.readFileSync(new URL("../src/renderer/src/features/workspace/components/ContextPackDialog.tsx", import.meta.url), "utf8");
  const themePage = fs.readFileSync(new URL("../src/renderer/src/features/workspace/pages/ThemePage.tsx", import.meta.url), "utf8");

  assert.match(app, /Ctrl\+Shift\+K|event\.shiftKey/);
  assert.match(app, /domain\.tasks\.map/);
  assert.match(app, /domain\.notes\.map/);
  assert.match(app, /themes\.map/);
  assert.match(palette, /tasken:command-palette:recent:v1/);
  assert.match(palette, /ArrowDown/);
  assert.match(palette, /ArrowUp/);
  assert.match(themePage, /openContextPack\(theme\.id\)/);
  assert.match(contextPack, /await saveEntity\("note"/);
  assert.match(contextPack, /workspaceApi\.copyText\(markdown\)/);
  assert.match(contextPack, /source_context_pack_id/);
});
