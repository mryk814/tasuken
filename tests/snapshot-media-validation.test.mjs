import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";

import { build } from "esbuild";

const result = await build({
  entryPoints: [path.resolve("src/main/services/snapshotMediaValidation.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const validation = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-snapshot-media-"));
  const managedRoot = path.join(root, "managed");
  fs.mkdirSync(managedRoot);
  const managedPath = path.join(managedRoot, "managed.webm");
  const linkedPath = path.join(root, "linked.webm");
  const managedBytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("managed-video")]);
  const linkedBytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("linked-video")]);
  fs.writeFileSync(managedPath, managedBytes);
  fs.writeFileSync(linkedPath, linkedBytes);
  const linkedStat = fs.statSync(linkedPath);
  const workspace = {
    tasks: [{ id: "task-1", title: "Owner", state: "todo", project_id: null }],
    artifacts: [
      {
        id: "managed-video",
        title: "Managed",
        filename: "managed.webm",
        mime_type: "video/webm",
        file_size: managedBytes.length,
        stored_path: managedPath,
        target: null,
        storage_mode: "managed",
        source_type: "task",
        source_id: "task-1",
        theme_id: null,
        media_kind: "video",
        duration_ms: 500,
        width_px: 16,
        height_px: 16,
        container: "webm",
        content_hash: digest(managedBytes),
      },
      {
        id: "linked-video",
        title: "Linked",
        filename: "linked.webm",
        mime_type: "video/webm",
        file_size: linkedBytes.length,
        stored_path: "",
        target: linkedPath,
        storage_mode: "linked",
        source_type: "task",
        source_id: "task-1",
        theme_id: null,
        media_kind: "video",
        duration_ms: 500,
        width_px: 16,
        height_px: 16,
        container: "webm",
        content_hash: digest(linkedBytes),
        linked_source_real_path: fs.realpathSync.native(linkedPath),
        linked_source_device: String(linkedStat.dev),
        linked_source_inode: String(linkedStat.ino),
      },
    ],
  };
  const options = {
    repository: { get: () => null },
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedRoot }),
  };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, managedRoot, managedPath, linkedPath, workspace, options };
}

function copy(value) {
  return structuredClone(value);
}

test("Renderer bootstrap rejects inferred audio/video before its repository writer is called", () => {
  let writes = 0;
  const guardedBootstrap = (workspace) => {
    validation.assertRendererBootstrapContainsNoMedia(workspace);
    writes += 1;
  };
  guardedBootstrap({ artifacts: [{ id: "text", title: "Text", filename: "notes.txt" }] });
  assert.equal(writes, 1);
  for (const artifact of [
    { id: "audio", filename: "voice.wav" },
    { id: "video", filename: "evidence.mp4" },
    { id: "opaque", filename: "opaque.bin", mime_type: "video/webm" },
  ]) {
    assert.throws(() => guardedBootstrap({ artifacts: [artifact] }), /Media Artifact/);
  }
  assert.equal(writes, 1);
  const registerSource = fs.readFileSync("src/main/ipc/registerIpc.ts", "utf8");
  assert.match(
    registerSource,
    /workspaceBootstrap[\s\S]{0,180}assertRendererBootstrapContainsNoMedia\(legacy\)[\s\S]{0,120}repository\.bootstrap\(legacy\)/,
  );
});

test("managed and linked Media from a valid Snapshot pass strict metadata, owner, identity, size and hash validation", (t) => {
  const state = fixture(t);
  assert.doesNotThrow(() => validation.validateSnapshotMediaWorkspace(state.workspace, state.options));
});

test("Snapshot media validation fails closed with a path-free reason and apply writes zero", (t) => {
  const state = fixture(t);
  const cases = [
    ["hash", (workspace) => { workspace.artifacts[0].content_hash = `sha256:${"0".repeat(64)}`; }, /変更/],
    ["outside", (workspace) => { workspace.artifacts[0].stored_path = state.linkedPath; workspace.artifacts[0].content_hash = workspace.artifacts[1].content_hash; workspace.artifacts[0].file_size = workspace.artifacts[1].file_size; }, /保存範囲/],
    ["identity", (workspace) => { workspace.artifacts[1].linked_source_inode = "not-the-same-file"; }, /identity/],
    ["owner", (workspace) => { workspace.tasks[0].deleted_at = "2026-08-09T00:00:00.000Z"; }, /添付先/],
    ["mime", (workspace) => { workspace.artifacts[0].mime_type = "video/mp4"; }, /metadata/],
  ];
  for (const [label, mutate, message] of cases) {
    const workspace = copy(state.workspace);
    mutate(workspace);
    let writes = 0;
    assert.throws(() => {
      validation.validateSnapshotMediaWorkspace(workspace, state.options);
      writes += 1;
    }, (error) => {
      assert.match(String(error), message, label);
      assert.doesNotMatch(String(error), new RegExp(state.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), label);
      return true;
    });
    assert.equal(writes, 0, label);
  }
});

test("missing and non-regular Snapshot media are rejected, while deleted media remains restorable metadata", (t) => {
  const state = fixture(t);
  const missing = copy(state.workspace);
  missing.artifacts[1].target = path.join(state.root, "missing.webm");
  assert.throws(() => validation.validateSnapshotMediaWorkspace(missing, state.options), /見つかりません/);

  const nonRegular = copy(state.workspace);
  nonRegular.artifacts[1].target = state.root;
  nonRegular.artifacts[1].linked_source_real_path = fs.realpathSync.native(state.root);
  assert.throws(() => validation.validateSnapshotMediaWorkspace(nonRegular, state.options), /通常ファイル/);

  const deleted = copy(state.workspace);
  deleted.artifacts[0].deleted_at = "2026-08-09T00:00:00.000Z";
  deleted.artifacts[0].stored_path = path.join(state.root, "missing-deleted.webm");
  deleted.artifacts[1].deleted_at = "2026-08-09T00:00:00.000Z";
  deleted.artifacts[1].target = path.join(state.root, "missing-deleted-linked.webm");
  assert.doesNotThrow(() => validation.validateSnapshotMediaWorkspace(deleted, state.options));
});

test("WorkspaceService validates the same retained Snapshot before preview and immediately before apply", () => {
  const source = fs.readFileSync("src/main/services/workspaceService.ts", "utf8");
  assert.match(source, /readSnapshot\(result\.filePaths\[0\]\)[\s\S]{0,260}this\.validateSnapshotMedia\(parsed\.workspace\)[\s\S]{0,220}pendingSnapshots\.set/);
  assert.match(source, /applySnapshot\(token[\s\S]{0,360}this\.validateSnapshotMedia\(snapshot\)[\s\S]{0,180}repository\.applySnapshot/);
});
