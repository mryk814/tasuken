import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

// やることの画面の保存した絞り込みを外す版（#755 束6）の起動で、名前と条件を 1 つの Markdown に
// 書き出す（束8 の Knowledge・束4 の文字起こしの書き出しと同じ置き場の形と印）。

async function loadExport() {
  const output = await build({
    entryPoints: ["src/main/services/savedViewRetirementExport.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
}

const { runSavedViewRetirementExportOnce, buildSavedViewExport } = await loadExport();

const EXPORT_FILE = "保存した絞り込み.md";

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-saved-view-export-"));
  const userData = path.join(root, "userData");
  const syncRoot = path.join(root, "sync");
  fs.mkdirSync(userData, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const records = [];
  const marks = new Map();
  const database = {
    save: (type, entity) => records.push({ type, entity: { ...entity } }),
    find: (type, id) =>
      records.find((entry) => entry.type === type && entry.entity.id === id)?.entity,
    list: (type, includeDeleted = false) =>
      records
        .filter((entry) => entry.type === type)
        .map((entry) => entry.entity)
        .filter((entity) => includeDeleted || !entity.deleted_at),
    readRetiredExportMark: (name) => marks.get(name) ?? null,
    markRetiredExportDone: (name, value) => marks.set(name, value),
  };
  return {
    root,
    userData,
    syncRoot,
    database,
    userDataExports: path.join(userData, "Exports", "retired", "views"),
    syncExports: path.join(syncRoot, "Exports", "retired", "views"),
  };
}

function savedView(id, title, filters, overrides = {}) {
  return {
    id,
    title,
    view_type: "task",
    filters,
    sort_order: 0,
    created_at: "2026-07-05T10:00:00.000Z",
    updated_at: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function seed(database) {
  database.save("theme", { id: "theme-1", name: "実験の段取り", created_at: "2026-06-01" });
  database.save("theme", {
    id: "theme-gone",
    name: "消したテーマの名前",
    created_at: "2026-06-01",
    deleted_at: "2026-07-01T00:00:00.000Z",
  });
  database.save(
    "view",
    savedView(
      "view-2",
      "今週の実験",
      {
        tab: "open",
        themeId: "theme-1",
        state: "doing",
        priority: "high",
        schedule: "this-week",
        rangeSemantics: "execution_window",
      },
      { sort_order: 1, updated_at: "2026-07-06T09:00:00.000Z" },
    ),
  );
  database.save(
    "view",
    savedView("view-1", "今日の高優先度", {
      tab: "today",
      themeId: "all",
      state: "",
      priority: "high",
      schedule: "",
      rangeSemantics: "",
    }),
  );
  database.save(
    "view",
    savedView(
      "view-3",
      "消したテーマの残り",
      { tab: "done", themeId: "theme-gone" },
      {
        sort_order: 2,
      },
    ),
  );
  database.save(
    "view",
    savedView(
      "view-deleted",
      "消した絞り込み",
      { tab: "open" },
      {
        sort_order: 3,
        deleted_at: "2026-07-07T00:00:00.000Z",
      },
    ),
  );
  // 同じ view の種類の、絞り込みではない物（Theme の区分とリマインダーの設定）は書かない。
  database.save("view", {
    id: "section-1",
    title: "区分の名前",
    view_type: "task_section",
    theme_id: "theme-1",
    created_at: "2026-07-05T10:00:00.000Z",
  });
  database.save("view", {
    id: "daily-reminder-settings",
    title: "Daily reminder settings",
    view_type: "daily_reminder_settings",
    enabled: true,
    activity_log_time: "18:00",
  });
}

function run(context, overrides = {}) {
  const logs = [];
  const result = runSavedViewRetirementExportOnce({
    repository: context.database,
    userDataDirectory: context.userData,
    syncRoot: context.syncRoot,
    log: (level, message) => logs.push({ level, message }),
    now: () => "2026-11-16T00:00:00.000Z",
    ...overrides,
  });
  return { result, logs };
}

function names(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

test("保存した絞り込みの名前と条件を 1 つの Markdown にして、userData と同期ルートの両方へ書く", async (t) => {
  const context = await setup(t);
  seed(context.database);

  const { result, logs } = run(context);

  assert.equal(result.state, "done");
  assert.equal(result.documents, 1);
  assert.deepEqual(names(context.userDataExports), [EXPORT_FILE]);
  assert.deepEqual(names(context.syncExports), [EXPORT_FILE]);
  const markdown = fs.readFileSync(path.join(context.userDataExports, EXPORT_FILE), "utf8");
  assert.equal(fs.readFileSync(path.join(context.syncExports, EXPORT_FILE), "utf8"), markdown);
  assert.match(markdown, /^# 保存した絞り込み\n/u);
  assert.match(markdown, /- 件数: 3 件/u);
  // 並びは保存した時の順。
  assert.ok(markdown.indexOf("## 今日の高優先度") < markdown.indexOf("## 今週の実験"));
  assert.ok(markdown.indexOf("## 今週の実験") < markdown.indexOf("## 消したテーマの残り"));
  // 条件は画面の語で書き、元の形も残す。
  assert.match(
    markdown,
    /## 今週の実験\n\n- タブ: 未完了\n- Theme: 実験の段取り（theme-1）\n- 状態: 進行中\n- 優先度: 優先\n- 予定: 今週中\n- 期間の意味: 期間内に一度\n/u,
  );
  assert.match(
    markdown,
    /## 今日の高優先度\n\n- タブ: 今日\n- Theme: すべての Theme\n- 状態: 指定なし/u,
  );
  assert.match(markdown, /"schedule": "this-week"/u);
  assert.match(markdown, /- Tasken の ID: view-2/u);
  // 削除した Theme は名前を書かない。削除した絞り込みと、絞り込みでない view は書かない。
  assert.match(markdown, /- Theme: 削除した Theme（theme-gone）/u);
  assert.doesNotMatch(markdown, /消したテーマの名前|消した絞り込み|区分の名前|reminder/u);
  // 書き出した時刻は中身に入れない。
  assert.doesNotMatch(markdown, /2026-11-16/u);
  // ログは数だけ。名前も条件も出さない。
  assert.doesNotMatch(JSON.stringify(logs), /高優先度|実験|this-week/u);
  assert.deepEqual(JSON.parse(context.database.readRetiredExportMark("views")), {
    at: "2026-11-16T00:00:00.000Z",
    count: 3,
    latest: "2026-07-07T00:00:00.000Z",
  });
});

test("0 件なら何も書かず、済んだ印も付けない（Theme の区分とリマインダーの設定だけの時も）", async (t) => {
  const context = await setup(t);
  context.database.save("view", {
    id: "section-1",
    title: "区分",
    view_type: "task_section",
    theme_id: "theme-1",
  });
  context.database.save(
    "view",
    savedView(
      "view-deleted",
      "消した絞り込み",
      { tab: "open" },
      {
        deleted_at: "2026-07-07T00:00:00.000Z",
      },
    ),
  );

  assert.deepEqual(run(context).result, { state: "nothing" });
  assert.equal(fs.existsSync(context.userDataExports), false);
  assert.equal(context.database.readRetiredExportMark("views"), null);
});

test("二度目の起動では書き出さない（本人がファイルを消していても作り直さない）", async (t) => {
  const context = await setup(t);
  seed(context.database);
  assert.equal(run(context).result.state, "done");
  fs.rmSync(context.userDataExports, { recursive: true });

  const { result, logs } = run(context);

  assert.deepEqual(result, { state: "already_done" });
  assert.equal(fs.existsSync(context.userDataExports), false);
  assert.deepEqual(logs, []);
});

test("書き出しに失敗しても例外にせず、次の起動でやり直す（書けた置き場は増えない）", async (t) => {
  const context = await setup(t);
  seed(context.database);
  fs.mkdirSync(context.syncRoot, { recursive: true });
  fs.writeFileSync(path.join(context.syncRoot, "Exports"), "not a directory");

  const first = run(context);

  assert.equal(first.result.state, "retry");
  assert.deepEqual(names(context.userDataExports), [EXPORT_FILE]);
  assert.equal(context.database.readRetiredExportMark("views"), null);
  assert.equal(
    first.logs.some((entry) => entry.level === "warn"),
    true,
  );

  fs.rmSync(path.join(context.syncRoot, "Exports"));
  const second = run(context);

  assert.equal(second.result.state, "done");
  assert.deepEqual(names(context.syncExports), [EXPORT_FILE]);
  assert.deepEqual(names(context.userDataExports), [EXPORT_FILE]);
});

test("同期ルートが無ければ userData だけに書く。既にある別の中身は上書きせず番号を付ける", async (t) => {
  const context = await setup(t);
  seed(context.database);
  fs.mkdirSync(context.userDataExports, { recursive: true });
  const taken = path.join(context.userDataExports, EXPORT_FILE);
  fs.writeFileSync(taken, "本人が書き換えた控え");

  const { result } = run(context, { syncRoot: "" });

  assert.equal(result.state, "done");
  assert.deepEqual(result.directories, [context.userDataExports]);
  assert.equal(fs.readFileSync(taken, "utf8"), "本人が書き換えた控え");
  assert.deepEqual(names(context.userDataExports), ["保存した絞り込み (2).md", EXPORT_FILE]);
  assert.equal(fs.existsSync(context.syncRoot), false);
});

test("印の後に絞り込みが同期で届いたら、次の起動で書き出し直す（前の控えは上書きしない）", async (t) => {
  const context = await setup(t);
  seed(context.database);
  assert.equal(run(context).result.state, "done");

  context.database.save(
    "view",
    savedView(
      "view-4",
      "別の端末で保存した絞り込み",
      { tab: "overdue" },
      {
        sort_order: 4,
        created_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z",
      },
    ),
  );

  const { result } = run(context);

  assert.equal(result.state, "done");
  assert.deepEqual(names(context.userDataExports), ["保存した絞り込み (2).md", EXPORT_FILE]);
  const latest = fs.readFileSync(
    path.join(context.userDataExports, "保存した絞り込み (2).md"),
    "utf8",
  );
  assert.match(latest, /- 件数: 4 件/u);
  assert.match(latest, /## 別の端末で保存した絞り込み\n\n- タブ: 予定超過/u);
  assert.equal(JSON.parse(context.database.readRetiredExportMark("views")).count, 4);
});

test("知らない値や崩れた条件も落とさずに書く", () => {
  const records = [
    savedView("view-odd", "", { tab: "someday", priority: "urgent", extra: { nested: true } }),
    { id: "view-scope", scope: "task", title: "古い形の絞り込み", created_at: "2026-07-01" },
  ];
  const [document] = buildSavedViewExport({
    list: (type) => (type === "view" ? records : []),
  });

  assert.equal(document.viewCount, 2);
  assert.match(
    document.markdown,
    /## 名前の無い絞り込み\n\n- タブ: someday（この版の画面に無い値）/u,
  );
  assert.match(document.markdown, /- 優先度: urgent（この版の画面に無い値）/u);
  assert.match(document.markdown, /"nested": true/u);
  assert.match(
    document.markdown,
    /## 古い形の絞り込み\n\n- タブ: 未完了（既定）\n- Theme: すべての Theme/u,
  );
});

test("前の版の DB に保存した絞り込みを書き出し、印は DB に残る（Task の時刻の値も消えない）", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-saved-view-sqlite-"));
  const databasePath = path.join(root, "workspace.sqlite");
  const userData = path.join(root, "userData");
  const exports = path.join(userData, "Exports", "retired", "views");
  const first = new WorkspaceDatabase(databasePath);
  first.save("view", {
    id: "view-1",
    title: "今日の高優先度",
    view_type: "task",
    filters: { tab: "today", themeId: "all", priority: "high" },
    sort_order: 0,
  });
  // 束6 で時間割の欄を外しても、Task が持つ値はデータとして残る。
  first.save("task", {
    id: "task-1",
    title: "測定",
    state: "todo",
    priority: "normal",
    planned_start_time: "09:30",
    planned_duration_minutes: 90,
  });

  const result = runSavedViewRetirementExportOnce({
    repository: first,
    userDataDirectory: userData,
    now: () => "2026-11-16T00:00:00.000Z",
  });
  assert.equal(result.state, "done");
  assert.deepEqual(names(exports), [EXPORT_FILE]);
  assert.match(fs.readFileSync(path.join(exports, EXPORT_FILE), "utf8"), /## 今日の高優先度/u);
  first.db.close();

  const reopened = new WorkspaceDatabase(databasePath);
  t.after(() => {
    reopened.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal(JSON.parse(reopened.readRetiredExportMark("views")).count, 1);
  assert.deepEqual(
    runSavedViewRetirementExportOnce({ repository: reopened, userDataDirectory: userData }),
    { state: "already_done" },
  );
  // 書き出しは記録を消さない。
  assert.equal(reopened.list("view").length, 1);
  const task = reopened.get("task", "task-1");
  assert.equal(task.planned_start_time, "09:30");
  assert.equal(task.planned_duration_minutes, 90);
});
