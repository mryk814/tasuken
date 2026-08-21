import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AI_VISIBILITY,
  buildAiEntityHeader,
  normalizeAiMetadata,
  normalizeAiVisibility,
  projectEntityForAi,
  resolveAiAuthority,
  resolveAiFreshness,
  resolveAiSummary,
  resolveAiVisibility,
  summarizeAiExclusions,
} from "../src/shared/aiMetadata.mjs";
import { normalizeEntity, validateEntity } from "../src/main/repositories/domain.mjs";
import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";

test("AI共通metadataは未設定と明示指定を区別して正規化する（#294）", () => {
  const empty = normalizeAiMetadata("task", { title: "T" });
  assert.equal(empty.ai_summary, null);
  assert.equal(empty.ai_freshness, null);
  assert.equal(empty.ai_authority, null);
  // 未設定はnull、明示的な「ローカルのみ」は空配列。両者を潰さない。
  assert.equal(empty.ai_visibility, null);
  assert.deepEqual(empty.ai_source_refs, []);

  assert.deepEqual(normalizeAiVisibility([]), []);
  assert.deepEqual(normalizeAiVisibility("m365_allowed"), ["m365"]);
  assert.deepEqual(normalizeAiVisibility(["external_ai", "m365"]), ["m365", "external_ai"]);
  assert.throws(() => normalizeAiVisibility(["slack"]), /ai_visibility/);
});

test("supersededは置き換え先なしで名乗れない（#294）", () => {
  assert.throws(
    () => normalizeAiMetadata("note", { ai_freshness: "superseded" }),
    /置き換え先/,
  );
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
  assert.throws(() => validateEntity("task", { ...legacy, ai_authority: "guessed" }), /ai_authority/);
});

test("概要はユーザー確定と本文からの暫定生成を混同しない（#294）", () => {
  const explicit = resolveAiSummary("note", { ai_summary: "手で書いた概要", ai_summary_authority: "user_confirmed" });
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

  assert.equal(resolveAiFreshness({ ai_superseded_by: { type: "note", id: "n" } }).origin, "derived");

  // 推定はDBへ書き戻さず、推定であることを添えて返す。
  const imported = resolveAiAuthority("note", { source: "imported" });
  assert.equal(imported.authority, "imported");
  assert.equal(imported.origin, "derived");
  assert.equal(resolveAiAuthority("note", { ai_authority: "user_confirmed" }).origin, "explicit");
  assert.equal(resolveAiAuthority("note", {}).authority, null);
});

test("公開範囲はEntity→Theme→全体既定の順に継承し、由来を返す（#294）", () => {
  const theme = { id: "theme-1", name: "材料A", default_ai_visibility: ["m365"] };

  const entityLevel = resolveAiVisibility({ entity: { ai_visibility: [] }, theme });
  assert.deepEqual(entityLevel.audiences, []);
  assert.equal(entityLevel.source, "entity");

  const themeLevel = resolveAiVisibility({ entity: {}, theme });
  assert.deepEqual(themeLevel.audiences, ["m365"]);
  assert.equal(themeLevel.source, "theme");

  const fallback = resolveAiVisibility({ entity: {}, theme: null });
  assert.deepEqual(fallback.audiences, DEFAULT_AI_VISIBILITY);
  assert.equal(fallback.source, "workspace_default");
});

test("公開範囲外のEntityはheaderも本文も返さず、理由だけを集計する（#294）", () => {
  const local = { id: "note-1", title: "下書き", body_markdown: "秘密", ai_visibility: [] };
  const denied = projectEntityForAi("note", local, { audience: "coding_agent" });
  assert.equal(denied.included, false);
  assert.equal(denied.header, null);
  assert.ok(denied.exclusion.reason);

  const allowed = projectEntityForAi("note", { ...local, ai_visibility: ["coding_agent"] }, { audience: "coding_agent" });
  assert.equal(allowed.included, true);
  assert.deepEqual(allowed.header.ai_visibility, ["coding_agent"]);

  // M365可でもCoding Agent可とは限らない。単一のladderに潰さない。
  const m365Only = projectEntityForAi("note", { ...local, ai_visibility: ["m365"] }, { audience: "coding_agent" });
  assert.equal(m365Only.included, false);

  const summary = summarizeAiExclusions([denied.exclusion, m365Only.exclusion]);
  assert.equal(summary.excluded_count, 2);
  assert.equal(summary.excluded_reasons.length, 1);
  assert.equal(summary.excluded_reasons[0].count, 2);
});

test("headerは概要・鮮度・根拠・公開範囲・出典をまとめて返す（#294）", () => {
  const header = buildAiEntityHeader("task", {
    id: "task-1",
    title: "測定結果を確認",
    project_id: "theme-1",
    ai_summary: "条件Bの再測定",
    ai_summary_authority: "user_confirmed",
    ai_freshness: "current",
    ai_authority: "user_confirmed",
    ai_last_verified_at: "2026-08-05",
    ai_source_refs: [{ kind: "canonical_document", locator: "notes/measure.md", storage_root_id: "sync" }],
  }, { theme: { id: "theme-1", name: "材料A", default_ai_visibility: ["coding_agent"] } });
  assert.equal(header.summary, "条件Bの再測定");
  assert.equal(header.freshness, "current");
  assert.equal(header.authority, "user_confirmed");
  assert.deepEqual(header.ai_visibility, ["coding_agent"]);
  assert.equal(header.ai_visibility_source, "theme");
  assert.equal(header.source_refs[0].storage_root_id, "sync");
});

function workspaceFixture() {
  const stamp = "2026-08-06T00:00:00.000Z";
  return {
    themes: [
      { id: "theme-1", name: "材料A", default_ai_visibility: ["coding_agent"], updated_at: stamp },
      { id: "theme-2", name: "個人", default_ai_visibility: [], updated_at: stamp },
    ],
    tasks: [
      { id: "task-1", title: "公開してよい作業", state: "todo", project_id: "theme-1", updated_at: stamp },
      { id: "task-2", title: "個人的な作業", state: "todo", project_id: "theme-2", updated_at: stamp },
      { id: "task-3", title: "M365だけ許可", state: "todo", project_id: "theme-1", ai_visibility: ["m365"], updated_at: stamp },
    ],
    notes: [
      { id: "note-1", title: "共有メモ", body_markdown: "共有してよい", theme_id: "theme-1", updated_at: stamp },
      { id: "note-2", title: "個人メモ", body_markdown: "秘密の下書き", theme_id: "theme-2", updated_at: stamp },
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

test("MCPはvisibility違反の本文を返さず、除外理由を返す（#294）", () => {
  const context = new ReadOnlyTaskenContext("", { workspace: workspaceFixture(), audience: "coding_agent" });
  const items = context.toolListOpenItems({});
  const titles = items.items.map((item) => item.title);
  assert.deepEqual(titles, ["公開してよい作業"]);
  assert.equal(items.excluded_count, 2);
  assert.ok(items.excluded_reasons.length >= 1);

  const notes = context.toolGetRecentNotes({ include_raw_body: true });
  assert.deepEqual(notes.notes.map((note) => note.title), ["共有メモ"]);
  assert.equal(JSON.stringify(notes).includes("秘密の下書き"), false);
  assert.equal(notes.notes[0].ai.ai_visibility_source, "theme");
});

test("AI Packはm365許可分だけを使い、公開先ごとに結果が変わる（#294）", () => {
  const context = new ReadOnlyTaskenContext("", { workspace: workspaceFixture(), audience: "coding_agent" });

  const m365 = context.toolExportAiContext({ format: "json", audience: "m365" });
  assert.deepEqual(m365.items.map((item) => item.title), ["M365だけ許可"]);
  assert.equal(m365.ai_audience, "m365");
  assert.deepEqual(m365.notes, []);

  // 公開先を切り替えても、呼び出し後は元の公開先へ戻る。
  const codingAgent = context.toolExportAiContext({ format: "json" });
  assert.deepEqual(codingAgent.items.map((item) => item.title), ["公開してよい作業"]);
  assert.equal(codingAgent.ai_audience, "coding_agent");

  const markdown = context.toolExportAiContext({ audience: "m365" });
  assert.match(markdown, /公開先: m365/);
  assert.match(markdown, /AI公開範囲で除外した情報/);
  assert.equal(markdown.includes("秘密の下書き"), false);
});
