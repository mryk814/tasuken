import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { build } from "esbuild";

async function importBundled(relativePath, stubElectron = false) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    plugins: stubElectron ? [{
      name: "electron-stub",
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "electron-stub" }));
        builder.onLoad({ filter: /.*/, namespace: "electron-stub" }, () => ({
          contents: "export const protocol = { registerSchemesAsPrivileged() {}, handle() {} };",
          loader: "js",
        }));
      },
    }] : [],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { MediaCaptureService } = await importBundled("src/main/services/mediaCaptureService.ts");
const { mediaResponse, parseMediaRange, parseMediaRequestTarget } = await importBundled("src/main/mediaProtocol.ts", true);

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function setup(t, bytes = Buffer.from("verified-original-audio")) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-media-protocol-"));
  const linkedPath = path.join(root, "linked.wav");
  const userDataPath = path.join(root, "user-data");
  const artifactId = randomUUID();
  fs.writeFileSync(linkedPath, bytes);
  const artifact = {
    id: artifactId,
    filename: "linked.wav",
    mime_type: "audio/wav",
    file_size: bytes.length,
    content_hash: hash(bytes),
    media_kind: "audio",
    storage_mode: "linked",
    target: linkedPath,
  };
  const openedPaths = [];
  const openedBytes = [];
  const onOpen = { callback: null };
  const service = new MediaCaptureService({
    userDataPath,
    repository: { get: (type, id) => type === "artifact" && id === artifactId ? artifact : null },
    commands: { executeMediaCapture: () => { throw new Error("unused"); } },
    resolveManagedDirectory: () => ({ kind: "needs_directory" }),
    openPath: async (filePath) => {
      onOpen.callback?.(filePath);
      openedPaths.push(filePath);
      openedBytes.push(fs.readFileSync(filePath));
      return "";
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, linkedPath, artifact, artifactId, service, bytes, openedPaths, openedBytes, onOpen };
}

test("Range parser accepts bounded and suffix requests and rejects multi-range", () => {
  assert.deepEqual(parseMediaRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseMediaRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.equal(parseMediaRange("bytes=0-1,4-5", 10), "invalid");
});

test("media URL accepts one exact UUID segment and rejects ambiguous authority or suffixes before resolution", () => {
  const id = "d8946cf2-290a-4f0f-88c4-cd78cfbf64d5";
  assert.deepEqual(parseMediaRequestTarget(`tasken-media://artifact/${id}`), { scope: "artifact", id });
  assert.deepEqual(parseMediaRequestTarget(`tasken-media://session/${id}`), { scope: "session", id });
  for (const candidate of [
    `tasken-media://user@artifact/${id}`,
    `tasken-media://artifact/${id}?download=1`,
    `tasken-media://artifact/${id}?`,
    `tasken-media://artifact/${id}#fragment`,
    `tasken-media://artifact/${id}#`,
    `tasken-media://artifact/${id}/extra`,
    `tasken-media://artifact/${id}%2fextra`,
    `tasken-media://artifact/${id}%5cextra`,
    "tasken-media://artifact/not-a-uuid",
    `tasken-media://artifact//${id}`,
  ]) assert.equal(parseMediaRequestTarget(candidate), null, candidate);
});

test("verified descriptor streams the verified inode even when linked path is replaced afterwards", async (t) => {
  const state = setup(t);
  const resolution = state.service.resolveArtifactMedia(state.artifactId);
  assert.equal(resolution.availability, "available");
  const originalPath = path.join(state.root, "opened-original.wav");
  try {
    fs.renameSync(state.linkedPath, originalPath);
    fs.writeFileSync(state.linkedPath, "unverified-replacement");
  } catch (error) {
    if (resolution.availability === "available") fs.closeSync(resolution.fileDescriptor);
    if (["EPERM", "EACCES"].includes(error?.code)) return t.skip("open-file path replacement is unavailable in this environment");
    throw error;
  }

  const response = mediaResponse(new Request("tasken-media://artifact/id"), resolution);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), state.bytes);
});

test("unchanged artifact hashes only once across repeated Range resolution and rehashes after mutation", (t) => {
  const state = setup(t, Buffer.from("same-version-audio"));
  const originalRead = fs.readSync;
  let reads = 0;
  fs.readSync = (...args) => {
    reads += 1;
    return originalRead(...args);
  };
  try {
    const first = state.service.resolveArtifactMedia(state.artifactId);
    assert.equal(first.availability, "available");
    fs.closeSync(first.fileDescriptor);
    const afterFirst = reads;
    const second = state.service.resolveArtifactMedia(state.artifactId);
    assert.equal(second.availability, "available");
    fs.closeSync(second.fileDescriptor);
    assert.equal(reads, afterFirst);
    fs.writeFileSync(state.linkedPath, Buffer.from("mutated-version!!"));
    const changed = state.service.resolveArtifactMedia(state.artifactId);
    assert.equal(changed.availability, "changed");
    assert.ok(reads > afterFirst);
  } finally {
    fs.readSync = originalRead;
  }
});

test("changed and symlinked linked media return zero bytes and no descriptor", async (t) => {
  const state = setup(t);
  fs.writeFileSync(state.linkedPath, "changed");
  const changed = state.service.resolveArtifactMedia(state.artifactId);
  assert.deepEqual(changed, { availability: "changed" });
  const changedResponse = mediaResponse(new Request("tasken-media://artifact/id"), changed);
  assert.equal(changedResponse.headers.get("content-length"), "0");
  assert.equal((await changedResponse.arrayBuffer()).byteLength, 0);

  const target = path.join(state.root, "secret.wav");
  fs.writeFileSync(target, state.bytes);
  fs.rmSync(state.linkedPath);
  try {
    fs.symlinkSync(target, state.linkedPath, "file");
  } catch (error) {
    if (error?.code === "EPERM") return t.skip("symlink creation is unavailable in this environment");
    throw error;
  }
  const unsafe = state.service.resolveArtifactMedia(state.artifactId);
  assert.deepEqual(unsafe, { availability: "unsafe_source" });
  const unsafeResponse = mediaResponse(new Request("tasken-media://artifact/id"), unsafe);
  assert.equal((await unsafeResponse.arrayBuffer()).byteLength, 0);
});

test("HEAD, invalid Range, and unsupported methods close the verified descriptor", (t) => {
  const state = setup(t);
  const requests = [
    new Request("tasken-media://artifact/id", { method: "HEAD" }),
    new Request("tasken-media://artifact/id", { headers: { range: "bytes=999-1000" } }),
    new Request("tasken-media://artifact/id", { method: "POST" }),
  ];
  const expectedStatuses = [200, 416, 405];
  requests.forEach((request, index) => {
    const resolution = state.service.resolveArtifactMedia(state.artifactId);
    assert.equal(resolution.availability, "available");
    const descriptor = resolution.fileDescriptor;
    const response = mediaResponse(request, resolution);
    assert.equal(response.status, expectedStatuses[index]);
    assert.throws(() => fs.fstatSync(descriptor), { code: "EBADF" });
  });
});

test("stream read error closes the handed-off descriptor", async (t) => {
  const state = setup(t);
  const descriptor = fs.openSync(state.linkedPath, "w");
  const response = mediaResponse(new Request("tasken-media://artifact/id"), {
    availability: "available",
    fileDescriptor: descriptor,
    mimeType: "audio/wav",
    fileSize: state.bytes.length,
  });

  await assert.rejects(() => response.arrayBuffer());
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => fs.fstatSync(descriptor), { code: "EBADF" });
});

test("ID-only external open permits verified unsupported codec bytes but rejects changed bytes", async (t) => {
  const state = setup(t);
  state.artifact.mime_type = "application/x-unknown-video-codec";
  assert.deepEqual(state.service.inspectArtifactMedia(state.artifactId), { availability: "unsupported_codec" });
  assert.deepEqual(await state.service.openArtifactExternally(state.artifactId), { ok: true });
  assert.equal(state.openedPaths.length, 1);
  assert.notEqual(state.openedPaths[0], state.linkedPath);
  assert.deepEqual(state.openedBytes[0], state.bytes);
  assert.equal(fs.existsSync(state.openedPaths[0]), true);
  assert.deepEqual(fs.readFileSync(state.openedPaths[0]), state.bytes);

  fs.writeFileSync(state.linkedPath, "changed-untrusted-bytes");
  assert.deepEqual(await state.service.openArtifactExternally(state.artifactId), {
    ok: false,
    error: "動画ファイルを安全に確認できません。保存場所または内容を確認してください。",
  });
  assert.equal(state.openedPaths.length, 1);
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
  fs.utimesSync(state.openedPaths[0], stale, stale);
  new MediaCaptureService({
    userDataPath: path.join(state.root, "user-data"),
    repository: { get: () => null },
    commands: { executeMediaCapture: () => { throw new Error("unused"); } },
    resolveManagedDirectory: () => ({ kind: "needs_directory" }),
  });
  assert.equal(fs.existsSync(state.openedPaths[0]), false);
});

test("recent external-open snapshots survive restart and shell exceptions return a safe failure", async (t) => {
  const state = setup(t);
  assert.deepEqual(await state.service.openArtifactExternally(state.artifactId), { ok: true });
  const snapshotPath = state.openedPaths[0];
  new MediaCaptureService({
    userDataPath: path.join(state.root, "user-data"),
    repository: { get: () => null },
    commands: { executeMediaCapture: () => { throw new Error("unused"); } },
    resolveManagedDirectory: () => ({ kind: "needs_directory" }),
  });
  assert.equal(fs.existsSync(snapshotPath), true);

  const throwing = new MediaCaptureService({
    userDataPath: path.join(state.root, "throwing-user-data"),
    repository: { get: (type, id) => type === "artifact" && id === state.artifactId ? state.artifact : null },
    commands: { executeMediaCapture: () => { throw new Error("unused"); } },
    resolveManagedDirectory: () => ({ kind: "needs_directory" }),
    openPath: async () => { throw new Error("shell unavailable"); },
  });
  assert.deepEqual(await throwing.openArtifactExternally(state.artifactId), {
    ok: false,
    error: "外部アプリで動画を開けませんでした。関連付けを確認してください。",
  });
});

test("external open hands shell a verified private snapshot when linked path is swapped after verification", async (t) => {
  const state = setup(t);
  const moved = path.join(state.root, "verified-original.wav");
  state.onOpen.callback = () => {
    fs.renameSync(state.linkedPath, moved);
    fs.writeFileSync(state.linkedPath, "replacement-must-not-open");
  };
  assert.deepEqual(await state.service.openArtifactExternally(state.artifactId), { ok: true });
  assert.notEqual(state.openedPaths[0], state.linkedPath);
  assert.deepEqual(state.openedBytes[0], state.bytes);
  assert.deepEqual(fs.readFileSync(state.openedPaths[0]), state.bytes);
  assert.equal(fs.readFileSync(state.linkedPath, "utf8"), "replacement-must-not-open");
});
