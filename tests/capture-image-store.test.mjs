import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  entryPoints: [path.resolve("src/main/services/captureImageStore.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { CaptureImageStore, validateCaptureImageManifest } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG, "base64");
const decodeFixtureImage = (bytes, mimeType) =>
  mimeType === "image/png" && bytes.equals(PNG_BYTES) ? { width: 1, height: 1 } : null;

function fixture(t) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-capture-images-"));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  return { userDataPath, store: new CaptureImageStore(userDataPath, decodeFixtureImage) };
}

function image(reference_id, data_base64 = PNG, overrides = {}) {
  return {
    reference_id,
    file_name: `${reference_id}.png`,
    media_type: "image/png",
    data_base64,
    ...overrides,
  };
}

test("stages capture images without retaining base64 or absolute paths", (t) => {
  const { store } = fixture(t);
  const staged = store.stage("capture-1", [image("photo")]);

  assert.equal(staged.manifest.length, 1);
  assert.deepEqual(Object.keys(staged.manifest[0]).sort(), [
    "file_name",
    "mime_type",
    "reference_id",
    "sha256",
    "size",
    "url",
  ]);
  assert.match(staged.manifest[0].file_name, /\.png$/);
  assert.match(staged.manifest[0].url, /^tasken-attachment:\/\/local\//);
  assert.doesNotMatch(JSON.stringify(staged.manifest), /data_base64|C:\\|tmpdir/);
  assert.equal(staged.createdPaths.length, 1);
  assert.equal(fs.existsSync(staged.createdPaths[0]), true);
  assert.deepEqual(store.read(staged.manifest[0].file_name), PNG_BYTES);
});

test("restaging the same command reuses files and stays idempotent", (t) => {
  const { store } = fixture(t);
  const first = store.stage("capture-retry", [image("photo")]);
  const second = store.stage("capture-retry", [image("photo")]);

  assert.deepEqual(second.manifest, first.manifest);
  assert.equal(second.createdPaths.length, 0);
});

test("rejects invalid base64, mismatched types, duplicates, and oversized input", (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.stage("capture-bad", [image("a", "!!!not-base64!!!")]), /base64/);
  assert.throws(
    () => store.stage("capture-mismatch", [image("a", PNG, { media_type: "image/jpeg" })]),
    /一致/,
  );
  assert.throws(() => store.stage("capture-dup", [image("a"), image("a")]), /重複/);
  assert.throws(
    () =>
      store.stage(
        "capture-many",
        Array.from({ length: 9 }, (_, index) => image(`i${index}`)),
      ),
    /1〜8枚/,
  );
  assert.throws(() => store.stage("capture-empty", []), /1〜8枚/);
  assert.throws(
    () => store.stage("capture-bytes", [image("a", PNG, { data_base64: PNG + PNG })]),
    /base64/,
  );
});

test("validateCaptureImageManifest rejects manifests that do not belong to the capture", () => {
  assert.throws(
    () =>
      validateCaptureImageManifest("capture-1", [
        {
          reference_id: "photo",
          file_name: "abcdef01-2345-6789-abcd-ef0123456789.png",
          mime_type: "image/png",
          size: 1,
          sha256: "0".repeat(64),
          url: "tasken-attachment://local/abcdef01-2345-6789-abcd-ef0123456789.png/x.png",
        },
      ]),
    /属していません/,
  );
});

test("validateCaptureImageManifest rejects foreign manifests and embedded base64", (t) => {
  const { store } = fixture(t);
  const staged = store.stage("capture-owned", [image("photo")]);
  assert.equal(validateCaptureImageManifest("capture-owned", staged.manifest).length, 1);
  assert.throws(
    () => validateCaptureImageManifest("capture-other", staged.manifest),
    /属していません/,
  );
  assert.throws(
    () => validateCaptureImageManifest("capture-owned", [image("photo")]),
    /stageしてください/,
  );
});

test("read rejects path traversal outside the capture directory", (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.read("../outside.png"), /不正/);
  assert.throws(() => store.read("missing.png"), /見つかりません/);
});
