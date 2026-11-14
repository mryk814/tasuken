import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import {
  WorkspaceDatabase,
  inspectWorkspaceBackup,
  prepareRestoredCopy,
} from "../src/main/repositories/workspaceRepository.mjs";
import {
  SharedFolderSyncService,
  SYNC_PACKET_FILE_PATTERN,
} from "../src/main/services/sharedFolderSync.mjs";

async function load(entry) {
  const bundled = await build({
    entryPoints: [path.resolve(entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
}

const { AutomaticSnapshotBackupService } = await load(
  "src/main/services/automaticSnapshotBackup.ts",
);
const { applyPendingRestore, cancelStagedRestore, listBackups, readRestoreOutcome, stageRestore } =
  await load("src/main/services/workspaceRestore.ts");

const DATABASE = "research-desk.sqlite";

/** 一時の userData に、記録と添付のある作業台を作る。 */
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-restore-"));
  const userData = path.join(root, "userData");
  const backups = path.join(root, "Backups");
  const state = { repository: new WorkspaceDatabase(path.join(userData, DATABASE)) };
  t.after(() => {
    if (state.repository?.db.open) state.repository.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const attachment = (directory, name) => path.join(userData, "attachments", directory, name);
  const writeAttachment = (directory, name, content) => {
    fs.mkdirSync(path.dirname(attachment(directory, name)), { recursive: true });
    fs.writeFileSync(attachment(directory, name), content);
  };
  const database = () => ({
    entityCount: () => state.repository.entityCount(),
    userEntityCount: () => state.repository.userEntityCount(),
    workspaceId: () => state.repository.workspaceId,
    backupTo: (filePath, shouldAbort) => state.repository.backupTo(filePath, shouldAbort),
    inspectBackup: (filePath) => inspectWorkspaceBackup(filePath),
  });
  let tick = 0;
  const now = () => new Date(`2026-11-14T01:02:${String(tick++).padStart(2, "0")}.000Z`);
  return {
    root,
    userData,
    backups,
    state,
    attachment,
    writeAttachment,
    now,
    /** 「控えを今すぐ作る」と同じ道。 */
    async backup() {
      const service = new AutomaticSnapshotBackupService({
        database: database(),
        defaultDirectory: backups,
        attachmentDirectory: path.join(userData, "attachments"),
        directory: "",
        enabled: true,
        generations: 5,
        now,
      });
      const status = await service.run("manual");
      assert.equal(status.lastError, "");
      return status.latestFilePath;
    },
    stage(sourcePath) {
      return stageRestore({
        userDataPath: userData,
        sourcePath,
        backupDirectory: backups,
        database: database(),
        inspect: inspectWorkspaceBackup,
        prepare: prepareRestoredCopy,
        now,
      });
    },
    /** アプリの終了。 */
    quit() {
      state.repository.db.close();
    },
    /** 次の起動の最初（DBを開く前）。 */
    apply(extra = {}) {
      return applyPendingRestore({
        userDataPath: userData,
        inspect: inspectWorkspaceBackup,
        now,
        ...extra,
      });
    },
    /** 起動してDBを開く。 */
    open() {
      state.repository = new WorkspaceDatabase(path.join(userData, DATABASE));
      return state.repository;
    },
  };
}

function seed(ws) {
  ws.state.repository.save("note", { id: "note-1", title: "控えた時のノート", body_markdown: "a" });
  ws.state.repository.save("note", { id: "note-2", title: "後で消すノート", body_markdown: "b" });
  ws.state.repository.save("task", { id: "task-1", title: "控えた時のTask", state: "todo" });
  ws.writeAttachment("markdown-images", "11111111-1111-4111-8111-111111111111.png", "note image");
  ws.writeAttachment("capture-images", "capture-1-photo.jpg", "captured photo");
}

function ids(repository, type) {
  return repository
    .list(type, true)
    .map((entity) => entity.id)
    .sort();
}

test("控えから戻すと、再起動の後に件数と添付が控えた時と一致し、戻す前の控えが残る", async (t) => {
  const ws = workspace(t);
  seed(ws);
  const countAtBackup = ws.state.repository.entityCount();
  const noteIdsAtBackup = ids(ws.state.repository, "note");
  const backupPath = await ws.backup();
  // 添付は保存先の attachments/ に控えてある。
  assert.equal(
    fs.readFileSync(path.join(ws.backups, "attachments", "capture-images", "capture-1-photo.jpg"), {
      encoding: "utf8",
    }),
    "captured photo",
  );

  // 控えた後に、記録を足す・消す。添付も足す・失う。
  ws.state.repository.save("note", { id: "note-3", title: "控えの後に足した", body_markdown: "c" });
  ws.state.repository.remove("note", "note-2");
  ws.state.repository.save("task", { id: "task-1", title: "控えの後に変えた", state: "done" });
  ws.writeAttachment("markdown-images", "22222222-2222-4222-8222-222222222222.png", "added later");
  fs.rmSync(ws.attachment("capture-images", "capture-1-photo.jpg"));
  const countBeforeRestore = ws.state.repository.entityCount();
  assert.notEqual(countBeforeRestore, countAtBackup);

  const plan = await ws.stage(backupPath);
  // 準備の段では、今のDBは変わらない。
  assert.equal(ws.state.repository.entityCount(), countBeforeRestore);
  assert.equal(ws.state.repository.get("note", "note-3").title, "控えの後に足した");
  assert.equal(plan.entityCount, countAtBackup);
  assert.equal(plan.attachmentsInBackup, true);

  ws.quit();
  const outcome = ws.apply();
  assert.equal(outcome.status, "restored");
  assert.equal(outcome.entityCount, countAtBackup);
  assert.equal(outcome.error, "");
  assert.deepEqual(readRestoreOutcome(ws.userData), outcome);

  const restored = ws.open();
  assert.equal(restored.entityCount(), countAtBackup);
  assert.deepEqual(ids(restored, "note"), noteIdsAtBackup);
  assert.equal(restored.get("note", "note-2").deleted_at, null);
  assert.equal(restored.get("note", "note-3"), null);
  assert.equal(restored.get("task", "task-1").title, "控えた時のTask");
  // 失った添付が戻る。控えの後に足した添付は消さない。
  assert.equal(
    fs.readFileSync(ws.attachment("capture-images", "capture-1-photo.jpg"), "utf8"),
    "captured photo",
  );
  assert.equal(
    fs.readFileSync(
      ws.attachment("markdown-images", "11111111-1111-4111-8111-111111111111.png"),
      "utf8",
    ),
    "note image",
  );
  assert.equal(
    fs.existsSync(ws.attachment("markdown-images", "22222222-2222-4222-8222-222222222222.png")),
    true,
  );

  // 戻す前の控えが残り、戻す直前の状態（足したノート）を持っている。
  assert.match(path.basename(outcome.previousBackupPath), /^tasken-before-restore-.*\.sqlite$/);
  assert.equal(inspectWorkspaceBackup(outcome.previousBackupPath).entityCount, countBeforeRestore);
  const before = new WorkspaceDatabase(outcome.previousBackupPath);
  try {
    assert.equal(before.get("note", "note-3").title, "控えの後に足した");
  } finally {
    before.db.close();
  }
  // 戻す前の控えは、自動バックアップの世代に数えない（入れ替えで消えない）。一覧には出る。
  assert.deepEqual(
    listBackups(ws.backups).map((entry) => entry.kind),
    ["before-restore", "auto"],
  );
  // 作業用のファイルを残さない。
  assert.deepEqual(
    fs.readdirSync(ws.userData).filter((name) => /restore-(staged|replaced|plan)/.test(name)),
    [],
  );
});

test("壊れた控え・Taskenの控えでないファイルは準備で断り、今のDBは失われない", async (t) => {
  const ws = workspace(t);
  seed(ws);
  const backupPath = await ws.backup();
  const count = ws.state.repository.entityCount();

  const notSqlite = path.join(ws.root, "not-a-backup.sqlite");
  fs.writeFileSync(notSqlite, "this is not sqlite");
  // 途中で切れた写し（コピーが途中で止まった）。
  const truncated = path.join(ws.root, "truncated.sqlite");
  const bytes = fs.readFileSync(backupPath);
  fs.writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)));

  for (const broken of [notSqlite, truncated, path.join(ws.root, "missing.sqlite")]) {
    await assert.rejects(ws.stage(broken));
    assert.equal(ws.state.repository.entityCount(), count);
    assert.deepEqual(
      fs.readdirSync(ws.userData).filter((name) => /restore-(staged|plan)/.test(name)),
      [],
    );
  }
  // 今使っているDBそのものも選べない。
  await assert.rejects(ws.stage(path.join(ws.userData, DATABASE)), /控えとして選べません/);

  // 予定が無いので、次の起動は何もしない。
  ws.quit();
  assert.equal(ws.apply(), null);
  assert.equal(ws.open().entityCount(), count);
  assert.equal(ws.state.repository.get("note", "note-1").title, "控えた時のノート");
});

test("今のDBを控えられない時は、戻さない", async (t) => {
  const ws = workspace(t);
  seed(ws);
  const backupPath = await ws.backup();
  const failing = {
    entityCount: () => ws.state.repository.entityCount(),
    userEntityCount: () => ws.state.repository.userEntityCount(),
    backupTo: async () => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    },
  };
  await assert.rejects(
    stageRestore({
      userDataPath: ws.userData,
      sourcePath: backupPath,
      backupDirectory: ws.backups,
      database: failing,
      inspect: inspectWorkspaceBackup,
      prepare: prepareRestoredCopy,
    }),
    /今のデータを控えられなかった/,
  );
  ws.quit();
  assert.equal(ws.apply(), null);
});

for (const step of ["set-aside", "place", "verify"]) {
  test(`差し替えの途中（${step}）で失敗しても、今のDBが元の名前で残る`, async (t) => {
    const ws = workspace(t);
    seed(ws);
    const backupPath = await ws.backup();
    ws.state.repository.save("note", { id: "note-3", title: "控えの後に足した" });
    const count = ws.state.repository.entityCount();
    await ws.stage(backupPath);
    ws.quit();

    const outcome = ws.apply({
      beforeStep: (current) => {
        if (current === step) throw new Error(`injected failure at ${step}`);
      },
    });
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error, /データは戻す前のままです/);

    const reopened = ws.open();
    assert.equal(reopened.entityCount(), count);
    assert.equal(reopened.get("note", "note-3").title, "控えの後に足した");
    assert.deepEqual(
      fs.readdirSync(ws.userData).filter((name) => /restore-(staged|replaced|plan)/.test(name)),
      [],
    );
    // 失敗の後の起動では、もう差し替えない。
    reopened.db.close();
    assert.equal(ws.apply(), null);
    ws.open();
  });
}

test("準備の後に写しが壊れたら差し替えず、今のDBが残る", async (t) => {
  const ws = workspace(t);
  seed(ws);
  const backupPath = await ws.backup();
  ws.state.repository.save("note", { id: "note-3", title: "控えの後に足した" });
  const count = ws.state.repository.entityCount();
  await ws.stage(backupPath);
  ws.quit();
  fs.writeFileSync(path.join(ws.userData, `${DATABASE}.restore-staged`), "corrupted");

  assert.equal(ws.apply().status, "failed");
  assert.equal(ws.open().entityCount(), count);
});

test("差し替えの途中でプロセスが止まっても、次の起動でやり直して戻せる", async (t) => {
  const ws = workspace(t);
  seed(ws);
  const countAtBackup = ws.state.repository.entityCount();
  const backupPath = await ws.backup();
  ws.state.repository.save("note", { id: "note-3", title: "控えの後に足した" });
  await ws.stage(backupPath);
  ws.quit();
  // 正本を退けた直後（写しを置く前）に止まった状況。
  const live = path.join(ws.userData, DATABASE);
  fs.renameSync(live, `${live}.restore-replaced`);

  assert.equal(ws.apply().status, "restored");
  assert.equal(ws.open().entityCount(), countAtBackup);
});

test("写しを置いた後・片付ける前に止まっても、古いDBを上へ戻さない", async (t) => {
  const ws = workspace(t);
  seed(ws);
  const countAtBackup = ws.state.repository.entityCount();
  const backupPath = await ws.backup();
  ws.state.repository.save("note", { id: "note-3", title: "控えの後に足した" });
  await ws.stage(backupPath);
  ws.quit();
  const live = path.join(ws.userData, DATABASE);
  fs.renameSync(live, `${live}.restore-replaced`);
  fs.renameSync(`${live}.restore-staged`, live);

  assert.equal(ws.apply().status, "restored");
  const restored = ws.open();
  assert.equal(restored.entityCount(), countAtBackup);
  assert.equal(restored.get("note", "note-3"), null);
  assert.equal(fs.existsSync(`${live}.restore-replaced`), false);
});

test("戻すのを取りやめると、次の起動で差し替わらない", async (t) => {
  const ws = workspace(t);
  seed(ws);
  const backupPath = await ws.backup();
  ws.state.repository.save("note", { id: "note-3", title: "控えの後に足した" });
  const count = ws.state.repository.entityCount();
  await ws.stage(backupPath);
  cancelStagedRestore(ws.userData);
  ws.quit();
  assert.equal(ws.apply(), null);
  assert.equal(ws.open().entityCount(), count);
});

test("空の作業台（新しい端末）へ戻す時は、戻す前の控えを作らない", async (t) => {
  const source = workspace(t);
  seed(source);
  const count = source.state.repository.entityCount();
  const backupPath = await source.backup();

  const target = workspace(t);
  target.state.repository.ensurePersonalDefaultTheme?.();
  const plan = await target.stage(backupPath);
  assert.equal(plan.previousBackupPath, "");
  target.quit();
  assert.equal(target.apply().status, "restored");
  const moved = target.open();
  assert.equal(moved.entityCount(), count);
  // 控えの隣の添付も一緒に移る。
  assert.equal(
    fs.readFileSync(target.attachment("capture-images", "capture-1-photo.jpg"), "utf8"),
    "captured photo",
  );
});

test("同期している端末で控えから戻すと、同期が止まる。古い写しのまま再開しても公開しない", async (t) => {
  const ws = workspace(t);
  seed(ws);
  const shared = path.join(ws.root, "shared");
  const syncFor = (repository) =>
    new SharedFolderSyncService(
      repository,
      () => {},
      path.join(ws.userData, "attachments", "markdown-images"),
      path.join(ws.userData, "attachments", "capture-images"),
    );
  await syncFor(ws.state.repository).configure(shared);
  const backupPath = await ws.backup();
  // 控えの後の変更も、共有フォルダへ公開済み。
  ws.state.repository.save("task", { id: "task-2", title: "控えの後に公開した", state: "todo" });
  await syncFor(ws.state.repository).syncNow();
  const deviceDirectory = path.join(shared, "devices", ws.state.repository.deviceId);
  const published = () =>
    fs
      .readdirSync(deviceDirectory)
      .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
      .sort();
  const publishedBefore = published();

  const plan = await ws.stage(backupPath);
  assert.equal(plan.syncWasEnabled, true);
  // 準備の段では、動いているDBの同期は止めない（戻すのを取りやめられる）。
  assert.equal(ws.state.repository.getPreference("sharedSyncEnabled"), true);
  ws.quit();
  const outcome = ws.apply();
  assert.equal(outcome.status, "restored");
  assert.equal(outcome.syncStopped, true);

  const restored = ws.open();
  assert.equal(restored.getPreference("sharedSyncEnabled"), false);
  // 同期フォルダの場所は覚えたまま（本人が再開を決められる）。
  assert.equal(restored.getPreference("sharedSyncDirectory"), shared);
  const sync = syncFor(restored);
  restored.save("task", { id: "task-3", title: "戻した後の変更", state: "todo" });
  assert.equal((await sync.syncNow()).state, "off");
  assert.deepEqual(published(), publishedBefore);

  // 古い写しのまま同期を再開しても、連番が重なる前に止まる（NASのnodeと同じ守り）。
  await assert.rejects(sync.configure(shared), (error) => {
    assert.equal(error.code, "SYNC_SEQUENCE_ROLLBACK");
    assert.match(error.message, /空の端末として/);
    return true;
  });
  assert.equal(sync.isPublishBlocked(), true);
  assert.deepEqual(published(), publishedBefore);
});
