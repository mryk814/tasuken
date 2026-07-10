import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { artifactOpenTarget, isHttpUrl } from "../src/shared/artifactLinks.mjs";

const contractsSource = readFileSync("src/shared/ipc/contracts.ts", "utf8");
const workspaceServiceSource = readFileSync("src/main/services/workspaceService.ts", "utf8");
const registerIpcSource = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const preloadSource = readFileSync("src/preload/index.ts", "utf8");
const workspaceApiSource = readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");
const contentViewerSource = readFileSync("src/renderer/src/features/workspace/components/ContentViewer.tsx", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const artifactsSource = readFileSync("src/renderer/src/features/workspace/components/artifacts.tsx", "utf8");
const typesSource = readFileSync("src/renderer/src/features/workspace/types.ts", "utf8");
const cssSource = readFileSync("src/renderer/src/styles/app.css", "utf8");
const artifactsPageSource = readFileSync("src/renderer/src/features/workspace/pages/ArtifactsPage.tsx", "utf8");

const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MARKDOWN_TYPES = new Set(["md", "markdown"]);

/** artifacts.tsx の canPreviewArtifactInApp と同ロジック（純関数検証用）。 */
function canPreviewArtifactInApp(artifact) {
  const type = String(artifact.file_type || "").toLowerCase();
  const category = IMAGE_TYPES.has(type) ? "image" : MARKDOWN_TYPES.has(type) ? "markdown" : "other";
  if (category !== "image" && category !== "markdown") return false;
  const target = artifactOpenTarget(artifact);
  if (!target) return false;
  if (category === "markdown" && isHttpUrl(target)) return false;
  return true;
}

test("ContentViewer コンポーネントと CSS が存在する", () => {
  assert.equal(existsSync("src/renderer/src/features/workspace/components/ContentViewer.tsx"), true);
  assert.match(contentViewerSource, /export function ContentViewer/);
  assert.match(contentViewerSource, /role="dialog"/);
  assert.match(contentViewerSource, /aria-modal="true"/);
  assert.match(cssSource, /\.content-viewer-overlay/);
  assert.match(cssSource, /\.content-viewer-markdown/);
  assert.match(cssSource, /\.content-viewer-image-stage/);
});

test("file:read-preview IPC が Main / Preload / Renderer に接続されている", () => {
  assert.match(contractsSource, /fileReadPreview:\s*"file:read-preview"/);
  assert.match(contractsSource, /FilePreviewReadResult/);
  assert.match(contractsSource, /readPreview\(filePath: string\): Promise<FilePreviewReadResult>/);
  assert.match(workspaceServiceSource, /readFilePreview\(/);
  assert.match(workspaceServiceSource, /PREVIEW_IMAGE_MAX_BYTES/);
  assert.match(registerIpcSource, /IPC\.fileReadPreview/);
  assert.match(preloadSource, /readPreview:\s*\(filePath\)\s*=>\s*ipcRenderer\.invoke\(IPC\.fileReadPreview/);
  assert.match(workspaceApiSource, /readFilePreview\(filePath/);
});

test("WorkspaceApp が contentViewer 状態とモーダルを持つ", () => {
  assert.match(workspaceAppSource, /ContentViewer/);
  assert.match(workspaceAppSource, /contentViewer/);
  assert.match(workspaceAppSource, /openContentViewer/);
  assert.match(typesSource, /OpenContentViewer/);
  assert.match(typesSource, /ContentViewerTarget/);
  assert.match(typesSource, /openContentViewer: OpenContentViewer/);
});

test("Note Drawer から大きく表示でビューアを開ける", () => {
  assert.match(drawerSource, /大きく表示/);
  assert.match(drawerSource, /openContentViewer\(\{\s*type:\s*"note"/);
  assert.match(drawerSource, /openContentViewer\?: OpenContentViewer/);
});

test("Artifact カードは画像/Markdown をアプリ内ビューアで開く", () => {
  assert.match(artifactsSource, /canPreviewArtifactInApp/);
  assert.match(artifactsSource, /openContentViewer\(\{\s*type:\s*"artifact"/);
  assert.match(artifactsSource, /画像をアプリ内ビューアで大きく表示します/);
  assert.match(artifactsSource, /Markdownをアプリ内ビューアで表示します/);
  // #130 の未実装文言は消えている
  assert.doesNotMatch(artifactsSource, /アプリ内ビューアは #130/);
  assert.match(artifactsPageSource, /openContentViewer/);
});

test("Markdownビューアは既存 Preview と同じ previewHtml を使う", () => {
  assert.match(contentViewerSource, /previewHtml\(/);
  assert.match(contentViewerSource, /markdown-preview/);
  assert.match(contentViewerSource, /編集する/);
  assert.match(contentViewerSource, /Markdownをコピー/);
  assert.match(contentViewerSource, /ファイルを開く/);
  assert.match(contentViewerSource, /フォルダを開く/);
  assert.match(contentViewerSource, /パスをコピー/);
});

test("画像ビューアに拡大縮小とフィットがある", () => {
  assert.match(contentViewerSource, /画面に合わせる/);
  assert.match(contentViewerSource, /元サイズ/);
  assert.match(contentViewerSource, /拡大/);
  assert.match(contentViewerSource, /縮小/);
  assert.match(contentViewerSource, /ZOOM_STEPS/);
});

test("canPreviewArtifactInApp は種別とURLを判定する", () => {
  assert.match(artifactsSource, /export function canPreviewArtifactInApp/);
  assert.match(artifactsSource, /category === "markdown" && isHttpUrl\(target\)/);

  assert.equal(canPreviewArtifactInApp({
    id: "a1",
    filename: "chart.png",
    file_type: "png",
    stored_path: "C:/a/chart.png",
    source_type: "task",
    source_id: "t1",
  }), true);

  assert.equal(canPreviewArtifactInApp({
    id: "a2",
    filename: "note.md",
    file_type: "md",
    stored_path: "C:/a/note.md",
    source_type: "note",
    source_id: "n1",
  }), true);

  assert.equal(canPreviewArtifactInApp({
    id: "a3",
    filename: "sheet.xlsx",
    file_type: "xlsx",
    stored_path: "C:/a/sheet.xlsx",
    source_type: "task",
    source_id: "t1",
  }), false);

  assert.equal(canPreviewArtifactInApp({
    id: "a4",
    filename: "remote.md",
    file_type: "md",
    storage_mode: "linked",
    link_type: "url",
    target: "https://example.com/readme.md",
    stored_path: "",
    source_type: "task",
    source_id: "t1",
  }), false);

  assert.equal(canPreviewArtifactInApp({
    id: "a5",
    filename: "remote.png",
    file_type: "png",
    storage_mode: "linked",
    link_type: "url",
    target: "https://example.com/image.png",
    stored_path: "",
    source_type: "task",
    source_id: "t1",
  }), true);
});
