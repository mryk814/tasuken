import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TASKEN_ROOT_MARKER,
  comparablePath,
  compareTaskenRootMarker,
  detectTaskenRootKind,
  effectiveTaskenRootKind,
  isPathInside,
  listTaskenRootExceptions,
  parentDirectory,
  syncFolderDefaultPath,
  taskenRootCandidate,
} from "../src/shared/taskenRoot.mjs";
import {
  TaskenRootService,
  ensureTaskenRootMarker,
  readTaskenRootMarker,
  rewriteTaskenRootMarkerWorkspace,
} from "../src/main/services/taskenRoot.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";

const ONE_DRIVE_ENV = {
  OneDrive: "C:\\Users\\me\\OneDrive",
  OneDriveCommercial: "C:\\Users\\me\\OneDrive - Contoso",
};

test("場所の性質: OneDrive の配下は cloud（大文字小文字・区切りを問わない）", () => {
  assert.equal(detectTaskenRootKind("C:\\Users\\me\\OneDrive\\Tasken", ONE_DRIVE_ENV), "cloud");
  assert.equal(detectTaskenRootKind("c:/users/ME/onedrive/Tasken/", ONE_DRIVE_ENV), "cloud");
  assert.equal(
    detectTaskenRootKind("C:\\Users\\me\\OneDrive - Contoso\\Work", ONE_DRIVE_ENV),
    "cloud",
  );
  assert.equal(
    detectTaskenRootKind("D:\\Data", { OneDriveConsumer: "D:\\Data" }),
    "cloud",
    "OneDrive そのものもルートにできる",
  );
  // 名前が前方で一致するだけの隣のフォルダは配下ではない。
  assert.equal(detectTaskenRootKind("C:\\Users\\me\\OneDriveBackup", ONE_DRIVE_ENV), "local");
});

test("場所の性質: Google Drive の形は cloud", () => {
  assert.equal(detectTaskenRootKind("G:\\My Drive\\Tasken", {}), "cloud");
  assert.equal(detectTaskenRootKind("G:\\マイドライブ\\Tasken", {}), "cloud");
  assert.equal(detectTaskenRootKind("C:\\Users\\me\\Google Drive\\Tasken", {}), "cloud");
  assert.equal(detectTaskenRootKind("/Users/me/GoogleDrive/Tasken", {}), "cloud");
  assert.equal(detectTaskenRootKind("C:\\Users\\me\\Drive\\Tasken", {}), "local");
});

test("場所の性質: UNC は nas、それ以外は local、空は null", () => {
  assert.equal(detectTaskenRootKind("\\\\nas\\share\\Tasken", ONE_DRIVE_ENV), "nas");
  assert.equal(detectTaskenRootKind("//nas/share/Tasken", ONE_DRIVE_ENV), "nas");
  assert.equal(detectTaskenRootKind("D:\\Tasken", ONE_DRIVE_ENV), "local");
  assert.equal(detectTaskenRootKind("/home/me/tasken", ONE_DRIVE_ENV), "local");
  assert.equal(detectTaskenRootKind("", ONE_DRIVE_ENV), null);
});

test("性質は本人が直した値を優先し、auto なら判定に従う", () => {
  assert.equal(effectiveTaskenRootKind("auto", "cloud"), "cloud");
  assert.equal(effectiveTaskenRootKind("nas", "local"), "nas");
  assert.equal(effectiveTaskenRootKind("bogus", "local"), "local");
});

test("パスの比べ方: Windows は大文字小文字を区別せず、POSIX は区別する", () => {
  assert.equal(comparablePath("C:/Users/Me/../Me/OneDrive/"), "c:\\users\\me\\onedrive");
  assert.ok(isPathInside("C:\\ROOT\\Sync", "c:\\root"));
  assert.ok(isPathInside("C:\\root", "C:\\root\\"));
  assert.ok(!isPathInside("C:\\rootless", "C:\\root"));
  assert.ok(!isPathInside("/Root/Sync", "/root"));
  assert.ok(isPathInside("/root/Sync", "/root"));
});

test("例外の一覧: ルートの外の同期フォルダ・storage_root の Theme・日誌の個別指定・控え", () => {
  const exceptions = listTaskenRootExceptions({
    root: "C:\\Users\\me\\OneDrive\\Tasken",
    rootKind: "cloud",
    syncDirectory: "C:\\Users\\me\\OneDrive\\TaskenSync",
    themes: [
      { id: "t2", name: "顧客B", storage_root: "D:\\Customers\\B" },
      { id: "t1", name: "案件A", storage_root: "D:\\Projects\\A" },
      { id: "t3", name: "ふつう", storage_root: "" },
      { id: "t4", name: "消した", storage_root: "D:\\Gone", deleted_at: "2026-01-01" },
    ],
    activityLogDirectory: "D:\\Journal",
    backupDirectory: "C:\\Users\\me\\AppData\\Roaming\\tasken\\Backups",
  });
  assert.deepEqual(exceptions, [
    { kind: "sync", path: "C:\\Users\\me\\OneDrive\\TaskenSync" },
    { kind: "theme", path: "D:\\Projects\\A", themeId: "t1", themeName: "案件A" },
    { kind: "theme", path: "D:\\Customers\\B", themeId: "t2", themeName: "顧客B" },
    { kind: "activity", path: "D:\\Journal" },
    { kind: "backup", path: "C:\\Users\\me\\AppData\\Roaming\\tasken\\Backups" },
  ]);
});

test("例外の一覧: ルートの下の同期フォルダと {root}/Activity の日誌は例外にしない。控えは常に載る", () => {
  const exceptions = listTaskenRootExceptions({
    root: "C:\\Tasken",
    rootKind: "local",
    syncDirectory: "c:\\tasken\\Sync",
    themes: [],
    activityLogDirectory: "C:\\Tasken\\activity\\",
    backupDirectory: "C:\\Tasken\\Backups",
  });
  assert.deepEqual(exceptions, [{ kind: "backup", path: "C:\\Tasken\\Backups" }]);
});

test("例外の一覧: 控えがクラウドのルートの配下なら注意を付ける（local なら付けない）", () => {
  const input = {
    root: "C:\\Users\\me\\OneDrive\\Tasken",
    backupDirectory: "C:\\Users\\me\\OneDrive\\Tasken\\Backups",
  };
  assert.deepEqual(listTaskenRootExceptions({ ...input, rootKind: "cloud" }), [
    { kind: "backup", path: input.backupDirectory, warning: "backup_in_cloud_root" },
  ]);
  assert.deepEqual(listTaskenRootExceptions({ ...input, rootKind: "local" }), [
    { kind: "backup", path: input.backupDirectory },
  ]);
});

test("ルートが空で同期フォルダだけあれば、同期フォルダの親を候補にする", () => {
  assert.equal(
    taskenRootCandidate({ root: "", syncDirectory: "C:\\Users\\me\\OneDrive\\Tasken\\Sync" }),
    "C:\\Users\\me\\OneDrive\\Tasken",
  );
  assert.equal(taskenRootCandidate({ root: "C:\\Tasken", syncDirectory: "C:\\X\\Sync" }), null);
  assert.equal(taskenRootCandidate({ root: "", syncDirectory: "" }), null);
  assert.equal(parentDirectory("C:\\Sync"), "C:\\");
  assert.equal(parentDirectory("\\\\nas\\share\\Sync"), "\\\\nas\\share");
  assert.equal(parentDirectory("\\\\nas\\share"), "");
  assert.equal(parentDirectory("/srv/tasken/sync/"), "/srv/tasken");
});

test("同期フォルダのダイアログの初期位置は {root}/Sync", () => {
  assert.equal(syncFolderDefaultPath("C:\\Tasken\\"), "C:\\Tasken\\Sync");
  assert.equal(syncFolderDefaultPath("/srv/tasken"), "/srv/tasken/Sync");
  assert.equal(syncFolderDefaultPath(""), null);
});

test("目印の照らし方: 同期に参加する前は食い違いを注意にしない", () => {
  const marker = { schema: "tasken-root/v1", workspaceId: "ws-a", createdAt: "x" };
  assert.equal(
    compareTaskenRootMarker({ marker, workspaceId: "ws-a", workspaceSettled: true }),
    "ok",
  );
  assert.equal(
    compareTaskenRootMarker({ marker, workspaceId: "ws-b", workspaceSettled: true }),
    "mismatch",
  );
  assert.equal(
    compareTaskenRootMarker({ marker, workspaceId: "ws-b", workspaceSettled: false }),
    "unchecked",
  );
  assert.equal(compareTaskenRootMarker({ marker: null, workspaceId: "ws-a" }), "missing");
  assert.equal(
    compareTaskenRootMarker({ marker: { schema: "x" }, workspaceId: "ws-a" }),
    "invalid",
  );
});

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-root-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("目印: 無ければ書き、あれば別の Workspace のものでも書き換えない", (t) => {
  const root = tempDir(t);
  const now = () => new Date("2026-11-21T00:00:00.000Z");
  assert.deepEqual(ensureTaskenRootMarker({ root, workspaceId: "ws-a", now }), {
    status: "written",
  });
  const written = JSON.parse(fs.readFileSync(path.join(root, TASKEN_ROOT_MARKER), "utf8"));
  assert.deepEqual(written, {
    schema: "tasken-root/v1",
    workspaceId: "ws-a",
    createdAt: "2026-11-21T00:00:00.000Z",
  });
  assert.deepEqual(ensureTaskenRootMarker({ root, workspaceId: "ws-b", now }), {
    status: "present",
  });
  assert.equal(readTaskenRootMarker(root).marker.workspaceId, "ws-a");
  // 一時ファイルを残さない。
  assert.deepEqual(fs.readdirSync(root), [TASKEN_ROOT_MARKER]);
});

test("目印: 壊れた目印は上書きせず invalid として読む", (t) => {
  const root = tempDir(t);
  fs.writeFileSync(path.join(root, TASKEN_ROOT_MARKER), "{ not json");
  assert.equal(readTaskenRootMarker(root).state, "invalid");
  assert.equal(ensureTaskenRootMarker({ root, workspaceId: "ws-a" }).status, "present");
  assert.equal(fs.readFileSync(path.join(root, TASKEN_ROOT_MARKER), "utf8"), "{ not json");
});

test("目印: ルートのフォルダが無ければ作らずに失敗を返す（投げない）", (t) => {
  const root = path.join(tempDir(t), "missing");
  const result = ensureTaskenRootMarker({ root, workspaceId: "ws-a" });
  assert.equal(result.status, "failed");
  assert.ok(result.error);
  assert.equal(fs.existsSync(root), false);
});

test("目印: Workspace を引き継いだら、前の Workspace を指す目印だけ書き換える", (t) => {
  const root = tempDir(t);
  ensureTaskenRootMarker({
    root,
    workspaceId: "ws-old",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(
    rewriteTaskenRootMarkerWorkspace({ root, fromWorkspaceId: "ws-other", toWorkspaceId: "ws-new" })
      .status,
    "unchanged",
  );
  assert.equal(
    rewriteTaskenRootMarkerWorkspace({ root, fromWorkspaceId: "ws-old", toWorkspaceId: "ws-new" })
      .status,
    "rewritten",
  );
  assert.deepEqual(readTaskenRootMarker(root).marker, {
    schema: "tasken-root/v1",
    workspaceId: "ws-new",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

function fakeRepository(preferences, { workspaceId = "ws-a", themes = [] } = {}) {
  return {
    workspaceId,
    getPreference: (key) => preferences[key] ?? "",
    list: () => themes,
  };
}

test("状態: 書けなかった理由を Settings に出し、書けたら消す", (t) => {
  const base = tempDir(t);
  const root = path.join(base, "Tasken");
  const preferences = { artifactDirectory: root, taskenRootKind: "auto" };
  const logs = [];
  const service = new TaskenRootService({
    repository: fakeRepository(preferences),
    backupDirectory: () => path.join(base, "Backups"),
    env: {},
    log: (level) => logs.push(level),
  });
  assert.equal(service.ensureMarker().status, "failed");
  let status = service.status();
  assert.equal(status.marker.state, "missing");
  assert.ok(status.marker.error);
  assert.deepEqual(logs, ["warn"]);

  fs.mkdirSync(root);
  assert.equal(service.ensureMarker().status, "written");
  status = service.status();
  assert.equal(status.marker.state, "ok");
  assert.equal(status.marker.error, "");
  assert.equal(status.kind, "local");
  assert.equal(status.syncDefaultPath, path.join(root, "Sync"));
  assert.deepEqual(status.exceptions, [{ kind: "backup", path: path.join(base, "Backups") }]);
});

test("状態: 別の Workspace の目印は、同期に参加した端末でだけ食い違いとして出す", (t) => {
  const root = tempDir(t);
  ensureTaskenRootMarker({ root, workspaceId: "ws-other" });
  const preferences = { artifactDirectory: root, sharedSyncEnabled: false };
  const service = new TaskenRootService({
    repository: fakeRepository(preferences),
    backupDirectory: () => "",
    env: {},
  });
  assert.equal(service.status().marker.state, "unchecked");
  preferences.sharedSyncEnabled = true;
  preferences.sharedSyncDirectory = path.join(root, "Sync");
  assert.equal(service.status().marker.state, "mismatch");
  assert.equal(service.status().marker.workspaceId, "ws-other");
});

test("同期に参加して Workspace を引き継ぐと、ルートの目印も新しい Workspace に書き換わる", async (t) => {
  // DB を閉じてから消す（Windows は開いたままのファイルを消せない）。
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-root-test-"));
  const shared = path.join(base, "shared");
  const first = new WorkspaceDatabase(path.join(base, "first", "tasken.sqlite"));
  const second = new WorkspaceDatabase(path.join(base, "second", "tasken.sqlite"));
  t.after(() => {
    if (first.db.open) first.db.close();
    if (second.db.open) second.db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });
  const secondRoot = path.join(base, "second-root");
  fs.mkdirSync(secondRoot);
  second.setPreference("artifactDirectory", secondRoot);
  const secondRootService = new TaskenRootService({
    repository: second,
    backupDirectory: () => "",
    env: {},
  });
  // 参加前の新しい端末がルートを選んでも止まらない（目印は自分の仮の Workspace で書く）。
  assert.equal(secondRootService.ensureMarker().status, "written");
  const previousWorkspaceId = second.workspaceId;
  assert.equal(readTaskenRootMarker(secondRoot).marker.workspaceId, previousWorkspaceId);

  const firstSync = new SharedFolderSyncService(first, () => {}, "", "");
  const secondSync = new SharedFolderSyncService(second, () => {}, "", "", {
    onWorkspaceAdopted: (from, to) => secondRootService.workspaceAdopted(from, to),
  });
  await firstSync.configure(shared);
  await secondSync.configure(shared);
  await firstSync.stop();
  await secondSync.stop();

  assert.equal(second.workspaceId, first.workspaceId);
  assert.notEqual(previousWorkspaceId, first.workspaceId);
  assert.equal(readTaskenRootMarker(secondRoot).marker.workspaceId, first.workspaceId);
  assert.equal(secondRootService.status().marker.state, "ok");
});
