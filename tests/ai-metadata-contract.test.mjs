import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiEntityHeader,
  normalizeAiMetadata,
  resolveAiAuthority,
  resolveAiFreshness,
  resolveAiSummary,
} from "../src/shared/aiMetadata.mjs";
import { normalizeEntity, validateEntity } from "../src/main/repositories/domain.mjs";
import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";

test("AI共通metadataは未設定と明示指定を区別して正規化する（#294）", () => {
  const empty = normalizeAiMetadata("task", { title: "T" });
  assert.equal(empty.ai_summary, null);
  assert.equal(empty.ai_freshness, null);
  assert.equal(empty.ai_authority, null);
  assert.deepEqual(empty.ai_source_refs, []);
  // AI公開範囲は廃止した概念。出力に欄を持たない。
  assert.equal("ai_visibility" in empty, false);
});

test("更新前の端末が送る ai_visibility / default_ai_visibility は、拒否せず捨てる", () => {
  // どんな値でも（不正な値でも）受け取り、同期やコマンドを止めない。
  for (const legacy of [
    null,
    [],
    ["m365"],
    ["coding_agent", "external_ai"],
    ["slack"],
    "local_only",
  ]) {
    const metadata = normalizeAiMetadata("theme", {
      ai_summary: "概要",
      ai_visibility: legacy,
      default_ai_visibility: legacy,
    });
    assert.equal(metadata.ai_summary, "概要");
    assert.equal("ai_visibility" in metadata, false);
    assert.equal("default_ai_visibility" in metadata, false);

    const task = { id: "task-1", title: "旧データ", state: "todo", ai_visibility: legacy };
    assert.doesNotThrow(() => validateEntity("task", task));
    assert.equal("ai_visibility" in normalizeEntity("task", task), false);

    const theme = {
      id: "theme-1",
      name: "材料A",
      default_ai_visibility: legacy,
      ai_visibility: legacy,
    };
    assert.doesNotThrow(() => validateEntity("theme", theme));
    const normalizedTheme = normalizeEntity("theme", theme);
    assert.equal("default_ai_visibility" in normalizedTheme, false);
    assert.equal("ai_visibility" in normalizedTheme, false);
  }
});

test("supersededは置き換え先なしで名乗れない（#294）", () => {
  assert.throws(() => normalizeAiMetadata("note", { ai_freshness: "superseded" }), /置き換え先/);
  const ok = normalizeAiMetadata("note", {
    ai_freshness: "superseded",
    ai_superseded_by: { type: "note", id: "note-2" },
  });
  assert.equal(ok.ai_freshness, "superseded");
  assert.deepEqual(ok.ai_superseded_by, { type: "note", id: "note-2" });
});

test("既存Entityは本文を変えずに扱え、不正な値だけ弾く（#294）", () => {
  const legacy = { id: "task-1", title: "旧データ", state: "todo", description: "本文" };
  const normalized = normalizeEntity("task", legacy);
  assert.equal(normalized.description, "本文");
  assert.equal(normalized.ai_freshness, null);
  assert.throws(
    () => validateEntity("task", { ...legacy, ai_authority: "guessed" }),
    /ai_authority/,
  );
});

test("概要はユーザー確定と本文からの暫定生成を混同しない（#294）", () => {
  const explicit = resolveAiSummary("note", {
    ai_summary: "手で書いた概要",
    ai_summary_authority: "user_confirmed",
  });
  assert.equal(explicit.origin, "explicit");
  assert.equal(explicit.authority, "user_confirmed");

  const derived = resolveAiSummary("note", { body_markdown: "# 見出し\n本文の書き出し" });
  assert.equal(derived.origin, "derived");
  assert.equal(derived.authority, "excerpt");
  assert.match(derived.summary, /本文の書き出し/);

  assert.equal(resolveAiSummary("note", {}).origin, "missing");
});

test("鮮度と根拠は未設定を理由付きで返し、日付だけでstaleにしない（#294）", () => {
  const unset = resolveAiFreshness({ updated_at: "2020-01-01T00:00:00.000Z" });
  assert.equal(unset.freshness, "unknown");
  assert.equal(unset.origin, "unset");
  assert.ok(unset.reason);

  assert.equal(
    resolveAiFreshness({ ai_superseded_by: { type: "note", id: "n" } }).origin,
    "derived",
  );

  // 推定はDBへ書き戻さず、推定であることを添えて返す。
  const imported = resolveAiAuthority("note", { source: "imported" });
  assert.equal(imported.authority, "imported");
  assert.equal(imported.origin, "derived");
  assert.equal(resolveAiAuthority("note", { ai_authority: "user_confirmed" }).origin, "explicit");
  assert.equal(resolveAiAuthority("note", {}).authority, null);
});

test("headerは概要・鮮度・根拠・出典をまとめて返す（#294）", () => {
  const header = buildAiEntityHeader("task", {
    id: "task-1",
    title: "測定結果を確認",
    project_id: "theme-1",
    ai_summary: "条件Bの再測定",
    ai_summary_authority: "user_confirmed",
    ai_freshness: "current",
    ai_authority: "user_confirmed",
    ai_last_verified_at: "2026-08-05",
    ai_source_refs: [
      { kind: "canonical_document", locator: "notes/measure.md", storage_root_id: "sync" },
    ],
  });
  assert.equal(header.summary, "条件Bの再測定");
  assert.equal(header.freshness, "current");
  assert.equal(header.authority, "user_confirmed");
  assert.equal("ai_visibility" in header, false);
  assert.equal(header.source_refs[0].storage_root_id, "sync");
});

function workspaceFixture() {
  const stamp = "2026-08-06T00:00:00.000Z";
  return {
    themes: [
      { id: "theme-1", name: "材料A", updated_at: stamp },
      { id: "theme-2", name: "個人", updated_at: stamp },
    ],
    tasks: [
      { id: "task-1", title: "作業A", state: "todo", project_id: "theme-1", updated_at: stamp },
      { id: "task-2", title: "作業B", state: "todo", project_id: "theme-2", updated_at: stamp },
      // 更新前の端末が残した欄。値は読まれない。
      {
        id: "task-3",
        title: "作業C",
        state: "todo",
        project_id: "theme-1",
        ai_visibility: [],
        updated_at: stamp,
      },
    ],
    notes: [
      {
        id: "note-1",
        title: "メモ1",
        body_markdown: "本文1",
        theme_id: "theme-1",
        updated_at: stamp,
      },
      {
        id: "note-2",
        title: "メモ2",
        body_markdown: "本文2",
        theme_id: "theme-2",
        updated_at: stamp,
      },
    ],
    items: [],
    waitings: [],
    plan_nodes: [],
    schedules: [],
    knowledge_nodes: [],
    knowledge_edges: [],
    resources: [],
    links: [],
    projects: [],
    capture_entrys: [],
    references: [],
    task_dependencies: [],
    plan_dependencies: [],
    change_events: [],
    status_updates: [],
  };
}

test("MCPは全Entityを返す。公開範囲の欄が残っていても値は読まれない", () => {
  const context = new ReadOnlyTaskenContext("", { workspace: workspaceFixture() });
  const items = context.toolListOpenItems({});
  assert.deepEqual(items.items.map((item) => item.title).sort(), ["作業A", "作業B", "作業C"]);
  assert.equal("excluded_count" in items, false);
  assert.equal("ai_audience" in items, false);

  const notes = context.toolGetRecentNotes({ include_raw_body: true });
  assert.deepEqual(notes.notes.map((note) => note.title).sort(), ["メモ1", "メモ2"]);
  assert.equal("ai_visibility" in notes.notes[0].ai, false);
});

test("export_ai_contextは公開先を切り替えず、全Entityを一つの形で返す", () => {
  const context = new ReadOnlyTaskenContext("", { workspace: workspaceFixture() });
  const pack = context.toolExportAiContext({ format: "json" });
  assert.deepEqual(pack.items.map((item) => item.title).sort(), ["作業A", "作業B", "作業C"]);
  assert.equal("ai_audience" in pack, false);
  assert.equal("excluded_count" in pack, false);

  const markdown = context.toolExportAiContext({});
  assert.doesNotMatch(markdown, /公開先|除外した情報/);
  assert.match(markdown, /メモ1/);
});
