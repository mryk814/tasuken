import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { build } from "esbuild";

import {
  WorkspaceDatabase,
  inspectWorkspaceBackup,
} from "../src/main/repositories/workspaceRepository.mjs";

const bundled = await build({
  entryPoints: [path.resolve("src/main/services/automaticSnapshotBackup.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { AutomaticSnapshotBackupService } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function databasePort(repository) {
  return {
    entityCount: () => repository.entityCount(),
    backupTo: (filePath, shouldAbort) => repository.backupTo(filePath, shouldAbort),
    inspectBackup: (filePath) => inspectWorkspaceBackup(filePath),
  };
}

function fixture(t, { seed = true, generations = 2, database } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-auto-backup-"));
  const repository = new WorkspaceDatabase(path.join(root, "data", "research-desk.sqlite"));
  t.after(() => {
    repository.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  if (seed) repository.save("task", { id: "task-1", title: "守る対象", state: "todo" });
  let tick = 0;
  const service = new AutomaticSnapshotBackupService({
    database: database?.(repository) || databasePort(repository),
    defaultDirectory: path.join(root, "Backups"),
    directory: "",
    enabled: true,
    generations,
    now: () => new Date(`2026-08-13T01:02:${String(tick++).padStart(2, "0")}.000Z`),
  });
  return { root, repository, service, directory: path.join(root, "Backups") };
}

function titleIn(filePath, id) {
  const copy = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const row = copy
      .prepare("SELECT data_json FROM entities WHERE entity_type = 'task' AND id = ?")
      .get(id);
    return row ? JSON.parse(row.data_json).title : null;
  } finally {
    copy.close();
  }
}

test("自動バックアップはSQLiteの写しを確かめてから置き、設定した世代だけ残す", async (t) => {
  const { service, directory } = fixture(t);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "keep-me.zip"), "unmanaged");
  // 以前の形式（ZIP）の世代は数えず、消さない。
  const legacy = "tasken-auto-20261006T153704129Z-afda3365.zip";
  fs.writeFileSync(path.join(directory, legacy), "legacy snapshot");

  await service.run("startup");
  await service.run("startup");
  const status = await service.run("startup");
  const files = fs.readdirSync(directory);

  assert.equal(status.lastError, "");
  assert.equal(status.backupCount, 2);
  assert.equal(files.filter((name) => /^tasken-auto-.*\.sqlite$/.test(name)).length, 2);
  assert.equal(
    files.some((name) => name.includes(".tmp")),
    false,
  );
  // rollback journalの単体ファイルにしてあるので、-wal / -shm が並ばない。
  assert.equal(
    files.some((name) => /-(wal|shm|journal)$/.test(name)),
    false,
  );
  assert.equal(files.includes("keep-me.zip"), true);
  assert.equal(files.includes(legacy), true);
  assert.equal(titleIn(status.latestFilePath, "task-1"), "守る対象");
});

test("変更履歴が大きくてもバックアップできる（ZIPの1ファイル10MB上限で毎回失敗していた）", async (t) => {
  const { repository, service } = fixture(t, { generations: 1 });
  const body = "x".repeat(120_000);
  repository.saveMany(
    Array.from({ length: 100 }, (_, index) => ({
      action: "save",
      type: "note",
      entity: { id: `note-${index}`, title: `note ${index}`, body_markdown: body },
    })),
  );
  const status = await service.run("manual");
  assert.equal(status.lastError, "");
  assert.equal(status.backupCount, 1);
  assert.equal(inspectWorkspaceBackup(status.latestFilePath).entityCount, repository.entityCount());
  assert.ok(fs.statSync(status.latestFilePath).size > 10 * 1024 * 1024);
});

test("起動時は停止中なら作らず、手動では作れる。実行中の2回目は同じ結果を待つ", async (t) => {
  const { service } = fixture(t);
  service.configure({ enabled: false, directory: service.status().directory, generations: 5 });
  const skipped = await service.run("startup");
  assert.match(skipped.skippedReason, /停止中/);
  assert.equal(skipped.backupCount, 0);
  const [first, second] = await Promise.all([service.run("manual"), service.run("manual")]);
  assert.equal(first.lastError, "");
  assert.equal(second.backupCount, 1);
});

test("空の作業台は保存せず、保存先の失敗は投げずに報告する", async (t) => {
  const empty = fixture(t, { seed: false });
  assert.match((await empty.service.run("startup")).skippedReason, /データがまだない/);

  const deleted = fixture(t);
  deleted.repository.remove("task", "task-1");
  assert.equal((await deleted.service.run("startup")).backupCount, 1);

  const blocked = fixture(t);
  const filePath = path.join(blocked.root, "not-a-directory");
  fs.writeFileSync(filePath, "blocked");
  blocked.service.configure({ enabled: true, directory: filePath, generations: 99 });
  const status = await blocked.service.run("manual");
  assert.equal(status.generations, 20);
  assert.match(status.lastError, /保存先/);
});

test("確かめられない写しは、確かめ済みの世代を置き換えない", async (t) => {
  let backups = 0;
  const { service, directory } = fixture(t, {
    generations: 1,
    database: (repository) => ({
      ...databasePort(repository),
      backupTo: async (filePath, shouldAbort) => {
        if (backups++ === 0) return repository.backupTo(filePath, shouldAbort);
        fs.writeFileSync(filePath, "broken backup");
      },
    }),
  });

  const verified = await service.run("startup");
  const failed = await service.run("startup");

  assert.match(failed.lastError, /バックアップを作成できません/);
  assert.equal(failed.backupCount, 1);
  assert.equal(failed.latestFilePath, verified.latestFilePath);
  assert.equal(titleIn(verified.latestFilePath, "task-1"), "守る対象");
  assert.equal(
    fs.readdirSync(directory).some((name) => name.includes(".tmp")),
    false,
  );
});

test("終了時のcancelは作成途中の写しを止めて片付け、前回の作りかけも次の実行で消す", async (t) => {
  let release;
  const started = new Promise((resolve) => {
    release = resolve;
  });
  const { service, directory } = fixture(t, {
    database: (repository) => ({
      ...databasePort(repository),
      backupTo: async (filePath, shouldAbort) => {
        fs.writeFileSync(filePath, "partial");
        fs.writeFileSync(`${filePath}-journal`, "partial");
        release();
        while (!shouldAbort()) await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("バックアップを中止しました。");
      },
    }),
  });
  fs.mkdirSync(directory, { recursive: true });
  const stale = ".tasken-auto-20261101T000000000Z-0123abcd.sqlite.tmp";
  fs.writeFileSync(path.join(directory, stale), "left by a crash");
  fs.writeFileSync(path.join(directory, `${stale}-journal`), "left by a crash");

  const running = service.run("startup");
  await started;
  assert.equal(fs.existsSync(path.join(directory, stale)), false);
  await service.cancel();
  const status = await running;

  assert.match(status.skippedReason, /中止/);
  assert.equal(status.lastError, "");
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("自動バックアップの写しから、消したTaskを差分プレビュー経由で今のDBへ戻せる", async (t) => {
  const { repository, service } = fixture(t);
  const backup = await service.run("manual");
  const sequence = () => Number(repository.ensureMeta("sync_device_sequence", "0"));
  const sequenceBefore = sequence();
  repository.remove("task", "task-1");
  assert.equal(repository.get("task", "task-1"), null);

  const { manifest, workspace } = repository.readBackupSnapshot(backup.latestFilePath);
  assert.equal(manifest.source, "automatic-backup");
  assert.equal(manifest.workspaceId, repository.workspaceId);
  const change = repository.previewSnapshot(workspace).find((entry) => entry.key === "task:task-1");
  assert.equal(change.category, "local_newer");
  repository.applySnapshot(workspace, { [change.key]: "update" }, workspace.plan_revisions);

  assert.equal(repository.get("task", "task-1")?.title, "守る対象");
  // 正本のファイルを置き換えないので、端末間同期の通し番号は巻き戻らない。
  assert.ok(sequence() > sequenceBefore);
});
