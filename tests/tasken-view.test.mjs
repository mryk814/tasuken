import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TASKEN_VIEW_LEDGER_FILE,
  buildTaskenViewDocxFiles,
  buildTaskenViewFiles,
  taskenViewDocxFromMarkdown,
  taskenViewHtmlToText,
} from "../src/shared/taskenView.mjs";
import { TaskenViewService, readTaskenViewLedger } from "../src/main/services/taskenView.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

// 試験では時計を固定する（設計 3.3）。2026-11-20（金）09:00 +09:00。
const NOW = new Date("2026-11-20T09:00:00+09:00");
const DOCUMENT_HTML =
  "<h1>見出し</h1><p>本文<strong>太字</strong></p><ul><li>項目1</li><li>項目2</li></ul><script>evil()</script>";

function pin(database, id, createdAt, updatedAt) {
  database.db
    .prepare("UPDATE entities SET created_at = ?, updated_at = ? WHERE id = ?")
    .run(createdAt, updatedAt, id);
}

function seed(database) {
  database.save("theme", {
    id: "theme-exp",
    name: "触媒の条件出し",
    code: "EXP-A",
    description: "概要テキスト",
  });
  pin(database, "theme-exp", "2026-11-01T00:00:00.000Z", "2026-11-18T01:00:00.000Z");
  database.save("task", {
    id: "task-parent1",
    title: "温度条件の再測定",
    state: "doing",
    project_id: "theme-exp",
    description: "本文の Markdown はそのまま。",
    planned_start_time: "10:00",
    planned_duration_minutes: 120,
    today_date: "2026-11-24",
    reminder_at: "2026-11-24T09:30:00+09:00",
    checklist_items: [
      { id: "cl-1", title: "試薬の手配", done: true, sort_order: 0 },
      { id: "cl-2", title: "測定", done: false, sort_order: 1 },
    ],
  });
  pin(database, "task-parent1", "2026-11-10T00:00:00.000Z", "2026-11-19T01:00:00.000Z");
  database.save("schedule", {
    id: "sch-1",
    owner_type: "task",
    owner_id: "task-parent1",
    start_date: "2026-11-24",
    end_date: "2026-11-25",
    date_kind: "range",
    range_semantics: "ongoing",
    confidence: "fixed",
    granularity: "day",
  });
  pin(database, "sch-1", "2026-11-10T00:00:00.000Z", "2026-11-18T00:00:00.000Z");
  database.save("task", {
    id: "task-child1",
    title: "子タスク",
    state: "todo",
    project_id: "theme-exp",
    parent_task_id: "task-parent1",
  });
  pin(database, "task-child1", "2026-11-11T00:00:00.000Z", "2026-11-11T00:00:00.000Z");
  database.save("task", {
    id: "task-overdue",
    title: "期限切れの件",
    state: "todo",
    project_id: "theme-exp",
  });
  pin(database, "task-overdue", "2026-11-09T00:00:00.000Z", "2026-11-09T00:00:00.000Z");
  database.save("schedule", {
    id: "sch-2",
    owner_type: "task",
    owner_id: "task-overdue",
    start_date: null,
    end_date: "2026-11-19",
    date_kind: "deadline",
    range_semantics: null,
    confidence: "fixed",
    granularity: "day",
  });
  pin(database, "sch-2", "2026-11-09T00:00:00.000Z", "2026-11-09T00:00:00.000Z");
  database.save("task", {
    id: "task-done1",
    title: "終わった件",
    state: "done",
    project_id: "theme-exp",
    completed_at: "2026-11-15T12:00:00+09:00",
  });
  pin(database, "task-done1", "2026-11-05T00:00:00.000Z", "2026-11-15T03:00:00.000Z");
  database.save("task", {
    id: "task-old1",
    title: "去年終わった件",
    state: "done",
    project_id: "theme-exp",
    completed_at: "2025-06-01T12:00:00+09:00",
  });
  pin(database, "task-old1", "2025-05-01T00:00:00.000Z", "2025-06-01T03:00:00.000Z");
  database.save("note", {
    id: "note-plain1",
    title: "読書メモ",
    body_markdown: "最初の段落",
    project_id: "theme-exp",
  });
  pin(database, "note-plain1", "2026-11-12T00:00:00.000Z", "2026-11-17T01:00:00.000Z");
  database.save("note", {
    id: "note-canon1",
    title: "正本ノート",
    body_markdown: "写さない本文",
    project_id: "theme-exp",
    properties: {
      canonical_markdown: {
        canonical_path: "/data/Tasken/Themes/EXP-A/Notes/正本.md",
        file_name: "正本.md",
      },
    },
  });
  pin(database, "note-canon1", "2026-11-12T00:00:00.000Z", "2026-11-16T01:00:00.000Z");
  database.save("document", {
    id: "document-1",
    title: "報告書",
    filename: "report-abc.html",
    task_id: "task-parent1",
    theme_id: "theme-exp",
  });
  pin(database, "document-1", "2026-11-13T00:00:00.000Z", "2026-11-18T02:00:00.000Z");
  database.save("task", { id: "task-inbox1", title: "個人の件", state: "todo" });
  pin(database, "task-inbox1", "2026-11-14T00:00:00.000Z", "2026-11-14T00:00:00.000Z");
}

function setup(t, { writer = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-view-test-"));
  const database = new WorkspaceDatabase(path.join(base, "tasken.sqlite"));
  t.after(() => {
    if (database.db.open) database.db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });
  const root = path.join(base, "Tasken");
  fs.mkdirSync(root, { recursive: true });
  database.setPreference("artifactDirectory", root);
  if (writer) database.setPreference("taskenViewWriter", true);
  seed(database);
  const service = new TaskenViewService({
    repository: database,
    readDocumentHtml: (document) =>
      document.filename === "report-abc.html" ? DOCUMENT_HTML : null,
    now: () => new Date(NOW.getTime()),
    env: {},
  });
  return { base, database, root, service, viewDirectory: path.join(root, "View") };
}

function readTree(directory) {
  const result = new Map();
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else if (entry.isFile())
        result.set(relative, fs.readFileSync(path.join(current, entry.name), "utf8"));
    }
  };
  walk(directory, "");
  return result;
}

test("決定性: 同じ DB と同じ時計から 2 回作って 1 バイトも変わらない", (t) => {
  const { service, viewDirectory } = setup(t);
  const first = service.generateNow("test");
  assert.equal(first.status, "written");
  const tree1 = readTree(viewDirectory);
  assert.ok(tree1.size >= 8, `ファイルが揃っている: ${[...tree1.keys()].join(", ")}`);
  const second = service.generateNow("test");
  assert.equal(second.status, "unchanged");
  assert.deepEqual(second.written, []);
  assert.deepEqual(readTree(viewDirectory), tree1);
  // 全部消しても同じものが作り直せる（台帳の generatedAt も固定時計では同じ）。
  fs.rmSync(viewDirectory, { recursive: true, force: true });
  const third = service.generateNow("test");
  assert.equal(third.status, "written");
  assert.deepEqual(readTree(viewDirectory), tree1);
});

test("中身の形: front matter・並び・期日と予定と知らせ・親子・チェックリスト", (t) => {
  const { service, viewDirectory } = setup(t);
  service.generateNow("test");
  const theme = fs.readFileSync(path.join(viewDirectory, "themes", "EXP-A.md"), "utf8");
  assert.match(
    theme,
    /^---\ntasken_view: 1\nkind: theme\ntheme_id: theme-exp\ntheme_code: EXP-A\n/,
  );
  // updated は含めた記録の最大（task-parent1 の 2026-11-19T01:00Z = +09:00 で 10:00）。
  assert.match(theme, /updated: 2026-11-19T10:00:00\+09:00/);
  assert.match(theme, /未完了 3 件（期限切れ 1）・最近 30 日の完了 1 件/);
  assert.match(
    theme,
    /- 状態: 進行中 ／ 期日: 2026-11-25 ／ 予定: 2026-11-24 10:00–12:00 ／ 知らせ: 2026-11-24 09:30/,
  );
  assert.match(theme, /- \[x\] 試薬の手配\n- \[ \] 測定/);
  assert.match(theme, /### 温度条件の再測定[\s\S]*#### 子タスク/);
  assert.ok(theme.endsWith("\n") && !theme.endsWith("\n\n"), "末尾の改行は 1 つ");
  assert.ok(!theme.includes("\r"), "改行は LF");

  const index = fs.readFileSync(path.join(viewDirectory, "index.md"), "utf8");
  assert.match(index, /2026-11-19 10:00 時点の Tasken の内容/);
  assert.match(index, /\[EXP-A 触媒の条件出し\]\(themes\/EXP-A\.md\) — 未完了 3 件（期限切れ 1）/);

  const now = fs.readFileSync(path.join(viewDirectory, "now.md"), "utf8");
  assert.match(
    now,
    /## 期限切れ\n\n- \[EXP-A\] \[期限切れの件\]\(themes\/EXP-A\.md\)（期日: 2026-11-19）/,
  );
  assert.match(now, /## 進行中/);

  const archive = fs.readFileSync(path.join(viewDirectory, "archive", "EXP-A", "2025.md"), "utf8");
  assert.match(archive, /去年終わった件/);
  assert.match(archive, /kind: archive/);
});

test("正本 Markdown を持つノートは本文を写さず、Document は文章にして出す", (t) => {
  const { service, viewDirectory } = setup(t);
  service.generateNow("test");
  const tree = readTree(viewDirectory);
  for (const content of tree.values()) {
    assert.ok(!content.includes("写さない本文"), "正本ノートの本文は写さない");
    assert.ok(!content.includes("evil()"), "script は文章に入らない");
  }
  const theme = tree.get("themes/EXP-A.md");
  assert.match(
    theme,
    /\[正本ノート\]\(\.\.\/\.\.\/Themes\/EXP-A\/Notes\/正本\.md\)（正本 Markdown）/,
  );
  const note = tree.get("themes/EXP-A/notes/読書メモ--note-pla.md");
  assert.ok(note, "通常のノートはファイルになる");
  assert.match(note, /# 読書メモ\n\n最初の段落/);
  const document = tree.get("themes/EXP-A/documents/報告書--document.md");
  assert.ok(document, "Document はファイルになる");
  assert.match(document, /# 見出し/);
  assert.match(document, /本文太字/);
  assert.match(document, /- 項目1/);
});

test("記録を 1 件変えて、書き換わるのが関わるファイルだけ", (t) => {
  const { database, service } = setup(t);
  service.generateNow("test");
  database.save("note", { ...database.get("note", "note-plain1"), title: "読書メモ2" });
  pin(database, "note-plain1", "2026-11-12T00:00:00.000Z", "2026-11-20T00:00:00.000Z");
  const result = service.generateNow("test");
  assert.equal(result.status, "written");
  assert.ok(result.written.includes("themes/EXP-A/notes/読書メモ2--note-pla.md"));
  assert.ok(result.written.includes("themes/EXP-A.md"), "リンク先の題名が変わる");
  assert.ok(result.deleted.includes("themes/EXP-A/notes/読書メモ--note-pla.md"));
  assert.ok(!result.written.includes("themes/inbox.md"), "関わらない Theme は書かない");
  assert.ok(!result.written.includes("now.md"), "Task が変わらなければ now は書かない");
  assert.ok(!result.written.includes("archive/EXP-A/2025.md"));
});

test("Schedule だけを変えると、関わるファイルの updated と index の鮮度が進む", (t) => {
  const { database, service, viewDirectory } = setup(t);
  service.generateNow("test");
  // 期日を延ばすだけの変更（Task 自体は触らない）。updated_at は全記録で最新にする。
  database.save("schedule", { ...database.get("schedule", "sch-1"), end_date: "2026-11-26" });
  pin(database, "sch-1", "2026-11-10T00:00:00.000Z", "2026-11-20T00:00:00.000Z");
  const result = service.generateNow("test");
  assert.equal(result.status, "written");
  assert.ok(result.written.includes("themes/EXP-A.md"), "Theme ファイルが書き換わる");
  assert.ok(result.written.includes("index.md"), "index が書き換わる");
  // 2026-11-20T00:00Z = +09:00 で 09:00。Schedule の updated_at が最大値になる。
  const theme = fs.readFileSync(path.join(viewDirectory, "themes", "EXP-A.md"), "utf8");
  assert.match(theme, /updated: 2026-11-20T09:00:00\+09:00/);
  assert.match(theme, /期日: 2026-11-26/);
  const index = fs.readFileSync(path.join(viewDirectory, "index.md"), "utf8");
  assert.match(index, /updated: 2026-11-20T09:00:00\+09:00/);
  assert.match(index, /2026-11-20 09:00 時点の Tasken の内容/);
  const now = fs.readFileSync(path.join(viewDirectory, "now.md"), "utf8");
  assert.match(now, /updated: 2026-11-20T09:00:00\+09:00/);
  assert.ok(!result.written.includes("themes/inbox.md"), "関わらない Theme は書かない");
});

test("台帳に無いファイルに触らない。台帳から外れたファイルだけ消す", (t) => {
  const { database, root, service, viewDirectory } = setup(t);
  fs.mkdirSync(path.join(viewDirectory, "themes", "EXP-A"), { recursive: true });
  const stray = path.join(viewDirectory, "themes", "EXP-A", "手書き.md");
  fs.writeFileSync(stray, "本人が置いた物", "utf8");
  const strayTop = path.join(viewDirectory, "メモ.txt");
  fs.writeFileSync(strayTop, "競合の複製のつもり", "utf8");
  service.generateNow("test");
  service.generateNow("test");
  assert.equal(fs.readFileSync(stray, "utf8"), "本人が置いた物");
  assert.equal(fs.readFileSync(strayTop, "utf8"), "競合の複製のつもり");
  const status = service.status();
  assert.ok(status.conflicts.includes("themes/EXP-A/手書き.md"));
  assert.ok(status.conflicts.includes("メモ.txt"));
  // 記録が消えたら、そのファイルだけが台帳から外れて消える。
  database.remove("note", "note-plain1");
  const result = service.generateNow("test");
  assert.ok(result.deleted.includes("themes/EXP-A/notes/読書メモ--note-pla.md"));
  assert.ok(
    !fs.existsSync(path.join(viewDirectory, "themes", "EXP-A", "notes", "読書メモ--note-pla.md")),
  );
  assert.equal(fs.readFileSync(stray, "utf8"), "本人が置いた物");
  assert.ok(root);
});

test("書き手でない端末は書かない。引き継ぐと書ける", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-view-writer-"));
  const root = path.join(base, "Tasken");
  fs.mkdirSync(root, { recursive: true });
  const first = new WorkspaceDatabase(path.join(base, "first.sqlite"));
  const second = new WorkspaceDatabase(path.join(base, "second.sqlite"));
  t.after(() => {
    if (first.db.open) first.db.close();
    if (second.db.open) second.db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });
  for (const database of [first, second]) {
    database.setPreference("artifactDirectory", root);
    database.setPreference("taskenViewWriter", true);
    seed(database);
  }
  const options = (database) => ({
    repository: database,
    readDocumentHtml: () => DOCUMENT_HTML,
    now: () => new Date(NOW.getTime()),
    env: {},
  });
  const firstService = new TaskenViewService(options(first));
  const secondService = new TaskenViewService(options(second));
  assert.equal(firstService.generateNow("test").status, "written");
  const before = readTree(path.join(root, "View"));
  const refused = secondService.generateNow("test");
  assert.equal(refused.status, "other-writer");
  assert.deepEqual(readTree(path.join(root, "View")), before);
  assert.equal(secondService.status().writerState, "other");
  const taken = secondService.takeOver();
  // 中身が同じなので射影は書き換わらない。引き継ぎの本体は台帳の書き手が替わること。
  assert.ok(taken.status === "written" || taken.status === "unchanged", taken.status);
  const ledger = readTaskenViewLedger(path.join(root, "View"));
  assert.equal(ledger.state, "present");
  assert.equal(ledger.ledger.writerDeviceId, second.deviceId);
  // 台帳には端末ごとの取り込み済みの連番が入る。
  first.setSyncCursor("device-x", 3);
  const firstAgain = new TaskenViewService(options(first));
  assert.equal(firstAgain.generateNow("test").status, "other-writer");
  second.setSyncCursor("device-y", 5);
  secondService.generateNow("test");
  const ledger2 = readTaskenViewLedger(path.join(root, "View"));
  assert.equal(ledger2.ledger.cursors["device-y"], 5);
});

test("書く設定が無ければ書かない。台帳が壊れていたら書かない", (t) => {
  const { service, viewDirectory } = setup(t, { writer: false });
  assert.equal(service.generateNow("test").status, "not-enabled");
  assert.ok(!fs.existsSync(viewDirectory));

  const broken = setup(t);
  broken.service.generateNow("test");
  fs.writeFileSync(path.join(broken.viewDirectory, TASKEN_VIEW_LEDGER_FILE), "{壊れている", "utf8");
  const before = readTree(broken.viewDirectory);
  assert.equal(broken.service.generateNow("test").status, "ledger-invalid");
  assert.deepEqual(readTree(broken.viewDirectory), before);
  assert.equal(broken.service.status().writerState, "invalid");
});

test("作るタイミング: 30 秒静かになってから、2 分に 1 回まで", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-view-timing-"));
  const database = new WorkspaceDatabase(path.join(base, "tasken.sqlite"));
  t.after(() => {
    if (database.db.open) database.db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });
  const root = path.join(base, "Tasken");
  fs.mkdirSync(root, { recursive: true });
  database.setPreference("artifactDirectory", root);
  database.setPreference("taskenViewWriter", true);
  seed(database);

  let virtualNow = NOW.getTime();
  const pending = new Map();
  let sequence = 0;
  const timers = {
    setTimeout: (fn, ms) => {
      const id = ++sequence;
      pending.set(id, { fn, at: virtualNow + ms, interval: 0 });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    setInterval: (fn, ms) => {
      const id = ++sequence;
      pending.set(id, { fn, at: virtualNow + ms, interval: ms });
      return id;
    },
    clearInterval: (id) => pending.delete(id),
  };
  const tick = (ms) => {
    const target = virtualNow + ms;
    for (;;) {
      let nextId = null;
      let nextAt = Infinity;
      for (const [id, entry] of pending) {
        if (entry.at <= target && entry.at < nextAt) {
          nextAt = entry.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const entry = pending.get(nextId);
      virtualNow = entry.at;
      if (entry.interval) entry.at = virtualNow + entry.interval;
      else pending.delete(nextId);
      entry.fn();
    }
    virtualNow = target;
  };

  const service = new TaskenViewService({
    repository: database,
    readDocumentHtml: () => DOCUMENT_HTML,
    now: () => new Date(virtualNow),
    env: {},
    timers,
  });
  service.start();
  assert.equal(service.lastRun.status, "written", "起動時に 1 回作る");
  const runsAfterStart = service.lastRun.at;

  service.requestGenerate();
  tick(29 * 1000);
  assert.equal(service.lastRun.at, runsAfterStart, "30 秒静かになる前は作らない");
  tick(31 * 1000);
  assert.equal(service.lastRun.at, runsAfterStart, "前回から 2 分は空ける");
  tick(60 * 1000);
  assert.notEqual(service.lastRun.at, runsAfterStart, "2 分たったら作る");
  assert.equal(service.lastRun.status, "unchanged");
  service.stop();
});

test("射影の純粋関数: 同じ snapshot から同じファイルが返る", () => {
  const snapshot = {
    themes: [
      {
        id: "theme-exp",
        name: "触媒の条件出し",
        code: "EXP-A",
        updated_at: "2026-11-18T01:00:00.000Z",
      },
    ],
    tasks: [
      {
        id: "task-1",
        title: "件名",
        state: "todo",
        project_id: "theme-exp",
        created_at: "2026-11-10T00:00:00.000Z",
        updated_at: "2026-11-10T00:00:00.000Z",
      },
    ],
    schedules: [],
    notes: [],
    documents: [],
  };
  const first = buildTaskenViewFiles(snapshot, { now: NOW });
  const second = buildTaskenViewFiles(snapshot, { now: NOW });
  assert.deepEqual([...second.entries()], [...first.entries()]);
  assert.equal(taskenViewHtmlToText("<p>a</p><p>b</p>"), "a\nb");
});

// 段 4（#812）：本体の指定が書き手の既定になる。cloud の判定は env の OneDrive で作る。
function designationSetup(t, { cloud = true, designate = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-view-designation-"));
  const database = new WorkspaceDatabase(path.join(base, "tasken.sqlite"));
  t.after(() => {
    if (database.db.open) database.db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });
  const oneDrive = path.join(base, "OneDrive");
  const root = cloud ? path.join(oneDrive, "Tasken") : path.join(base, "Tasken");
  fs.mkdirSync(root, { recursive: true });
  database.setPreference("artifactDirectory", root);
  seed(database);
  if (designate === "self") database.setWorkspaceDesignation(database.deviceId);
  if (designate === "other") database.setWorkspaceDesignation("another-device");
  const service = new TaskenViewService({
    repository: database,
    readDocumentHtml: () => null,
    now: () => new Date(NOW.getTime()),
    env: cloud ? { OneDrive: oneDrive } : {},
  });
  return { base, database, root, service, viewDirectory: path.join(root, "View") };
}

test("段4: 本体に指定され、ルートが cloud の端末は、設定を触っていなくても既定で書く", (t) => {
  const { database, service, viewDirectory } = designationSetup(t, { designate: "self" });
  assert.equal(database.taskenViewWriterTouched(), false);
  assert.equal(service.rootKind(), "cloud");
  assert.equal(service.writerEnabled(), true);
  assert.equal(service.generateNow("test").status, "written");
  assert.ok(fs.existsSync(path.join(viewDirectory, TASKEN_VIEW_LEDGER_FILE)));
  const status = service.status();
  assert.equal(status.designatedDeviceId, database.deviceId);
  assert.equal(status.isDesignatedDevice, true);
});

test("段4: 本体のルートが cloud でなければ既定で書かず、他の端末の指定でも書かない", (t) => {
  const local = designationSetup(t, { cloud: false, designate: "self" });
  assert.equal(local.service.rootKind(), "local");
  assert.equal(local.service.writerEnabled(), false);
  assert.equal(local.service.generateNow("test").status, "not-enabled");

  const other = designationSetup(t, { cloud: true, designate: "other" });
  assert.equal(other.service.writerEnabled(), false);
  assert.equal(other.service.generateNow("test").status, "not-enabled");
  assert.equal(other.service.status().isDesignatedDevice, false);

  const none = designationSetup(t, { cloud: true });
  assert.equal(none.service.writerEnabled(), false);
  assert.equal(none.service.status().designatedDeviceId, "");
});

// 段 7（#815）：docx。zip は無圧縮で作るので、試験でもそのまま読める。
function readZipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const dosTime = buffer.readUInt16LE(offset + 10);
    const dosDate = buffer.readUInt16LE(offset + 12);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const dataStart = offset + 30 + nameLength + extraLength;
    entries.push({
      name,
      dosTime,
      dosDate,
      data: buffer.subarray(dataStart, dataStart + size),
    });
    offset = dataStart + size;
  }
  return entries;
}

function dosToText(dosDate, dosTime) {
  const pad = (value) => String(value).padStart(2, "0");
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = (dosDate >> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hour = (dosTime >> 11) & 0x1f;
  const minute = (dosTime >> 5) & 0x3f;
  const second = (dosTime & 0x1f) * 2;
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

test("段7: docx は同じ中間の形から決定的に作られ、zip 日時は updated に固定される", () => {
  const markdown = [
    "---",
    "tasken_view: 1",
    "kind: theme",
    "theme_code: EXP-A",
    "updated: 2026-11-19T10:00:00+09:00",
    "---",
    "",
    "# EXP-A 触媒の条件出し",
    "",
    "## 未完了",
    "",
    "### 温度条件の再測定",
    "- 状態: 進行中",
    "- [x] 試薬の手配",
    "- [ ] 測定",
    "",
    "- [報告書](documents/report.md)",
  ].join("\n");
  const first = Buffer.from(taskenViewDocxFromMarkdown(markdown));
  const second = Buffer.from(taskenViewDocxFromMarkdown(markdown));
  assert.ok(first.equals(second), "同じ入力から同じバイト列");
  const entries = readZipEntries(first);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
      "word/numbering.xml",
      "word/_rels/document.xml.rels",
    ],
  );
  for (const entry of entries) {
    assert.equal(
      dosToText(entry.dosDate, entry.dosTime),
      "2026-11-19 10:00:00",
      `${entry.name} の日時が updated に固定される`,
    );
  }
  const document = entries
    .find((entry) => entry.name === "word/document.xml")
    .data.toString("utf8");
  assert.match(document, /触媒の条件出し/);
  assert.match(document, /温度条件の再測定/);
  assert.match(document, /☑ 試薬の手配/);
  assert.match(document, /☐ 測定/);
  assert.match(document, />報告書</);
  assert.ok(!document.includes("tasken_view"), "front matter は本文に入れない");

  // updated が無いファイルは、生成時刻でなく zip の起点（1980-01-01）に固定する。
  const noUpdated = readZipEntries(Buffer.from(taskenViewDocxFromMarkdown("# 今\n")));
  for (const entry of noUpdated) {
    assert.equal(dosToText(entry.dosDate, entry.dosTime), "1980-01-01 00:00:00");
  }
});

test("段7: docx の対象は now と Theme の本体だけ", () => {
  const files = new Map([
    ["README.md", "# readme"],
    ["index.md", "# index"],
    ["now.md", "# 今"],
    ["themes/EXP-A.md", "# EXP-A"],
    ["themes/EXP-A/notes/読書メモ--note-pla.md", "# 読書メモ"],
    ["themes/EXP-A/documents/報告書--document.md", "# 報告書"],
    ["archive/EXP-A/2025.md", "# 2025"],
  ]);
  const docx = buildTaskenViewDocxFiles(files);
  assert.deepEqual([...docx.keys()], ["now.docx", "themes/EXP-A.docx"]);
  const again = buildTaskenViewDocxFiles(files);
  assert.ok(Buffer.from(docx.get("now.docx")).equals(Buffer.from(again.get("now.docx"))));
});

test("段7: docx も台帳に載り、作り直してもバイトが変わらない", (t) => {
  const { service, viewDirectory } = setup(t);
  const first = service.generateNow("test");
  assert.equal(first.status, "written");
  for (const relative of ["now.docx", "themes/EXP-A.docx", "themes/inbox.docx"]) {
    assert.ok(first.written.includes(relative), `${relative} が書かれる`);
    assert.ok(fs.existsSync(path.join(viewDirectory, relative)));
  }
  const ledger = readTaskenViewLedger(viewDirectory);
  assert.equal(ledger.state, "present");
  for (const relative of ["now.docx", "themes/EXP-A.docx", "themes/inbox.docx"]) {
    assert.ok(ledger.ledger.files[relative], `台帳に ${relative} が載る`);
  }
  assert.ok(!("themes/EXP-A/notes/読書メモ--note-pla.docx" in ledger.ledger.files));
  assert.ok(!("index.docx" in ledger.ledger.files));
  const themeDocx = fs.readFileSync(path.join(viewDirectory, "themes", "EXP-A.docx"));
  const document = readZipEntries(themeDocx)
    .find((entry) => entry.name === "word/document.xml")
    .data.toString("utf8");
  assert.match(document, /温度条件の再測定/);
  // Theme ファイルの updated（2026-11-19T10:00+09:00）が zip 日時になる。
  for (const entry of readZipEntries(themeDocx)) {
    assert.equal(dosToText(entry.dosDate, entry.dosTime), "2026-11-19 10:00:00");
  }
  const second = service.generateNow("test");
  assert.equal(second.status, "unchanged");
  assert.ok(fs.readFileSync(path.join(viewDirectory, "themes", "EXP-A.docx")).equals(themeDocx));
  // 全部消しても同じバイト列が作り直せる。
  fs.rmSync(viewDirectory, { recursive: true, force: true });
  service.generateNow("test");
  assert.ok(fs.readFileSync(path.join(viewDirectory, "themes", "EXP-A.docx")).equals(themeDocx));
});

test("段7: 記録を 1 件変えて、書き換わる docx は関わるファイルだけ", (t) => {
  const { database, service } = setup(t);
  service.generateNow("test");
  database.save("note", { ...database.get("note", "note-plain1"), title: "読書メモ2" });
  pin(database, "note-plain1", "2026-11-12T00:00:00.000Z", "2026-11-20T00:00:00.000Z");
  const result = service.generateNow("test");
  assert.equal(result.status, "written");
  assert.ok(result.written.includes("themes/EXP-A.docx"), "関わる Theme の docx が書き換わる");
  assert.ok(!result.written.includes("now.docx"), "now の docx は書かない");
  assert.ok(!result.written.includes("themes/inbox.docx"), "関わらない Theme の docx は書かない");
});

test("段4: 本人が書き手の設定を触ったら、本体の指定より本人の値が正になる", (t) => {
  const off = designationSetup(t, { designate: "self" });
  off.database.setPreference("taskenViewWriter", false);
  assert.equal(off.database.taskenViewWriterTouched(), true);
  assert.equal(off.service.writerEnabled(), false);
  assert.equal(off.service.generateNow("test").status, "not-enabled");

  const on = designationSetup(t, { cloud: false, designate: "other" });
  on.database.setPreference("taskenViewWriter", true);
  assert.equal(on.service.writerEnabled(), true);
  assert.equal(on.service.generateNow("test").status, "written");
});
