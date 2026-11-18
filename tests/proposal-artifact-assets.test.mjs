import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  entryPoints: [path.resolve("src/main/services/proposalArtifactAssets.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { ProposalArtifactAssetStore, createArtifactProposalAssetPort, detectAssetFormat } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG, "base64");
const GIF_BYTES = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(32, 1)]);
const MP4_BYTES = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.alloc(32, 2),
]);
const WEBM_BYTES = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32, 3)]);

function fixture(t) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-proposal-assets-"));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  return { store: new ProposalArtifactAssetStore(userDataPath), userDataPath };
}

function asset(reference_id, bytes, media_type, overrides = {}) {
  return {
    reference_id,
    file_name: `${reference_id}.bin`,
    media_type,
    data_base64: bytes.toString("base64"),
    ...overrides,
  };
}

const HTML =
  '<!doctype html><html><body><img src="tasken-upload://chart"><video src="tasken-upload://clip" controls></video></body></html>';

test("detects supported formats from magic bytes only", () => {
  assert.equal(detectAssetFormat(PNG_BYTES), "image/png");
  assert.equal(detectAssetFormat(GIF_BYTES), "image/gif");
  assert.equal(detectAssetFormat(MP4_BYTES), "video/mp4");
  assert.equal(detectAssetFormat(WEBM_BYTES), "video/webm");
  assert.equal(detectAssetFormat(Buffer.from("not media at all")), null);
});

test("prepares, stages, verifies, and inlines assets into a self-contained HTML", (t) => {
  const { store, userDataPath } = fixture(t);
  const prepared = store.prepare("proposal-assets-1", HTML, [
    asset("chart", PNG_BYTES, "image/png"),
    asset("clip", MP4_BYTES, "video/mp4"),
  ]);
  assert.equal(prepared.manifest.length, 2);
  assert.deepEqual(Object.keys(prepared.manifest[0]).sort(), [
    "file_name",
    "mime_type",
    "reference_id",
    "sha256",
    "size",
  ]);
  assert.doesNotMatch(JSON.stringify(prepared.manifest), /data_base64/);

  const staged = store.stage(prepared);
  assert.equal(staged.createdPaths.length, 2);
  for (const entry of prepared.manifest) {
    assert.equal(
      fs.existsSync(path.join(userDataPath, "attachments", "artifact-assets", entry.file_name)),
      true,
    );
  }
  assert.equal(store.verifyManifest("proposal-assets-1", prepared.manifest), true);

  const inlined = store.inlineAssets("proposal-assets-1", prepared.manifest, HTML);
  assert.doesNotMatch(inlined, /tasken-upload:/);
  assert.match(inlined, /data:image\/png;base64,/);
  assert.match(inlined, /data:video\/mp4;base64,/);

  const removed = store.discard("proposal-assets-1", prepared.manifest);
  assert.equal(removed.length, 2);
  assert.equal(
    fs.existsSync(
      path.join(userDataPath, "attachments", "artifact-assets", prepared.manifest[0].file_name),
    ),
    false,
  );
});

test("staging twice creates no duplicates and rollback removes only its own files", (t) => {
  const { store } = fixture(t);
  const prepared = store.prepare("proposal-assets-2", HTML, [
    asset("chart", PNG_BYTES, "image/png"),
    asset("clip", MP4_BYTES, "video/mp4"),
  ]);
  const first = store.stage(prepared);
  const second = store.stage(prepared);
  assert.equal(first.createdPaths.length, 2);
  assert.equal(second.createdPaths.length, 0);
  store.rollbackCreated(first.createdPaths);
  assert.throws(
    () => store.verifyManifest("proposal-assets-2", prepared.manifest),
    /見つかりません/,
  );
});

test("rejects mismatched, unreferenced, missing, and malformed assets", (t) => {
  const { store } = fixture(t);
  assert.throws(
    () =>
      store.prepare("p1", HTML, [
        asset("chart", PNG_BYTES, "image/jpeg"),
        asset("clip", MP4_BYTES, "video/mp4"),
      ]),
    /形式とファイル内容が一致していません/,
  );
  assert.throws(
    () =>
      store.prepare("p1", '<img src="tasken-upload://chart">', [
        asset("chart", PNG_BYTES, "image/png"),
        asset("extra", GIF_BYTES, "image/gif"),
      ]),
    /参照されていません/,
  );
  assert.throws(
    () => store.prepare("p1", HTML, [asset("chart", PNG_BYTES, "image/png")]),
    /対応するアセットがありません/,
  );
  assert.throws(
    () => store.prepare("p1", '<img src="tasken-upload://Chart_1">', []),
    /対応するデータがありません|形式が不正です/,
  );
  assert.throws(
    () =>
      store.prepare("p1", '<img src="tasken-upload://chart">', [
        asset("chart", PNG_BYTES, "image/png"),
        asset("chart", PNG_BYTES, "image/png"),
      ]),
    /重複しています/,
  );
  assert.throws(
    () => store.prepare("p1", '<img src="tasken-upload://chart">'),
    /対応するデータがありません/,
  );
});

test("verifyManifest detects a tampered staged file", (t) => {
  const { store, userDataPath } = fixture(t);
  const prepared = store.prepare("proposal-assets-3", '<img src="tasken-upload://chart">', [
    asset("chart", PNG_BYTES, "image/png"),
  ]);
  store.stage(prepared);
  const stagedPath = path.join(
    userDataPath,
    "attachments",
    "artifact-assets",
    prepared.manifest[0].file_name,
  );
  fs.writeFileSync(stagedPath, Buffer.from("tampered"));
  assert.throws(
    () => store.verifyManifest("proposal-assets-3", prepared.manifest),
    /変更されています/,
  );
});

test("the Core port stages on prepare+stage and rolls back only staged files", (t) => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-proposal-assets-port-"));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const port = createArtifactProposalAssetPort(userDataPath);
  const prepared = port.prepare({
    proposalId: "proposal-assets-4",
    content: '<img src="tasken-upload://chart">',
    assets: [asset("chart", PNG_BYTES, "image/png")],
  });
  assert.equal(prepared.manifest.length, 1);
  port.stage(prepared.prepared);
  const stagedPath = path.join(
    userDataPath,
    "attachments",
    "artifact-assets",
    prepared.manifest[0].file_name,
  );
  assert.equal(fs.existsSync(stagedPath), true);
  port.rollback(prepared.prepared);
  assert.equal(fs.existsSync(stagedPath), false);
});
