import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

// 棚卸しの画面を外す版の最初の起動で、Knowledge の節と線をテーマごとの Markdown に
// 一度だけ書き出す（#755 束8 の切る前の控え）。

async function loadExport() {
  const output = await build({
    entryPoints: ["src/main/services/knowledgeRetirementExport.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
}

const { runKnowledgeRetirementExportOnce, buildKnowledgeExport } = await loadExport();

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-knowledge-export-"));
  const userData = path.join(root, "userData");
  const syncRoot = path.join(root, "sync");
  fs.mkdirSync(userData, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  // WorkspaceDatabase と同じ形の手元の記録（list は削除済みを既定で除く。済んだ印は名前ごと）。
  // 印が DB に残ることは workspace-repository の試験で見る。
  const records = [];
  const marks = new Map();
  const database = {
    save: (type, entity) => records.push({ type, entity: { ...entity } }),
    remove(type, id) {
      const found = records.find((record) => record.type === type && record.entity.id === id);
      found.entity.deleted_at = "2026-11-01T00:00:00.000Z";
    },
    list: (type, includeDeleted = false) =>
      records
        .filter((record) => record.type === type)
        .map((record) => record.entity)
        .filter((entity) => includeDeleted || !entity.deleted_at),
    readRetiredExportMark: (name) => marks.get(name) ?? null,
    markRetiredExportDone: (name, at) => marks.set(name, at),
  };
  return {
    root,
    userData,
    syncRoot,
    database,
    userDataExports: path.join(userData, "Exports", "retired", "knowledge"),
    syncExports: path.join(syncRoot, "Exports", "retired", "knowledge"),
  };
}

function seed(database) {
  database.save("theme", { id: "theme-coating", name: "塗膜の密着" });
  database.save("theme", { id: "theme-sensor", name: "湿度センサー: 較正" });
  database.save("note", {
    id: "note-1",
    title: "密着試験の所見",
    body_markdown: "本文",
    theme_id: "theme-coating",
  });
  const node = (id, node_type, title, body, theme_id, extra = {}) =>
    database.save("knowledge_node", { id, node_type, title, body, theme_id, ...extra });
  node("kn-claim", "claim", "粗さで剥離が半減する", "3 回の試験で同じ傾向。", "theme-coating");
  node("kn-evidence", "evidence", "クロスカット試験の結果", "分類 3 → 分類 1", "theme-coating", {
    source_note_id: "note-1",
  });
  node("kn-sensor", "insight", "湿度 60% でずれる", "", "theme-sensor");
  node("kn-free", "source", "技術資料", "テーマなしの節。", null);
  node("kn-gone", "claim", "消した節", "出てはいけない本文", "theme-coating");
  database.save("knowledge_edge", {
    id: "ke-supports",
    source_node_id: "kn-evidence",
    target_node_id: "kn-claim",
    relation_type: "supports",
    description: "同じ板で | 3 回",
  });
  database.save("knowledge_edge", {
    id: "ke-cross",
    source_node_id: "kn-sensor",
    target_node_id: "kn-claim",
    relation_type: "similar_to",
  });
  // 消した節と線は書き出しに出ない。
  database.save("knowledge_edge", {
    id: "ke-gone",
    source_node_id: "kn-gone",
    target_node_id: "kn-claim",
    relation_type: "contradicts",
  });
  database.remove("knowledge_node", "kn-gone");
  database.remove("knowledge_edge", "ke-gone");
}

function run(context, overrides = {}) {
  const logs = [];
  const result = runKnowledgeRetirementExportOnce({
    repository: context.database,
    userDataDirectory: context.userData,
    syncRoot: context.syncRoot,
    log: (level, message) => logs.push({ level, message }),
    now: () => "2026-11-15T00:00:00.000Z",
    ...overrides,
  });
  return { result, logs };
}

const names = (directory) => (fs.existsSync(directory) ? fs.readdirSync(directory).sort() : []);

test("最初の起動で、節と線をテーマごとの Markdown にして、userData と同期ルートの両方へ書く", async (t) => {
  const context = await setup(t);
  seed(context.database);

  const { result, logs } = run(context);

  assert.equal(result.state, "done");
  assert.equal(result.documents, 3);
  const expected = [
    "Knowledge - テーマなし.md",
    "Knowledge - 塗膜の密着.md",
    "Knowledge - 湿度センサー- 較正.md",
  ];
  assert.deepEqual(names(context.userDataExports), expected);
  assert.deepEqual(names(context.syncExports), expected);

  const coating = fs.readFileSync(
    path.join(context.syncExports, "Knowledge - 塗膜の密着.md"),
    "utf8",
  );
  assert.equal(
    coating,
    fs.readFileSync(path.join(context.userDataExports, "Knowledge - 塗膜の密着.md"), "utf8"),
  );
  assert.match(coating, /^# Knowledge - 塗膜の密着\n/u);
  assert.match(coating, /- 節: 2 件\n- 線: 1 件\n/u);
  assert.match(coating, /## Claim\n\n### 粗さで剥離が半減する\n/u);
  assert.match(coating, /3 回の試験で同じ傾向。/u);
  assert.match(coating, /- 出どころ: ノート「密着試験の所見」（note-1）/u);
  assert.match(coating, /- Tasken の ID: kn-claim/u);
  // 節ごとの関係。向きと、別のテーマの相手にはテーマの名前が付く。
  assert.match(coating, /- → supports: 粗さで剥離が半減する（Claim） — 同じ板で \| 3 回/u);
  assert.match(coating, /- ← similar_to: 湿度 60% でずれる（Insight \/ 湿度センサー: 較正）/u);
  // 線の一覧は表。セルの中の縦棒は逃がす。
  assert.match(
    coating,
    /\| クロスカット試験の結果（Evidence） \| supports \| 粗さで剥離が半減する（Claim） \| 同じ板で \\\| 3 回 \| ke-supports \|/u,
  );
  // 消した節と線は出ない。書き出した時刻も入れない（同じ記録からは同じファイルになる）。
  assert.doesNotMatch(coating, /消した節|出てはいけない本文|ke-gone|contradicts/u);
  assert.doesNotMatch(coating, /2026-11-15T00:00/u);

  // 別のテーマにまたがる線は、元の節のテーマのファイルに入る。
  const sensor = fs.readFileSync(
    path.join(context.syncExports, "Knowledge - 湿度センサー- 較正.md"),
    "utf8",
  );
  assert.match(sensor, /- 節: 1 件\n- 線: 1 件\n/u);
  assert.match(sensor, /ke-cross/u);

  assert.equal(
    JSON.parse(context.database.readRetiredExportMark("knowledge")).at,
    "2026-11-15T00:00:00.000Z",
  );
  // ログには数だけを出す。題名・本文・場所は出さない。
  for (const { message } of logs) {
    assert.doesNotMatch(message, /粗さ|塗膜|技術資料/u);
    assert.equal(message.includes(context.root), false);
  }
  // 記録は消さない。
  assert.equal(context.database.list("knowledge_node").length, 4);
  assert.equal(context.database.list("knowledge_edge").length, 2);
});

test("0 件なら何も書かず、済んだ印も付けない", async (t) => {
  const context = await setup(t);
  context.database.save("theme", { id: "theme-coating", name: "塗膜の密着" });

  const { result, logs } = run(context);

  assert.deepEqual(result, { state: "nothing" });
  assert.equal(fs.existsSync(path.join(context.userData, "Exports")), false);
  assert.equal(fs.existsSync(context.syncRoot), false);
  assert.equal(context.database.readRetiredExportMark("knowledge"), null);
  assert.deepEqual(logs, []);

  // 後から節が届けば（同期の取り込みなど）、その時の起動で一度書き出す。
  context.database.save("knowledge_node", {
    id: "kn-late",
    node_type: "claim",
    title: "後から届いた節",
    theme_id: "theme-coating",
  });
  assert.equal(run(context).result.state, "done");
  assert.deepEqual(names(context.syncExports), ["Knowledge - 塗膜の密着.md"]);
});

test("二度目の起動では書き出さない（本人がファイルを消していても作り直さない）", async (t) => {
  const context = await setup(t);
  seed(context.database);
  assert.equal(run(context).result.state, "done");
  fs.rmSync(context.userDataExports, { recursive: true });
  fs.rmSync(context.syncExports, { recursive: true });

  const { result, logs } = run(context);

  assert.deepEqual(result, { state: "already_done" });
  assert.equal(fs.existsSync(context.userDataExports), false);
  assert.equal(fs.existsSync(context.syncExports), false);
  assert.deepEqual(logs, []);
});

test("書き出しに失敗しても例外にせず、次の起動でやり直す（書けた置き場は増えない）", async (t) => {
  const context = await setup(t);
  seed(context.database);
  // 同期ルートの Exports がファイルになっていて、フォルダーを作れない。
  fs.mkdirSync(context.syncRoot, { recursive: true });
  fs.writeFileSync(path.join(context.syncRoot, "Exports"), "not a directory");

  const first = run(context);

  assert.equal(first.result.state, "retry");
  assert.equal(names(context.userDataExports).length, 3);
  assert.equal(context.database.readRetiredExportMark("knowledge"), null);
  assert.equal(
    first.logs.some((entry) => entry.level === "warn"),
    true,
  );

  fs.rmSync(path.join(context.syncRoot, "Exports"));
  const second = run(context);

  assert.equal(second.result.state, "done");
  assert.equal(names(context.syncExports).length, 3);
  // userData の側は中身が同じなので、番号付きのファイルは増えない。
  assert.equal(names(context.userDataExports).length, 3);
  assert.equal(
    JSON.parse(context.database.readRetiredExportMark("knowledge")).at,
    "2026-11-15T00:00:00.000Z",
  );
});

test("同期ルートが無ければ userData だけに書く", async (t) => {
  const context = await setup(t);
  seed(context.database);

  const { result } = run(context, { syncRoot: "" });

  assert.equal(result.state, "done");
  assert.deepEqual(result.directories, [context.userDataExports]);
  assert.equal(names(context.userDataExports).length, 3);
  assert.equal(fs.existsSync(context.syncRoot), false);
});

test("既にある別の中身のファイルは上書きせず、番号を付ける", async (t) => {
  const context = await setup(t);
  seed(context.database);
  fs.mkdirSync(context.syncExports, { recursive: true });
  const existing = path.join(context.syncExports, "Knowledge - 塗膜の密着.md");
  fs.writeFileSync(existing, "本人が書いたファイル");

  assert.equal(run(context).result.state, "done");

  assert.equal(fs.readFileSync(existing, "utf8"), "本人が書いたファイル");
  assert.match(
    fs.readFileSync(path.join(context.syncExports, "Knowledge - 塗膜の密着 (2).md"), "utf8"),
    /^# Knowledge - 塗膜の密着\n/u,
  );
});

test("同じ名前のテーマが 2 つあっても、テーマごとに別のファイルにする", () => {
  const records = {
    theme: [
      { id: "theme-a", name: "同じ名前" },
      { id: "theme-b", name: "同じ名前" },
    ],
    project: [],
    note: [],
    knowledge_node: [
      { id: "kn-a", node_type: "claim", title: "A", theme_id: "theme-a" },
      { id: "kn-b", node_type: "claim", title: "B", theme_id: "theme-b" },
    ],
    knowledge_edge: [],
  };
  const documents = buildKnowledgeExport({ list: (type) => records[type] });
  assert.deepEqual(
    documents.map((document) => [document.themeId, document.baseName]),
    [
      ["theme-a", "Knowledge - 同じ名前"],
      ["theme-b", "Knowledge - 同じ名前 [2]"],
    ],
  );
});

// レビューの指摘（#755 束8）: 節の AI・情報状態の欄と、節⇄Task・ノートの関係も控えに残す。
test("節の AI 向けの欄・出典・置き換え先と、節を端に持つ記録どうしの関係も書き出す", async (t) => {
  const context = await setup(t);
  const { database } = context;
  database.save("theme", { id: "theme-coating", name: "塗膜の密着" });
  database.save("task", { id: "task-1", title: "下地を 3 水準で比べる" });
  database.save("note", { id: "note-live", title: "生きているノート" });
  database.save("note", { id: "note-gone", title: "消したノートの題名" });
  database.remove("note", "note-gone");
  database.save("knowledge_node", {
    id: "kn-new",
    node_type: "claim",
    title: "新しい主張",
    theme_id: "theme-coating",
  });
  database.save("knowledge_node", {
    id: "kn-old",
    node_type: "claim",
    title: "古い主張",
    theme_id: "theme-coating",
    source_note_id: "note-gone",
    ai_summary: "粗さで\n剥離が減る",
    ai_freshness: "superseded",
    ai_authority: "user_confirmed",
    ai_last_verified_at: "2026-10-01T09:00:00.000Z",
    ai_superseded_by: { type: "knowledge_node", id: "kn-new" },
    ai_source_refs: [
      { kind: "url", locator: "https://example.com/paper", title: "論文" },
      { kind: "file", locator: "Data/run-1.csv" },
    ],
  });
  database.save("knowledge_node", {
    id: "kn-task",
    node_type: "question",
    title: "Task に置き換わった問い",
    theme_id: "theme-coating",
    ai_superseded_by: { type: "task", id: "task-1" },
  });
  // 節⇄Task・ノートの関係（reference）。削除した関係は出さない。
  database.save("reference", {
    id: "ref-task",
    source_type: "knowledge_node",
    source_id: "kn-old",
    target_type: "task",
    target_id: "task-1",
    relation_type: "links_to",
  });
  database.save("reference", {
    id: "ref-note",
    source_type: "note",
    source_id: "note-live",
    target_type: "knowledge_node",
    target_id: "kn-old",
    relation_type: "derived_from",
  });
  database.save("reference", {
    id: "ref-gone-note",
    source_type: "note",
    source_id: "note-gone",
    target_type: "knowledge_node",
    target_id: "kn-old",
    relation_type: "links_to",
  });
  database.save("reference", {
    id: "ref-deleted",
    source_type: "knowledge_node",
    source_id: "kn-old",
    target_type: "task",
    target_id: "task-1",
    relation_type: "blocks",
  });
  database.remove("reference", "ref-deleted");

  assert.equal(run(context, { syncRoot: "" }).result.state, "done");
  const markdown = fs.readFileSync(
    path.join(context.userDataExports, "Knowledge - 塗膜の密着.md"),
    "utf8",
  );
  const start = markdown.indexOf("### 古い主張");
  assert.ok(start >= 0);
  const next = markdown.indexOf("\n#", start + 1);
  const old = markdown.slice(start, next < 0 ? undefined : next + 1);
  assert.match(old, /- AI 向け概要: 粗さで 剥離が減る\n/u);
  assert.match(old, /- 鮮度: 置き換え済み\n/u);
  assert.match(old, /- 根拠: ユーザー確認済み\n/u);
  assert.match(old, /- 最後に確かめた日: 2026-10-01\n/u);
  assert.match(old, /- 置き換え先: 新しい主張（Claim）\n/u);
  assert.match(
    old,
    /出典:\n\n- URL: 論文 — https:\/\/example\.com\/paper\n- ファイル: Data\/run-1\.csv\n/u,
  );
  assert.match(old, /ほかの記録との関係:\n/u);
  assert.match(old, /- → links_to: Task「下地を 3 水準で比べる」（task-1）\n/u);
  assert.match(old, /- ← derived_from: ノート「生きているノート」（note-live）\n/u);
  // 削除したノートは、出どころでも関係でも題名を出さない。
  assert.match(old, /- 出どころ: 削除したノート（note-gone）\n/u);
  assert.match(old, /- ← links_to: 削除したノート（note-gone）\n/u);
  assert.doesNotMatch(markdown, /消したノートの題名/u);
  assert.doesNotMatch(markdown, /blocks/u);
  // 置き換え先が Task の時は、Task の題名で書く。
  assert.match(markdown, /- 置き換え先: Task「下地を 3 水準で比べる」（task-1）\n/u);
});

test("印の後に節が届いたり直されたりしたら、次の起動で書き出し直す（変わらないテーマは増えない）", async (t) => {
  const context = await setup(t);
  const { database } = context;
  database.save("theme", { id: "theme-a", name: "テーマA" });
  database.save("theme", { id: "theme-b", name: "テーマB" });
  database.save("knowledge_node", {
    id: "kn-a",
    node_type: "claim",
    title: "Aの主張",
    theme_id: "theme-a",
    updated_at: "2026-11-10T00:00:00.000Z",
  });
  database.save("knowledge_node", {
    id: "kn-b",
    node_type: "claim",
    title: "Bの主張",
    theme_id: "theme-b",
    updated_at: "2026-11-10T00:00:00.000Z",
  });
  assert.equal(run(context).result.state, "done");
  assert.deepEqual(names(context.syncExports), [
    "Knowledge - テーマA.md",
    "Knowledge - テーマB.md",
  ]);
  assert.deepEqual(run(context).result, { state: "already_done" });

  // 同期で届いた節（件数が変わる）。
  database.save("knowledge_node", {
    id: "kn-a2",
    node_type: "evidence",
    title: "あとから届いた根拠",
    theme_id: "theme-a",
    updated_at: "2026-11-09T00:00:00.000Z",
  });
  assert.equal(run(context).result.state, "done");
  for (const directory of [context.userDataExports, context.syncExports])
    assert.deepEqual(names(directory), [
      "Knowledge - テーマA (2).md",
      "Knowledge - テーマA.md",
      "Knowledge - テーマB.md",
    ]);
  assert.match(
    fs.readFileSync(path.join(context.syncExports, "Knowledge - テーマA (2).md"), "utf8"),
    /あとから届いた根拠/u,
  );
  assert.deepEqual(run(context).result, { state: "already_done" });

  // 別の端末での編集（件数は同じで、更新の時刻が進む）。
  Object.assign(
    database.list("knowledge_node").find((node) => node.id === "kn-b"),
    { title: "Bの主張（直した）", updated_at: "2026-11-12T00:00:00.000Z" },
  );
  assert.equal(run(context).result.state, "done");
  assert.deepEqual(names(context.syncExports), [
    "Knowledge - テーマA (2).md",
    "Knowledge - テーマA.md",
    "Knowledge - テーマB (2).md",
    "Knowledge - テーマB.md",
  ]);
  assert.match(
    fs.readFileSync(path.join(context.syncExports, "Knowledge - テーマB (2).md"), "utf8"),
    /Bの主張（直した）/u,
  );
  assert.deepEqual(run(context).result, { state: "already_done" });
});
