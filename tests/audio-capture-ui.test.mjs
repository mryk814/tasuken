import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inbox = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
const viewer = readFileSync("src/renderer/src/features/workspace/components/ContentViewer.tsx", "utf8");

test("Inbox keeps Memo primary while exposing audio import as a secondary action", () => {
  assert.match(inbox, /<Button variant="secondary"[\s\S]*?captureAudio\(\)/);
  assert.match(inbox, /<IconVolume size=\{16\} \/>音声を取り込む/);
  assert.match(inbox, /<Button variant="primary" onClick=\{addMemo\}><IconPlus size=\{16\} \/>Memo<\/Button>/);
});

test("Inbox prepared audio has explicit loading, error, preview, commit and discard states", () => {
  assert.match(inbox, /preparedAudioState === "loading"/);
  assert.match(inbox, /role="status">保存待ち音声を確認しています/);
  assert.match(inbox, /preparedAudioState === "error"/);
  assert.match(inbox, /role="alert"/);
  assert.match(inbox, /onClick=\{\(\) => \{ void refreshPreparedAudio\(\); \}\}>一覧を再試行/);
  assert.match(inbox, /preparedAudioState === "ready" && preparedAudio\.length === 0/);
  assert.match(inbox, /role="status">保存待ち音声はありません/);
  assert.match(inbox, /aria-label=\{`\$\{prepared\.filename\}の保存前プレビュー`\}/);
  assert.match(inbox, /commitPreparedAudio\(prepared\)/);
  assert.match(inbox, /discardPreparedAudio\(prepared\)/);
});

test("saved audio uses one metadata-rich button in untriaged and processed Inbox rows", () => {
  assert.equal((inbox.match(/<CapturedArtifactButton key=/g) || []).length, 2);
  assert.match(inbox, /IconVolume size=\{14\}/);
  assert.match(inbox, /formatMediaDuration\(artifact\.duration_ms\)/);
  assert.match(inbox, /formatArtifactFileSize\(artifact\.file_size\)/);
  assert.match(inbox, /TRANSCRIPTION_STATUS_LABELS\[transcription\]/);
  assert.match(inbox, /MEDIA_AVAILABILITY_LABELS\[availability\]/);
});

test("ContentViewer audio exposes loading, error and successful playback metadata accessibly", () => {
  assert.match(viewer, /load\.status === "loading"/);
  assert.match(viewer, /role="status">読み込み中/);
  assert.match(viewer, /load\.status === "error"/);
  assert.match(viewer, /role="alert"/);
  assert.match(viewer, /src: `tasken-media:\/\/artifact\/\$\{encodeURIComponent\(artifact\.id\)\}`/);
  assert.match(viewer, /<audio[\s\S]*?controls[\s\S]*?preload="metadata"[\s\S]*?aria-label=\{`\$\{load\.title\}の音声プレーヤー`\}/);
  assert.match(viewer, /formatMediaDuration\(load\.artifact\.duration_ms\)/);
  assert.match(viewer, /formatArtifactFileSize\(load\.artifact\.file_size\)/);
  assert.match(viewer, /元ファイルの変更・削除、または対応形式を確認してください/);
});
