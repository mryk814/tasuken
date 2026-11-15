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
  assert.match(coating, /- 出どころ: Note「密着試験の所見」（note-1）/u);
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

  assert.equal(context.database.readRetiredExportMark("knowledge"), "2026-11-15T00:00:00.000Z");
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
  assert.equal(context.database.readRetiredExportMark("knowledge"), "2026-11-15T00:00:00.000Z");
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
