import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const result = await build({
  entryPoints: [path.resolve("src/main/mediaCapturePersistence.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const boundary = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("generic artifact save and link reject audio/video inferred from extension or MIME", () => {
  const repository = { get: () => null };
  for (const entity of [
    { id: "new", filename: "voice.wav" },
    { id: "new", target: "C:\\recordings\\voice.mp3" },
    { id: "new", filename: "opaque.bin", mime_type: "audio/ogg" },
    { id: "new", filename: "voice.webm", media_kind: "audio" },
  ]) {
    assert.throws(() => boundary.normalizeMediaCapturePersistence(repository, "artifact", entity), /Inboxの音声取り込み/);
  }
  assert.throws(() => boundary.normalizeMediaCapturePersistence(repository, "artifact", { id: "video", filename: "clip.mp4" }), /専用の動画取り込み/);
});

test("existing and deleted media identities are carried forward by entitySave/saveMany normalization", () => {
  const current = {
    id: "audio", filename: "voice.wav", mime_type: "audio/wav", media_kind: "audio",
    stored_path: "C:\\private\\managed.wav", content_hash: "sha256:trusted", source_type: "capture_entry", source_id: "capture",
  };
  const repository = { get: (_type, _id, includeDeleted) => includeDeleted ? current : null };
  const normalized = boundary.normalizeMediaCapturePersistence(repository, "artifact", {
    id: "audio", title: "renamed", stored_path: "C:\\attacker.wav", content_hash: "sha256:evil", source_id: "other",
  });
  assert.equal(normalized.title, "renamed");
  assert.equal(normalized.stored_path, current.stored_path);
  assert.equal(normalized.content_hash, current.content_hash);
  assert.equal(normalized.source_id, current.source_id);
});

test("generic import, proposal, direct save and batch are wired to Media rejection boundaries", () => {
  const workspace = readFileSync("src/main/services/workspaceService.ts", "utf8");
  const ipc = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
  const commands = readFileSync("src/main/services/applicationCommandService.ts", "utf8");
  assert.match(workspace, /request\.files\)[\s\S]{0,220}rejectGenericAudioArtifact\(\{ filename: file\.name \|\| file\.path \}, "取り込み"\);[\s\S]{0,120}rejectGenericVideoArtifact\(\{ filename: file\.name \|\| file\.path \}, "取り込み"\)/);
  assert.match(workspace, /rejectGenericAudioArtifact\(\{ filename: normalized\.fileName, mime_type: normalized\.mediaType \}, "Proposal確定"\);[\s\S]{0,120}rejectGenericVideoArtifact\(\{ filename: normalized\.fileName, mime_type: normalized\.mediaType \}, "Proposal確定"\)/);
  assert.match(workspace, /chooseFiles[\s\S]{0,650}rejectGenericAudioArtifact\(\{ filename: filePath \}, "選択"\);[\s\S]{0,120}rejectGenericVideoArtifact\(\{ filename: filePath \}, "選択"\)/);
  assert.match(ipc, /normalizeMediaCapturePersistence\(repository, entityType, entity\)/);
  assert.match(ipc, /normalizeMediaCapturePersistence\(repository, type, value\.entity, "一括保存"\)/);
  assert.match(commands, /if \(type === "artifact"\) \{[\s\S]{0,180}rejectGenericAudioArtifact\(candidateEntity, "AI Proposal採用"\);[\s\S]{0,180}rejectGenericVideoArtifact\(candidateEntity, "AI Proposal採用"\);/);
});

test("bootstrap, remove and restore Renderer returns use media-safe projection", () => {
  const ipc = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
  assert.match(ipc, /workspaceBootstrap[\s\S]{0,180}assertRendererBootstrapContainsNoMedia\(legacy\);[\s\S]{0,120}projectWorkspaceForRenderer\(repository\.bootstrap\(legacy\)\)/);
  assert.match(ipc, /entityRemove[\s\S]{0,500}projectEntityForRenderer\(entityType, removed/);
  assert.match(ipc, /entityRestore[\s\S]{0,500}projectEntityForRenderer\(entityType, restored/);
});

test("managed media preserves personal Inbox semantics and normal Theme ID-marker rediscovery", () => {
  const workspace = readFileSync("src/main/services/workspaceService.ts", "utf8");
  assert.match(workspace, /!themeId \|\| themeId === PERSONAL_DEFAULT_THEME_ID[\s\S]{0,160}resolveThemeContentDirectory\(themeId, "artifacts"/);
  assert.match(workspace, /const discovered = discoverThemeAiPackLocation\(/);
  assert.match(workspace, /if \(discovered\.status !== "ok"\) throw new Error/);
  assert.match(workspace, /directory: path\.join\(themeFolder, "Artifacts"\)/);
});
