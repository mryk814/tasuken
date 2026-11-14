import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

// 手入れの画面を外す前に、記録を 1 件ずつ Markdown に書き出せるようにする（#755 束9b）。

async function loadExport() {
  const output = await build({
    entryPoints: ["src/main/services/maintenanceExport.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
}

async function withDatabase(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-maintenance-export-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // WorkspaceDatabase.list と同じ形（種類ごとの配列）。削除済みも混ぜ、書き出しの側で除くことを見る。
  const records = [];
  const database = {
    save: (type, entity) => records.push({ type, entity }),
    list: (type) => records.filter((record) => record.type === type).map((record) => record.entity),
  };
  return { directory, database };
}

function seed(database) {
  database.save("theme", { id: "theme-lab", name: "実験室" });
  database.save("maintenance", {
    id: "maintenance-filter",
    title: "エアコン / フィルターを掃除する",
    target: "エアコン",
    action: "フィルターを掃除する",
    interval_days: 30,
    next_due_on: "2026-11-30",
    last_performed_on: "2026-10-31",
    note: "脚立を使う。\n高い所は二人で。",
    project_id: "theme-lab",
  });
  database.save("maintenance_entry", {
    id: "maintenance-entry:maintenance-filter:2026-09-30",
    maintenance_id: "maintenance-filter",
    performed_on: "2026-09-30",
    next_due_on: "2026-10-30",
    recorded_at: "2026-09-30T09:00:00.000Z",
  });
  database.save("maintenance_entry", {
    id: "maintenance-entry:maintenance-filter:2026-10-31",
    maintenance_id: "maintenance-filter",
    performed_on: "2026-10-31",
    next_due_on: "2026-11-30",
    note: "汚れ|多め",
    recorded_at: "2026-10-31T09:00:00.000Z",
  });
  database.save("maintenance_entry", {
    id: "maintenance-entry:maintenance-filter:2026-08-31",
    maintenance_id: "maintenance-filter",
    performed_on: "2026-08-31",
    recorded_at: "2026-08-31T09:00:00.000Z",
    deleted_at: "2026-09-01T00:00:00.000Z",
  });
  database.save("maintenance", {
    id: "maintenance-ph",
    title: "pH計 / 校正",
    target: "pH計",
    action: "校正",
  });
  database.save("maintenance", {
    id: "maintenance-gone",
    title: "古い棚 / 整理",
    target: "古い棚",
    action: "整理",
    deleted_at: "2026-09-01T00:00:00.000Z",
  });
}

test("削除していない手入れを 1 件ずつ、記録と一緒に読める Markdown にする", async (t) => {
  const { buildMaintenanceExport } = await loadExport();
  const { database } = await withDatabase(t);
  seed(database);

  const documents = buildMaintenanceExport({ list: (type) => database.list(type) });
  assert.deepEqual(
    documents.map((document) => [document.id, document.baseName]),
    [
      ["maintenance-ph", "手入れ - pH計 - 校正"],
      ["maintenance-filter", "手入れ - エアコン - フィルターを掃除する"],
    ],
  );
  const filter = documents.find((document) => document.id === "maintenance-filter").markdown;
  assert.match(filter, /^# エアコン \/ フィルターを掃除する\n/u);
  for (const line of [
    "- 間隔: 30日ごと",
    "- 次の目安: 2026-11-30",
    "- 最後に行った日: 2026-10-31",
    "- Theme: 実験室",
    "- Tasken の ID: maintenance-filter",
    "## メモ\n\n脚立を使う。\n高い所は二人で。",
    // 新しい記録から並べ、表の区切りの文字は崩さない。
    "| 2026-10-31 | 2026-11-30 | 汚れ\\|多め |\n| 2026-09-30 | 2026-10-30 | — |",
  ])
    assert.ok(filter.includes(line), line);
  assert.doesNotMatch(filter, /2026-08-31/u, "消した記録は書かない");
  const ph = documents.find((document) => document.id === "maintenance-ph").markdown;
  assert.match(ph, /## 行った記録\n\n記録はありません。\n$/u);
  assert.doesNotMatch(ph, /## メモ|Theme:/u);
});

test("書き出しは既にあるファイルを上書きせず、番号を付けて書く", async (t) => {
  const { buildMaintenanceExport, writeMaintenanceMarkdownFiles } = await loadExport();
  const { directory, database } = await withDatabase(t);
  seed(database);
  const target = path.join(directory, "Exports");
  fs.mkdirSync(target);
  const existing = path.join(target, "手入れ - pH計 - 校正.md");
  fs.writeFileSync(existing, "本人が前に書いたメモ");

  const documents = buildMaintenanceExport({ list: (type) => database.list(type) });
  const first = writeMaintenanceMarkdownFiles(target, documents);
  assert.deepEqual(
    first.map((filePath) => path.basename(filePath)),
    ["手入れ - pH計 - 校正 (2).md", "手入れ - エアコン - フィルターを掃除する.md"],
  );
  assert.equal(fs.readFileSync(existing, "utf8"), "本人が前に書いたメモ");

  // もう一度書き出しても、前に書いた物は残り、新しい番号で書く。
  const second = writeMaintenanceMarkdownFiles(target, documents);
  assert.deepEqual(
    second.map((filePath) => path.basename(filePath)),
    ["手入れ - pH計 - 校正 (3).md", "手入れ - エアコン - フィルターを掃除する (2).md"],
  );
  for (const filePath of [...first, ...second])
    assert.match(fs.readFileSync(filePath, "utf8"), /^# /u);
  assert.equal(fs.readdirSync(target).length, 5);
});

test("ファイル名に使えない文字は置き換え、書けない時は書いた所までを残して止まる", async () => {
  const { maintenanceFileBaseName, writeMaintenanceMarkdownFiles } = await loadExport();
  assert.equal(
    maintenanceFileBaseName({ target: 'A/B:C*"D"', action: "<x>|?. " }),
    "手入れ - A-B-C-D- - -x-",
  );
  assert.equal(maintenanceFileBaseName({}), "手入れ - 手入れ");
  const written = [];
  assert.throws(
    () =>
      writeMaintenanceMarkdownFiles(
        "C:/nowhere",
        [
          { id: "a", baseName: "a", markdown: "# a\n" },
          { id: "b", baseName: "b", markdown: "# b\n" },
        ],
        {
          writeFileSync: (filePath, body, options) => {
            assert.equal(options.flag, "wx");
            if (written.length) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
            written.push(filePath);
          },
        },
      ),
    /disk full/u,
  );
  assert.equal(written.length, 1);
});
