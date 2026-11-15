import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inbox = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
const viewer = readFileSync(
  "src/renderer/src/features/workspace/components/ContentViewer.tsx",
  "utf8",
);
const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const drawerFormPlans = readFileSync(
  "src/renderer/src/features/workspace/lib/drawerFormPlans.ts",
  "utf8",
);

test("InboxはMemoだけを主操作にし、録る入口を持たない（#383、#755 束4）", () => {
  assert.match(
    inbox,
    /<Button\s+variant="primary"\s+onClick=\{addMemo\}\s*>\s*<IconPlus\s+size=\{16\}\s*\/>\s*付箋\s*<\/Button>/,
  );
  // 録音・画面録画はInboxに要らない機能なので、入口ごと持たない。
  assert.doesNotMatch(inbox, /音声を取り込む|マイクで録音|ScreenRecorderPanel/);
  // 録る側は外した（#755 束4）。Quick Capture の新規作成にも録音の入口を残さない。
  assert.doesNotMatch(drawer, /マイクで録音|requestInboxRecorder/);
});

test("ContentViewer audio exposes loading, error and successful playback metadata accessibly", () => {
  assert.match(viewer, /load\.status === "loading"/);
  assert.match(viewer, /role="status">\s*読み込み中/);
  assert.match(viewer, /load\.status === "error"/);
  assert.match(viewer, /role="alert"/);
  assert.match(
    viewer,
    /src: `tasken-media:\/\/artifact\/\$\{encodeURIComponent\(artifact\.id\)\}`/,
  );
  assert.match(
    viewer,
    /<audio[\s\S]*?controls[\s\S]*?preload="metadata"[\s\S]*?aria-label=\{`\$\{load\.title\}の音声プレーヤー`\}/,
  );
  assert.match(viewer, /formatMediaDuration\(load\.artifact\.duration_ms\)/);
  assert.match(viewer, /formatArtifactFileSize\(load\.artifact\.file_size\)/);
  assert.match(viewer, /元ファイルの変更・削除、または対応形式を確認してください/);
});

test("収録物の編集保存は音声・動画の媒体属性を保持する", () => {
  assert.match(
    drawerFormPlans,
    /content_type: \(base\.content_type as CaptureEntry\["content_type"\]\)/,
  );
  assert.match(
    drawerFormPlans,
    /capture_method: \(base\.capture_method as CaptureEntry\["capture_method"\]\)/,
  );
  assert.match(
    drawerFormPlans,
    /media_status: \(base\.media_status as CaptureEntry\["media_status"\]\)/,
  );
  assert.match(
    drawerFormPlans,
    /transcription_status:\s*\(base\.transcription_status as CaptureEntry\["transcription_status"\]\)/,
  );
});

test("Content Viewerはウィンドウを変えずアプリ内で大きく見られる（#387）", () => {
  const contentViewer = readFileSync(
    "src/renderer/src/features/workspace/components/ContentViewer.tsx",
    "utf8",
  );
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  // 動画は開いた時点でTasken全体を使う。画像・文書だけ必要に応じて拡大する。
  assert.match(contentViewer, /const isVideo = load\.status === "ready" && load\.mode === "video"/);
  assert.match(contentViewer, /isVideo \? "is-video" : "is-markdown"/);
  assert.doesNotMatch(contentViewer, /const canExpand[^;]*load\.mode === "video"/);
  assert.match(contentViewer, /aria-pressed=\{expanded\}/);
  assert.match(contentViewer, /\{expanded \? "縮小" : "大きく見る"\}/);
  // Escapeは段階的に戻す。拡大中にいきなり閉じない。
  assert.match(
    contentViewer,
    /if \(expandedRef\.current\) setExpanded\(false\);\s*\n\s*else onClose\(\);/,
  );
  // 一時的な見方なので保存しない。
  assert.doesNotMatch(contentViewer, /usePreference\([^)]*expanded/);
  // ウィンドウサイズは変えず、面の中だけで広げる。
  assert.match(css, /\.content-viewer-overlay:is\(\.is-expanded, \.is-video\) \{\s*padding: 0;/);
  assert.match(
    css,
    /\.content-viewer-overlay:is\(\.is-expanded, \.is-video\) \.content-viewer-dialog \{[\s\S]*?height: 100vh;/,
  );
  assert.match(
    css,
    /\.content-viewer-overlay:is\(\.is-expanded, \.is-video\) \.content-viewer-video video \{[\s\S]*?object-fit: contain;/,
  );
});

test("音声の取り込みは添付の画面の見出しから、専用の保存の道を通す（#755 束4）", () => {
  const artifactsPage = readFileSync(
    "src/renderer/src/features/workspace/pages/ArtifactsPage.tsx",
    "utf8",
  );
  // 普通の添付の追加は音声を断るので、入口は専用の道（prepare → 長さを測る → commit）にする。
  assert.match(artifactsPage, /<IconVolume size=\{15\} \/>[\s\S]*?"音声を取り込む"/);
  assert.match(
    artifactsPage,
    /prepareAudioCapture\(activeThemeId \|\| null\)[\s\S]*?readAudioDurationMs\(prepared\.mediaUrl\)[\s\S]*?commitAudioCapture\(\{ sessionId: prepared\.sessionId, durationMs \}\)/,
  );
  // 失敗したら保存待ちを残さない（それを開く画面は無い）。保存の途中で断られた時は、
  // 次の起動の復旧が保存し直すことを伝える。
  assert.match(artifactsPage, /await workspaceApi\.cancelAudioCapture\(sessionId\)/);
  assert.match(artifactsPage, /\/保存処理を開始した\/\.test\(cancelError\.message\)/);
  assert.match(artifactsPage, /次の起動で保存し直します。/);
});
