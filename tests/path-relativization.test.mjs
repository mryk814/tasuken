import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";
import { artifactFileLocator, artifactOpenTarget } from "../src/shared/artifactLinks.mjs";
import {
  canonicalMarkdownBindingFromProperties,
  canonicalMarkdownBindingRef,
} from "../src/shared/canonicalMarkdown.mjs";
import { buildPersonalDefaultTheme } from "../src/shared/personalTheme.mjs";
import { buildTaskenViewFiles } from "../src/shared/taskenView.mjs";

// 同期される記録の中のパスをルート相対にする（#803 段 6・#814）。
// 自分の端末のルートで始まる記録だけが { storage_root_id: "sync", relative_path } に
// 一度きりで移り、revision は固定 ID なので 2 台が独立に変換しても競合にならない。
// 変換は控えを取り、同期が追いついているときだけ走る。物理ファイルは動かさない。

async function loadModule(entry) {
  const output = await build({
    entryPoints: [entry],
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

const { runPathRelativizationOnce, planPathRelativization } = await loadModule(
  "src/main/services/pathRelativization.ts",
);

async function importWorkspaceService() {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-relativization-bundle-"));
  const outputFile = path.join(outputDirectory, "workspaceService.mjs");
  const electronMock = {
    name: "electron-mock",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^electron$/ }, () => ({
        path: "electron-mock",
        namespace: "electron-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "electron-mock" }, () => ({
        contents: `
          export const app = { getPath: () => "" };
          export class BrowserWindow {}
          export class ClipboardItem {}
          export const clipboard = {};
          export const dialog = {};
          export const nativeImage = {};
          export const shell = {};
        `,
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^better-sqlite3$/ }, () => ({
        path: "better-sqlite3-mock",
        namespace: "better-sqlite3-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "better-sqlite3-mock" }, () => ({
        contents:
          "export default class Database { constructor() { throw new Error('database path is not used by path relativization tests'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /workspaceRepository\.mjs$/ }, () => ({
        path: "workspace-repository-mock",
        namespace: "workspace-repository-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "workspace-repository-mock" }, () => ({
        contents:
          "export const workspaceEntityTypes = []; export const workspaceSchemaVersion = 1;",
        loader: "js",
      }));
    },
  };
  await build({
    entryPoints: [path.resolve("src/main/services/workspaceService.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    logLevel: "silent",
    plugins: [electronMock],
  });
  return import(pathToFileURL(outputFile).href);
}

const { WorkspaceService } = await importWorkspaceService();

const openDatabases = new Map();

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-path-relativization-"));
  openDatabases.set(root, []);
  t.after(() => {
    for (const database of openDatabases.get(root)) if (database.db.open) database.db.close();
    openDatabases.delete(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function openDatabase(t, root, name = "first") {
  const database = new WorkspaceDatabase(path.join(root, name, "tasken.sqlite"));
  openDatabases.get(root).push(database);
  return database;
}

/** index.ts の起動時配線と同じ形の repository adapter。 */
function repositoryFor(database, rootDirectory) {
  return {
    list: (type) => database.list(type),
    get: (type, id, includeDeleted) => database.get(type, id, includeDeleted),
    syncHead: (type, id) => database.syncHead(type, id),
    rootDirectory: () => rootDirectory,
    applyPathRelativization: (type, entity, fixedRevisionId) =>
      database.applyPathRelativization(type, entity, fixedRevisionId),
    readRetiredExportMark: (name) => database.readRetiredExportMark(name),
    markRetiredExportDone: (name, value) => database.markRetiredExportDone(name, value),
  };
}

function backupSpy(root) {
  const calls = [];
  return {
    calls,
    backup: async () => {
      const filePath = path.join(root, `backup-${calls.length + 1}.sqlite`);
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(filePath, "backup");
      calls.push(filePath);
      return filePath;
    },
  };
}

function artifact(overrides = {}) {
  return {
    id: "artifact-in",
    title: "実験結果",
    filename: "result.xlsx",
    file_type: "xlsx",
    file_size: 1024,
    source_type: "theme",
    source_id: "theme-exp",
    ...overrides,
  };
}

function seedTheme(database) {
  database.save("theme", { id: "theme-exp", name: "実験", code: "EXP-A" });
}

function bindingOf(database, noteId) {
  const note = database.get("note", noteId);
  return canonicalMarkdownBindingFromProperties(note.properties_json, { noteId });
}

test("自分のルートで始まる Artifact と Note だけが変換され、document_exports と対象外は不変", async (t) => {
  const root = tempRoot(t);
  const taskenRoot = path.join(root, "TaskenRoot");
  const database = openDatabase(t, root);
  seedTheme(database);
  database.save(
    "artifact",
    artifact({ stored_path: path.join(taskenRoot, "Themes/EXP-A/Artifacts/result.xlsx") }),
  );
  database.save(
    "artifact",
    artifact({
      id: "artifact-out",
      filename: "outside.bin",
      stored_path: path.join(root, "outside", "outside.bin"),
    }),
  );
  database.save(
    "artifact",
    artifact({
      id: "artifact-linked",
      filename: "linked.pdf",
      storage_mode: "linked",
      stored_path: "",
      target: path.join(taskenRoot, "Themes/EXP-A/Artifacts/linked.pdf"),
    }),
  );
  database.save(
    "artifact",
    artifact({
      id: "artifact-ref",
      filename: "already.pdf",
      stored_path: { storage_root_id: "sync", relative_path: "Themes/EXP-A/Artifacts/already.pdf" },
    }),
  );
  database.save("note", {
    id: "note-in",
    title: "正本ノート",
    body_markdown: "本文",
    project_id: "theme-exp",
    properties_json: {
      canonical_markdown: {
        canonical_path: path.join(taskenRoot, "Themes/EXP-A/Notes/正本.md"),
        directory: path.join(taskenRoot, "Themes/EXP-A/Notes"),
        file_name: "正本.md",
      },
      document_exports: [
        { file_path: path.join(taskenRoot, "Exports/export.md"), format: "markdown" },
      ],
    },
  });
  database.save("note", {
    id: "note-out",
    title: "対象外ノート",
    body_markdown: "本文",
    project_id: "theme-exp",
    properties_json: {
      canonical_markdown: {
        canonical_path: path.join(root, "other-root", "Notes/対象外.md"),
        file_name: "対象外.md",
      },
    },
  });
  const exportsBefore = database.get("note", "note-in").properties_json.document_exports;

  const backup = backupSpy(path.join(root, "backups"));
  const result = await runPathRelativizationOnce({
    repository: repositoryFor(database, taskenRoot),
    backup: backup.backup,
  });
  assert.deepEqual(result, { state: "done", artifacts: 1, notes: 1, failed: 0 });
  assert.equal(backup.calls.length, 1);

  assert.deepEqual(database.get("artifact", "artifact-in").stored_path, {
    storage_root_id: "sync",
    relative_path: "Themes/EXP-A/Artifacts/result.xlsx",
  });
  assert.equal(
    database.get("artifact", "artifact-out").stored_path,
    path.join(root, "outside", "outside.bin"),
  );
  assert.equal(database.get("artifact", "artifact-linked").stored_path, "");
  assert.deepEqual(database.get("artifact", "artifact-ref").stored_path, {
    storage_root_id: "sync",
    relative_path: "Themes/EXP-A/Artifacts/already.pdf",
  });

  const binding = bindingOf(database, "note-in");
  assert.equal(binding.storage_root_id, "sync");
  assert.equal(binding.relative_path, "Themes/EXP-A/Notes/正本.md");
  assert.equal(binding.canonical_path, "");
  assert.deepEqual(database.get("note", "note-in").properties_json.document_exports, exportsBefore);
  assert.equal(
    bindingOf(database, "note-out").canonical_path,
    path.join(root, "other-root", "Notes/対象外.md"),
  );

  // 一度きり：もう変換する物は無く、控えも取り直さない。
  const second = await runPathRelativizationOnce({
    repository: repositoryFor(database, taskenRoot),
    backup: backup.backup,
  });
  assert.deepEqual(second, { state: "nothing" });
  assert.equal(backup.calls.length, 1);
});

test("同期が追いついていないときと、控えが取れないときは変換しない", async (t) => {
  const root = tempRoot(t);
  const taskenRoot = path.join(root, "TaskenRoot");
  const database = openDatabase(t, root);
  seedTheme(database);
  database.save(
    "artifact",
    artifact({ stored_path: path.join(taskenRoot, "Artifacts/result.xlsx") }),
  );
  const storedPath = path.join(taskenRoot, "Artifacts/result.xlsx");

  const backup = backupSpy(path.join(root, "backups"));
  const notCaughtUp = await runPathRelativizationOnce({
    repository: repositoryFor(database, taskenRoot),
    backup: backup.backup,
    isCaughtUp: async () => false,
  });
  assert.deepEqual(notCaughtUp, { state: "not_caught_up", pending: 1 });
  assert.equal(backup.calls.length, 0);
  assert.equal(database.get("artifact", "artifact-in").stored_path, storedPath);

  const backupFailed = await runPathRelativizationOnce({
    repository: repositoryFor(database, taskenRoot),
    backup: async () => null,
  });
  assert.deepEqual(backupFailed, { state: "backup_failed", pending: 1 });
  assert.equal(database.get("artifact", "artifact-in").stored_path, storedPath);
});

test("書き込みに失敗した回の控えは、同じ組のやり直しで使い回す", async (t) => {
  const root = tempRoot(t);
  const taskenRoot = path.join(root, "TaskenRoot");
  const database = openDatabase(t, root);
  seedTheme(database);
  database.save(
    "artifact",
    artifact({ stored_path: path.join(taskenRoot, "Artifacts/result.xlsx") }),
  );
  const backup = backupSpy(path.join(root, "backups"));
  const failing = {
    ...repositoryFor(database, taskenRoot),
    applyPathRelativization: () => {
      throw new Error("write failed");
    },
  };
  const first = await runPathRelativizationOnce({ repository: failing, backup: backup.backup });
  assert.deepEqual(first, { state: "done", artifacts: 0, notes: 0, failed: 1 });
  assert.equal(backup.calls.length, 1);

  const second = await runPathRelativizationOnce({
    repository: repositoryFor(database, taskenRoot),
    backup: backup.backup,
  });
  assert.deepEqual(second, { state: "done", artifacts: 1, notes: 0, failed: 0 });
  assert.equal(backup.calls.length, 1);
  assert.deepEqual(database.get("artifact", "artifact-in").stored_path, {
    storage_root_id: "sync",
    relative_path: "Artifacts/result.xlsx",
  });
});

function createDevices(t, count) {
  const root = tempRoot(t);
  const shared = path.join(root, "shared");
  return {
    root,
    shared,
    devices: Array.from({ length: count }, (_, index) => {
      const name = `device-${index}`;
      const database = openDatabase(t, root, name);
      const sync = new SharedFolderSyncService(
        database,
        () => {},
        path.join(root, name, "attachments", "markdown-images"),
        path.join(root, name, "attachments", "capture-images"),
      );
      return { database, sync };
    }),
  };
}

async function syncAll(devices, rounds = 2) {
  for (let round = 0; round < rounds; round += 1)
    for (const device of devices) await device.sync.syncNow();
}

test("2 台が独立に変換しても、固定 revision で同期の競合が 0 件に収まる", async (t) => {
  const { root, shared, devices } = createDevices(t, 2);
  const [first, second] = devices;
  const taskenRoot = path.join(root, "TaskenRoot");
  seedTheme(first.database);
  first.database.save(
    "artifact",
    artifact({ stored_path: path.join(taskenRoot, "Themes/EXP-A/Artifacts/result.xlsx") }),
  );
  first.database.save("note", {
    id: "note-shared",
    title: "共有ノート",
    body_markdown: "本文",
    project_id: "theme-exp",
    properties_json: {
      canonical_markdown: {
        canonical_path: path.join(taskenRoot, "Themes/EXP-A/Notes/共有.md"),
        file_name: "共有.md",
      },
    },
  });
  await first.sync.configure(shared);
  await second.sync.configure(shared);
  assert.ok(second.database.get("artifact", "artifact-in"));
  assert.ok(second.database.get("note", "note-shared"));

  // 両端末が計算する固定 revision が一致する（変換の同一性の照合）。
  const planFirst = planPathRelativization(repositoryFor(first.database, taskenRoot));
  const planSecond = planPathRelativization(repositoryFor(second.database, taskenRoot));
  assert.deepEqual(
    planSecond.map((plan) => `${plan.type}:${plan.id}:${plan.revisionId}`),
    planFirst.map((plan) => `${plan.type}:${plan.id}:${plan.revisionId}`),
  );

  // 同期の前に、両方が独立に変換する。
  for (const device of devices) {
    const result = await runPathRelativizationOnce({
      repository: repositoryFor(device.database, taskenRoot),
      backup: backupSpy(path.join(root, "backups")).backup,
    });
    assert.equal(result.state, "done");
  }
  await syncAll(devices);

  for (const { database } of devices) {
    assert.equal(database.syncConflictCount(), 0);
    assert.deepEqual(database.get("artifact", "artifact-in").stored_path, {
      storage_root_id: "sync",
      relative_path: "Themes/EXP-A/Artifacts/result.xlsx",
    });
    assert.equal(bindingOf(database, "note-shared").relative_path, "Themes/EXP-A/Notes/共有.md");
  }
  assert.equal(
    first.database.syncHead("artifact", "artifact-in"),
    second.database.syncHead("artifact", "artifact-in"),
  );
  assert.equal(
    first.database.syncHead("note", "note-shared"),
    second.database.syncHead("note", "note-shared"),
  );
});

function saveRequest(note, body) {
  return {
    entity: { ...note, body_markdown: body },
    snapshot: {
      owner: { recordType: "note", entityId: note.id },
      body,
      expectedRevision: Number(note.version || 0),
    },
    options: {},
  };
}

test("ルート位置の違う 2 台で、同じ Artifact とノートが開ける", async (t) => {
  const root = tempRoot(t);
  const rootA = path.join(root, "device-a", "Tasken");
  const rootB = path.join(root, "device-b", "Tasken");

  // 端末 A：正本 Markdown を実際に作り、Artifact の実ファイルと記録を用意する。
  const databaseA = openDatabase(t, root, "a");
  databaseA.setPreference("artifactDirectory", rootA);
  databaseA.save("theme", buildPersonalDefaultTheme());
  seedTheme(databaseA);
  const serviceA = new WorkspaceService(databaseA, path.join(root, "a"));
  databaseA.save("note", {
    id: "note-two-roots",
    title: "2台で開くノート",
    body_markdown: "最初の本文",
  });
  const savedNote = serviceA.saveCanonicalNote(
    saveRequest(databaseA.get("note", "note-two-roots"), "最初の本文"),
  );
  const bindingA = canonicalMarkdownBindingFromProperties(savedNote.properties_json, {
    noteId: savedNote.id,
  });
  const fileA = bindingA.canonical_path;
  assert.ok(fileA.startsWith(rootA), `canonical file is under root A: ${fileA}`);
  const noteRelative = path.relative(rootA, fileA).split(path.sep).join("/");

  const artifactFileA = path.join(rootA, "Artifacts", "result.xlsx");
  fs.mkdirSync(path.dirname(artifactFileA), { recursive: true });
  fs.writeFileSync(artifactFileA, "spreadsheet-bytes");
  databaseA.save("artifact", artifact({ stored_path: artifactFileA }));

  const converted = await runPathRelativizationOnce({
    repository: repositoryFor(databaseA, rootA),
    backup: backupSpy(path.join(root, "backups")).backup,
  });
  assert.deepEqual(converted, { state: "done", artifacts: 1, notes: 1, failed: 0 });

  // 端末 B：変換後の記録が同期で届き、同じ相対位置にファイルがある（同期フォルダの
  // 別の置き場所）。記録はそのまま保存し直して再現する。
  const databaseB = openDatabase(t, root, "b");
  databaseB.setPreference("artifactDirectory", rootB);
  databaseB.save("theme", buildPersonalDefaultTheme());
  seedTheme(databaseB);
  databaseB.save("artifact", databaseA.get("artifact", "artifact-in"));
  databaseB.save("note", databaseA.get("note", "note-two-roots"));
  const fileB = path.join(rootB, ...noteRelative.split("/"));
  fs.mkdirSync(path.dirname(fileB), { recursive: true });
  fs.copyFileSync(fileA, fileB);
  const artifactFileB = path.join(rootB, "Artifacts", "result.xlsx");
  fs.mkdirSync(path.dirname(artifactFileB), { recursive: true });
  fs.copyFileSync(artifactFileA, artifactFileB);

  // Artifact は B のルートで引き直して開ける。
  const artifactB = databaseB.get("artifact", "artifact-in");
  assert.equal(artifactOpenTarget(artifactB, { sync: rootB }), artifactFileB);
  const serviceB = new WorkspaceService(databaseB, path.join(root, "b"));
  assert.equal(serviceB.resolveArtifactFilePath(artifactB), artifactFileB);
  assert.ok(fs.existsSync(artifactFileB));

  // ノートは B で保存すると B 側のファイルだけが更新され、結び付けは参照のまま残る。
  const noteB = databaseB.get("note", "note-two-roots");
  serviceB.saveCanonicalNote(saveRequest(noteB, "Bで追記した本文"));
  assert.match(fs.readFileSync(fileB, "utf8"), /Bで追記した本文/);
  assert.doesNotMatch(fs.readFileSync(fileA, "utf8"), /Bで追記した本文/);
  assert.deepEqual(
    canonicalMarkdownBindingRef(
      canonicalMarkdownBindingFromProperties(
        databaseB.get("note", "note-two-roots").properties_json,
        {
          noteId: "note-two-roots",
        },
      ),
    ),
    { storage_root_id: "sync", relative_path: noteRelative },
  );
});

test("読み手は絶対パスとルート相対の両形式を解ける", () => {
  const rootB = path.join(os.tmpdir(), "tasken-other-root");
  const absolute = { storage_mode: "managed", stored_path: "/data/Tasken/Artifacts/a.pdf" };
  assert.equal(artifactOpenTarget(absolute), "/data/Tasken/Artifacts/a.pdf");
  assert.equal(artifactOpenTarget(absolute, { sync: rootB }), "/data/Tasken/Artifacts/a.pdf");

  const relative = {
    storage_mode: "managed",
    stored_path: { storage_root_id: "sync", relative_path: "Artifacts/a.pdf" },
  };
  assert.deepEqual(artifactFileLocator(relative), {
    storage_root_id: "sync",
    relative_path: "Artifacts/a.pdf",
  });
  assert.equal(artifactOpenTarget(relative, { sync: rootB }), path.join(rootB, "Artifacts/a.pdf"));
  // ルートの登録が無い読み手では開けない（空文字）で、参照を絶対パスと誤認しない。
  assert.equal(artifactOpenTarget(relative), "");
  assert.equal(artifactOpenTarget(relative, { other: rootB }), "");
});

test("Tasken View はルート相対の結び付けを正本 Markdown へのリンクにする", async (t) => {
  const root = tempRoot(t);
  const taskenRoot = path.join(root, "TaskenRoot");
  const database = openDatabase(t, root);
  seedTheme(database);
  database.save("note", {
    id: "note-view",
    title: "Viewのノート",
    body_markdown: "写さない本文",
    project_id: "theme-exp",
    properties_json: {
      canonical_markdown: {
        canonical_path: path.join(taskenRoot, "Themes/EXP-A/Notes/正本.md"),
        file_name: "正本.md",
      },
    },
  });
  await runPathRelativizationOnce({
    repository: repositoryFor(database, taskenRoot),
    backup: backupSpy(path.join(root, "backups")).backup,
  });

  const files = buildTaskenViewFiles(
    {
      themes: database.list("theme"),
      tasks: [],
      schedules: [],
      notes: database.list("note"),
      documents: [],
    },
    { now: new Date("2026-11-20T09:00:00+09:00") },
  );
  const themeFile = files.get("themes/EXP-A.md");
  assert.ok(themeFile, "theme file exists");
  assert.match(themeFile, /\(\.\.\/\.\.\/Themes\/EXP-A\/Notes\/正本\.md\)（正本 Markdown）/);
  // 正本の本文は View に写さない。
  assert.ok(![...files.keys()].some((filePath) => filePath.includes("note-view")));
  assert.ok(!themeFile.includes("写さない本文"));
});
