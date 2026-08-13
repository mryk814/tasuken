import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { createSnapshot, readSnapshot } from "../src/main/services/snapshotService.mjs";

const bundled = await build({
  entryPoints: [path.resolve("src/main/services/automaticSnapshotBackup.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { AutomaticSnapshotBackupService } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function fixture(t, workspace = { tasks: [{ id: "task-1", title: "守る対象", deleted_at: null }], meta: {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-auto-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let tick = 0;
  const service = new AutomaticSnapshotBackupService({
    repository: { loadWorkspace: () => workspace },
    defaultDirectory: path.join(root, "Backups"),
    directory: "",
    enabled: true,
    generations: 2,
    writeSnapshot: (currentWorkspace, filePath) => createSnapshot(currentWorkspace).writeZip(filePath),
    verifySnapshot: (filePath) => readSnapshot(filePath).workspace,
    now: () => new Date(`2026-08-13T01:02:0${tick++}.000Z`),
  });
  return { root, service };
}

test("automatic Snapshot writes atomically and retains only configured generations", (t) => {
  const { root, service } = fixture(t);
  const directory = path.join(root, "Backups");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "keep-me.zip"), "unmanaged");

  service.run("startup");
  service.run("startup");
  const status = service.run("startup");
  const files = fs.readdirSync(directory);

  assert.equal(status.lastError, "");
  assert.equal(status.backupCount, 2);
  assert.equal(files.filter((name) => name.startsWith("tasken-auto-")).length, 2);
  assert.equal(files.some((name) => name.endsWith(".tmp")), false);
  assert.equal(files.includes("keep-me.zip"), true);
  assert.equal(fs.statSync(status.latestFilePath).size > 0, true);
  assert.equal(readSnapshot(status.latestFilePath).workspace.tasks[0].title, "守る対象");
});

test("startup honors disabled state while manual backup remains available", (t) => {
  const { service } = fixture(t);
  service.configure({ enabled: false, directory: service.status().directory, generations: 5 });
  const skipped = service.run("startup");
  assert.match(skipped.skippedReason, /停止中/);
  assert.equal(skipped.backupCount, 0);
  const manual = service.run("manual");
  assert.equal(manual.lastError, "");
  assert.equal(manual.backupCount, 1);
});

test("empty workspaces are skipped and operational failures are reported without throwing", (t) => {
  const empty = fixture(t, { tasks: [], meta: {} });
  assert.match(empty.service.run("startup").skippedReason, /データがまだない/);

  const deleted = fixture(t, { tasks: [{ id: "deleted", deleted_at: "2026-08-12T00:00:00.000Z" }], meta: {} });
  assert.equal(deleted.service.run("startup").backupCount, 1);

  const blocked = fixture(t);
  const filePath = path.join(blocked.root, "not-a-directory");
  fs.writeFileSync(filePath, "blocked");
  blocked.service.configure({ enabled: true, directory: filePath, generations: 99 });
  const status = blocked.service.run("manual");
  assert.equal(status.generations, 20);
  assert.match(status.lastError, /保存先/);
});

test("corrupt new snapshots never replace a verified generation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-auto-snapshot-corrupt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "Backups");
  let writeCount = 0;
  let tick = 0;
  const service = new AutomaticSnapshotBackupService({
    repository: { loadWorkspace: () => ({ tasks: [{ id: "task-1", title: "復元対象" }], meta: {} }) },
    defaultDirectory: directory,
    directory,
    enabled: true,
    generations: 1,
    writeSnapshot: (workspace, filePath) => {
      if (writeCount++ === 0) createSnapshot(workspace).writeZip(filePath);
      else fs.writeFileSync(filePath, "broken snapshot");
    },
    verifySnapshot: (filePath) => readSnapshot(filePath).workspace,
    now: () => new Date(`2026-08-13T02:03:0${tick++}.000Z`),
  });

  const verified = service.run("startup");
  const verifiedPath = verified.latestFilePath;
  const failed = service.run("startup");

  assert.match(failed.lastError, /バックアップを作成できません/);
  assert.equal(failed.backupCount, 1);
  assert.equal(failed.latestFilePath, verifiedPath);
  assert.equal(readSnapshot(verifiedPath).workspace.tasks[0].title, "復元対象");
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith(".tmp")), false);
});
