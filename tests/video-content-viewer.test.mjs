import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { videoAvailabilityMessage, videoOwnerThemeIsSaved } from "../src/renderer/src/features/workspace/videoArtifactView.ts";

test("ContentViewer gives distinct unavailable reasons without exposing a path", () => {
  const expectedText = {
    missing: "見つかりません",
    changed: "変更されています",
    unsafe_source: "安全に確認できません",
    unsupported_codec: "内蔵decoderに対応していません",
  };
  for (const [availability, text] of Object.entries(expectedText)) {
    const message = videoAvailabilityMessage(availability);
    assert.match(message, new RegExp(text));
    assert.doesNotMatch(message, /[A-Z]:\\|stored_path|original_path|target/);
  }
});

test("video prepare requires the drawer Theme to be saved and commit is an explicit decision", () => {
  assert.equal(videoOwnerThemeIsSaved("theme-a", "theme-a"), true);
  assert.equal(videoOwnerThemeIsSaved("theme-b", "theme-a"), false);
  const source = fs.readFileSync("src/renderer/src/features/workspace/components/artifacts.tsx", "utf8");
  const pickBlock = source.slice(source.indexOf("async function pickVideo"), source.indexOf("async function discardPreparedVideo"));
  assert.match(pickBlock, /videoOwnerThemeIsSaved\(effectiveThemeId\(\)/);
  assert.match(pickBlock, /Themeの変更を先に保存/);
  assert.doesNotMatch(pickBlock, /await commitPreparedVideo\(result\)/);
  assert.match(source, />添付する<\/button>/);
  assert.match(source, /保存前プレビュー/);
  assert.match(source, />破棄<\/button>/);
});

test("ArtifactSection exposes compact loading, empty, error, and success states without a permanent empty panel", () => {
  const source = fs.readFileSync("src/renderer/src/features/workspace/components/artifacts.tsx", "utf8");
  assert.match(source, /const videoState = videoLoading \? "loading" : videoError \? "error" :[\s\S]*\? "success" : "empty"/);
  assert.match(source, /data-video-state=/);
  assert.match(source, /aria-busy=/);
  assert.match(source, /disabled=\{videoLoading \|\| importing/);
  assert.match(source, /保存待ち動画を確認中…/);
  assert.match(source, /保存待ち動画を確認できませんでした。/);
  assert.match(source, />一覧を再試行<\/button>/);
  assert.doesNotMatch(source, /保存待ち動画はありません/);
});

test("Focus Session attaches video to the active focus_session Note identity", () => {
  const source = fs.readFileSync("src/renderer/src/features/workspace/components/FocusSessionDialog.tsx", "utf8");
  assert.match(source, /session && <ArtifactSection[\s\S]*sourceType="note"[\s\S]*sourceId=\{session\.id\}/);
});

test("generic drag/drop rejects media by name before asking Electron for a raw path", () => {
  const source = fs.readFileSync("src/renderer/src/features/workspace/components/artifacts.tsx", "utf8");
  const block = source.slice(source.indexOf("async function importFiles"), source.indexOf("async function pickManagedFiles"));
  assert.match(block, /filter\(\(file\) => !isDedicatedMediaFileName\(file\.name\)\)[\s\S]*pathForFile/);
  assert.match(block, /専用の取り込み操作/);
});

test("video viewer inspects by ID, keeps race cancellation, and gates external-open to verified/codec errors", () => {
  const source = fs.readFileSync("src/renderer/src/features/workspace/components/ContentViewer.tsx", "utf8");
  const editor = fs.readFileSync("src/renderer/src/features/workspace/components/VideoTrimEditor.tsx", "utf8");
  const api = fs.readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");
  assert.match(source, /inspectMediaArtifact\(artifact\.id\)/);
  assert.match(api, /inspectArtifact\(\{ artifactId \}\)/);
  assert.match(source, /let cancelled = false[\s\S]*if \(!cancelled\) setLoad\(next\)[\s\S]*cancelled = true/);
  assert.match(source, /mediaAvailability === "available" \|\| load\.mediaAvailability === "unsupported_codec"/);
  assert.doesNotMatch(source, /mediaAvailability === "missing" \|\| load\.mediaAvailability === "changed"/);
  assert.match(editor, /<video[\s\S]*controls[\s\S]*preload="metadata"/);
  assert.match(source, /src: `tasken-media:\/\/artifact\/\$\{encodeURIComponent\(artifact\.id\)\}`/);
  assert.match(source, /const result = await workspaceApi\.openMediaArtifactExternal\(artifact\.id\)[\s\S]*if \(!result\.ok\) setToast\(result\.error[^\n]+"danger"\)/);
  assert.match(source, /if \(load\.status === "error"\) return load\.artifact/);
  assert.doesNotMatch(source, /onClick=\{\(\) => \{ void workspaceApi\.openMediaArtifactExternal/);
});

test("managed video viewer has one combined trim bar and writes a derived artifact", () => {
  const viewer = fs.readFileSync("src/renderer/src/features/workspace/components/ContentViewer.tsx", "utf8");
  const editor = fs.readFileSync("src/renderer/src/features/workspace/components/VideoTrimEditor.tsx", "utf8");
  const css = fs.readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(viewer, /<VideoTrimEditor[\s\S]*?editable=\{load\.artifact\.storage_mode !== "linked"\}/);
  assert.match(editor, /className="video-trim-track"/);
  assert.match(editor, /aria-label="トリム開始"/);
  assert.match(editor, /aria-label="トリム終了"/);
  assert.match(editor, /onPointerDown=\{seekFromTrack\}/);
  assert.match(editor, /onPlay=\{handlePlay\}/);
  assert.match(editor, /onSeeking=\{handleSeeking\}/);
  assert.match(editor, /範囲内をループ再生/);
  assert.match(editor, /handleEnded[\s\S]*?currentTarget\.play\(\)/);
  assert.match(editor, /createTrimPlan\(\{ source, startMs, endMs \}\)/);
  assert.match(editor, /exportVideoTrim\(\{[\s\S]*?destinationArtifactId: crypto\.randomUUID\(\)/);
  assert.match(editor, /元動画は変更していません/);
  assert.doesNotMatch(editor, /開始 [−+]0\.1s|終了 [−+]0\.1s/);
  assert.match(css, /\.video-trim-track/);
  assert.match(css, /\.video-trim-selection[\s\S]*?left: var\(--trim-start\)[\s\S]*?right: calc\(100% - var\(--trim-end\)\)/);
});
