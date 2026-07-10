import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  artifactFileTypeOf,
  artifactMimeTypeOf,
  artifactMonthSegments,
  resolveManagedArtifactDirectoryParts,
  resolveThemeContentDirectoryParts,
  resolveUniqueArtifactFileName,
  safeArtifactFileName,
  safeThemeFolderSegment,
  splitArtifactFileName,
} from "../src/main/services/artifactStorage.mjs";
import {
  artifactCanPromoteToManaged,
  artifactCanShowInFolder,
  artifactOpenTarget,
  displayNameFromTarget,
  extractHttpUrls,
  extractUrlsFromDataTransfer,
  inferArtifactLinkType,
  resolveArtifactStorageMode,
} from "../src/shared/artifactLinks.mjs";
import { artifactSourceEntityTypes, normalizeEntity, validateEntity, workspaceEntityTypes } from "../src/main/repositories/domain.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const artifactsComponentSource = readFileSync("src/renderer/src/features/workspace/components/artifacts.tsx", "utf8");
const artifactsPageSource = readFileSync("src/renderer/src/features/workspace/pages/ArtifactsPage.tsx", "utf8");
const themePageSource = readFileSync("src/renderer/src/features/workspace/pages/ThemePage.tsx", "utf8");
const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const contractsSource = readFileSync("src/shared/ipc/contracts.ts", "utf8");

function artifact(overrides = {}) {
  return {
    id: "artifact-1",
    title: "実験結果",
    filename: "result.xlsx",
    file_type: "xlsx",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    file_size: 1024,
    stored_path: "C:/artifacts/2026/07/result.xlsx",
    original_path: "C:/downloads/result.xlsx",
    source_type: "task",
    source_id: "task-1",
    ...overrides,
  };
}

test("artifactはworkspaceエンティティとして登録されている", () => {
  assert.equal(workspaceEntityTypes.includes("artifact"), true);
  assert.deepEqual(artifactSourceEntityTypes, {
    chat_ref: "resource",
    task: "task",
    note: "note",
    report: "note",
    theme: "theme",
  });
});

test("artifactのvalidateEntityが必須項目とenumを検証する", () => {
  const valid = artifact();
  assert.equal(validateEntity("artifact", valid), valid);
  assert.throws(() => validateEntity("artifact", artifact({ source_type: "unknown" })), /source_type/);
  assert.throws(() => validateEntity("artifact", artifact({ filename: "" })), /filename/);
  assert.throws(() => validateEntity("artifact", artifact({ generated_by: "copliot" })), /generated_by/);
  assert.throws(() => validateEntity("artifact", artifact({ file_size: -1 })), /file_size/);
  validateEntity("artifact", artifact({ generated_by: "claude" }));
  validateEntity("artifact", artifact({ generated_by: null }));
});

test("managed / linked の validation と normalize", () => {
  assert.throws(
    () => validateEntity("artifact", artifact({ storage_mode: "managed", stored_path: "" })),
    /stored_path/,
  );
  assert.throws(
    () => validateEntity("artifact", artifact({
      storage_mode: "linked",
      stored_path: "",
      target: "https://example.com/a.pdf",
      link_type: "weird",
    })),
    /link_type/,
  );
  assert.throws(
    () => validateEntity("artifact", artifact({
      storage_mode: "linked",
      stored_path: "",
      target: "",
      link_type: "url",
    })),
    /target/,
  );

  const linked = validateEntity("artifact", artifact({
    storage_mode: "linked",
    stored_path: "",
    target: "https://example.com/a.pdf",
    link_type: "url",
    link_status: "unknown",
  }));
  assert.equal(linked.storage_mode, "linked");

  const normalized = normalizeEntity("artifact", artifact({ stored_path: "C:/a.xlsx" }));
  assert.equal(normalized.storage_mode, "managed");

  const normalizedLinked = normalizeEntity("artifact", artifact({
    storage_mode: "linked",
    stored_path: "",
    target: "C:/docs/report.xlsx",
  }));
  assert.equal(normalizedLinked.link_type, "local_path");
});

test("artifactLinks の open target / link type / promote 可否", () => {
  assert.equal(resolveArtifactStorageMode(undefined), "managed");
  assert.equal(resolveArtifactStorageMode("linked"), "linked");
  assert.equal(inferArtifactLinkType("https://contoso.sharepoint.com/sites/x"), "sharepoint");
  assert.equal(inferArtifactLinkType("https://teams.microsoft.com/l/message/x"), "teams");
  assert.equal(inferArtifactLinkType("https://1drv.ms/x/s!abc"), "onedrive");
  assert.equal(inferArtifactLinkType("https://example.com/a.pdf"), "url");
  assert.equal(inferArtifactLinkType("\\\\server\\share\\a.xlsx"), "shared_path");
  assert.equal(inferArtifactLinkType("C:\\Users\\a\\b.xlsx"), "local_path");
  assert.equal(displayNameFromTarget("https://example.com/docs/report.pdf"), "report.pdf");

  const managed = artifact({ storage_mode: "managed" });
  assert.equal(artifactOpenTarget(managed), managed.stored_path);
  assert.equal(artifactCanShowInFolder(managed), true);
  assert.equal(artifactCanPromoteToManaged(managed), false);

  const linkedUrl = artifact({
    storage_mode: "linked",
    stored_path: "",
    target: "https://example.com/a.pdf",
    link_type: "url",
  });
  assert.equal(artifactOpenTarget(linkedUrl), "https://example.com/a.pdf");
  assert.equal(artifactCanShowInFolder(linkedUrl), false);
  assert.equal(artifactCanPromoteToManaged(linkedUrl), false);

  const linkedPath = artifact({
    storage_mode: "linked",
    stored_path: "",
    target: "C:/docs/a.xlsx",
    link_type: "local_path",
  });
  assert.equal(artifactCanShowInFolder(linkedPath), true);
  assert.equal(artifactCanPromoteToManaged(linkedPath), true);
});

test("ファイル名の分割と種別・MIME判定", () => {
  assert.deepEqual(splitArtifactFileName("report.final.xlsx"), { base: "report.final", extension: ".xlsx" });
  assert.deepEqual(splitArtifactFileName("README"), { base: "README", extension: "" });
  assert.equal(artifactFileTypeOf("data.CSV"), "csv");
  assert.equal(artifactFileTypeOf("no-extension"), "file");
  assert.equal(artifactMimeTypeOf("chart.png"), "image/png");
  assert.equal(artifactMimeTypeOf("slides.pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(artifactMimeTypeOf("unknown.xyz"), "application/octet-stream");
});

test("安全なファイル名へ変換する", () => {
  assert.equal(safeArtifactFileName('a/b\\c:d*e?"f<g>h|i.md'), "a-b-c-d-e-f-g-h-i.md");
  assert.equal(safeArtifactFileName("  spaced   name .pdf"), "spaced name.pdf");
  assert.equal(safeArtifactFileName(""), "artifact");
});

test("同名ファイルは上書きせず連番でリネームする", () => {
  const existing = new Set(["result.xlsx", "result (2).xlsx"]);
  const exists = (name) => existing.has(name);
  assert.equal(resolveUniqueArtifactFileName("other.xlsx", exists), "other.xlsx");
  assert.equal(resolveUniqueArtifactFileName("result.xlsx", exists), "result (3).xlsx");
  existing.add("result (3).xlsx");
  assert.equal(resolveUniqueArtifactFileName("result.xlsx", exists), "result (4).xlsx");
});

test("保存先サブフォルダはローカル日付のYYYY/MM", () => {
  // 互換のため関数は残す。#146 の新規 managed 保存では月次ではなく Theme/Inbox ルールを使う。
  assert.deepEqual(artifactMonthSegments(new Date(2026, 6, 9)), ["2026", "07"]);
  assert.deepEqual(artifactMonthSegments(new Date(2025, 11, 31)), ["2025", "12"]);
});

test("managed Artifact 保存先は Theme あり/なし/storage_root で分岐する", () => {
  assert.deepEqual(
    resolveManagedArtifactDirectoryParts({ artifactDirectory: "" }),
    { kind: "needs_directory" },
  );
  assert.deepEqual(
    resolveManagedArtifactDirectoryParts({
      artifactDirectory: "C:/tasken",
      themeId: null,
    }),
    { kind: "ok", root: "C:/tasken", segments: ["Inbox"] },
  );
  assert.deepEqual(
    resolveManagedArtifactDirectoryParts({
      artifactDirectory: "C:/tasken",
      themeId: "theme-1",
      themeCode: "MAT-A",
    }),
    { kind: "ok", root: "C:/tasken", segments: ["Themes", "MAT-A", "Artifacts"] },
  );
  // code がなければ id。名前変更で追従しない。
  assert.deepEqual(
    resolveManagedArtifactDirectoryParts({
      artifactDirectory: "C:/tasken",
      themeId: "theme-uuid",
      themeCode: "",
    }),
    { kind: "ok", root: "C:/tasken", segments: ["Themes", "theme-uuid", "Artifacts"] },
  );
  // Theme 専用ルートがあれば共通ルートは不要。
  assert.deepEqual(
    resolveManagedArtifactDirectoryParts({
      artifactDirectory: "",
      themeId: "theme-1",
      themeCode: "MAT-A",
      themeStorageRoot: "D:/themes/mat-a",
    }),
    { kind: "ok", root: "D:/themes/mat-a", segments: ["Artifacts"] },
  );
  assert.equal(safeThemeFolderSegment('a/b:c*?"'), "a-b-c-");
});

test("Note Markdown / PDF 既定も Theme 配下の Notes・Exports に乗る", () => {
  assert.deepEqual(
    resolveThemeContentDirectoryParts({
      artifactDirectory: "C:/tasken",
      themeId: "theme-1",
      themeCode: "MAT-A",
      contentKind: "notes",
    }),
    { kind: "ok", root: "C:/tasken", segments: ["Themes", "MAT-A", "Notes"] },
  );
  assert.deepEqual(
    resolveThemeContentDirectoryParts({
      artifactDirectory: "C:/tasken",
      themeId: "theme-1",
      themeCode: "MAT-A",
      contentKind: "exports",
    }),
    { kind: "ok", root: "C:/tasken", segments: ["Themes", "MAT-A", "Exports"] },
  );
  assert.deepEqual(
    resolveThemeContentDirectoryParts({
      artifactDirectory: "C:/tasken",
      contentKind: "notes",
    }),
    { kind: "ok", root: "C:/tasken", segments: ["Inbox", "Notes"] },
  );
  assert.deepEqual(
    resolveThemeContentDirectoryParts({
      themeStorageRoot: "D:/themes/mat-a",
      contentKind: "notes",
    }),
    { kind: "ok", root: "D:/themes/mat-a", segments: ["Notes"] },
  );

  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  assert.match(notesSource, /themeId:\s*str\(selected\.project_id \|\| selected\.theme_id\)/);
  assert.match(drawerSource, /themeId:\s*str\(note\.theme_id\)/);
});

test("Artifact は親 Entity の Theme を引き継ぐ", () => {
  assert.match(artifactsComponentSource, /function resolveArtifactThemeId|export function resolveArtifactThemeId/);
  assert.match(artifactsComponentSource, /effectiveThemeId/);
  assert.match(artifactsComponentSource, /parentThemeId/);
  assert.match(artifactsComponentSource, /buildArtifactThemeSyncOperations/);
  const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  assert.match(workspaceAppSource, /buildArtifactThemeSyncOperations/);
  assert.match(workspaceAppSource, /sourceTypes:\s*\["task"\]/);
  assert.match(workspaceAppSource, /sourceTypes:\s*\["note", "report"\]/);
  assert.match(workspaceAppSource, /sourceTypes:\s*\["chat_ref"\]/);
});

test("Theme 編集に storage_root があり import に themeId を渡す", () => {
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const settingsSource = readFileSync("src/renderer/src/features/workspace/pages/SettingsPage.tsx", "utf8");
  assert.match(drawerSource, /ThemeStorageRootField|storage_root/);
  assert.match(drawerSource, /Artifact保存ルート/);
  assert.match(workspaceAppSource, /storage_root:\s*formText\(values,\s*"storage_root"\)/);
  assert.match(artifactsComponentSource, /themeId:\s*parentThemeId/);
  assert.match(artifactsComponentSource, /themeId:\s*artifact\.theme_id/);
  assert.match(settingsSource, /Themes\/識別子\/Artifacts/);
  assert.match(settingsSource, /Inbox\//);
});

function fakeDeletePolicyRepository(artifacts) {
  const removed = [];
  const repo = Object.create(WorkspaceDatabase.prototype);
  repo.list = (type) => (type === "artifact" ? artifacts : []);
  repo.markRemoved = (type, id, cascade) => removed.push({ type, id, cascade });
  repo.nullifyReferences = () => {};
  return { repo, removed };
}

test("親タスク削除でartifactがcascade論理削除される", () => {
  const { repo, removed } = fakeDeletePolicyRepository([
    artifact({ id: "a1", source_type: "task", source_id: "task-1" }),
    artifact({ id: "a2", source_type: "task", source_id: "task-2" }),
    artifact({ id: "a3", source_type: "note", source_id: "task-1" }),
  ]);
  repo.applyDeletePolicy("task", "task-1");
  assert.deepEqual(removed, [{ type: "artifact", id: "a1", cascade: { parentType: "task", parentId: "task-1" } }]);
});

test("メモ削除でnote/report由来のartifactがcascadeされる", () => {
  const { repo, removed } = fakeDeletePolicyRepository([
    artifact({ id: "a1", source_type: "note", source_id: "note-1" }),
    artifact({ id: "a2", source_type: "report", source_id: "note-1" }),
    artifact({ id: "a3", source_type: "task", source_id: "note-1" }),
  ]);
  repo.applyDeletePolicy("note", "note-1");
  assert.deepEqual(removed.map((entry) => entry.id), ["a1", "a2"]);
  assert.deepEqual(removed[0].cascade, { parentType: "note", parentId: "note-1" });
});

test("Chat参照（resource）削除でchat_ref由来のartifactがcascadeされる", () => {
  const { repo, removed } = fakeDeletePolicyRepository([
    artifact({ id: "a1", source_type: "chat_ref", source_id: "res-1" }),
    artifact({ id: "a2", source_type: "chat_ref", source_id: "res-2" }),
  ]);
  repo.applyDeletePolicy("resource", "res-1");
  assert.deepEqual(removed.map((entry) => entry.id), ["a1"]);
});

test("Theme削除でtheme由来のartifactがcascadeされる", () => {
  const cascaded = [];
  const nullified = [];
  const repo = Object.create(WorkspaceDatabase.prototype);
  repo.list = (type) => (type === "artifact"
    ? [artifact({ id: "a1", source_type: "theme", source_id: "theme-1", theme_id: "theme-1" })]
    : []);
  repo.markRemoved = (type, id, cascade) => cascaded.push({ type, id, cascade });
  repo.nullifyReferences = (_parentType, targets) => nullified.push(...targets.map(([entityType, field]) => `${entityType}.${field}`));
  repo.applyDeletePolicy("theme", "theme-1");
  assert.deepEqual(cascaded.filter((entry) => entry.type === "artifact").map((entry) => entry.id), ["a1"]);
  assert.equal(nullified.includes("artifact.theme_id"), true);
});

test("Artifacts 一覧が知識整理ナビとルートに接続されている", () => {
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/ArtifactsPage.tsx"), true);
  assert.match(routesSource, /\["artifacts", "Artifacts"\]/);
  assert.match(routesSource, /artifacts:\s*"knowledge"/);
  assert.match(workspaceAppSource, /ArtifactsPage/);
  assert.match(workspaceAppSource, /artifacts:\s*<ArtifactsPage/);
});

test("Artifact の追加入口と元Entity往復がUIにある", () => {
  assert.match(artifactsComponentSource, /aria-label="Artifactを追加"/);
  assert.match(artifactsComponentSource, /aria-label="URLをリンク"/);
  assert.match(artifactsComponentSource, /chooseFiles/);
  assert.match(artifactsComponentSource, /openArtifactSource/);
  assert.match(artifactsComponentSource, /artifactOpenLabel/);
  assert.match(artifactsComponentSource, /function ArtifactCard/);
  assert.match(artifactsComponentSource, /フォルダを開く/);
  assert.match(artifactsComponentSource, /パスをコピー/);
  assert.match(artifactsComponentSource, /元の場所へ/);
  assert.match(artifactsComponentSource, /Tasken管理/);
  assert.match(artifactsPageSource, /ArtifactCard/);
  assert.match(artifactsPageSource, /showSource/);
  assert.match(artifactsPageSource, /Notes/);
  assert.match(artifactsPageSource, /Chat Refs/);
  assert.match(artifactsPageSource, /Artifacts/);
  assert.match(artifactsPageSource, /title="Artifacts"/);
  assert.match(themePageSource, /ArtifactSection/);
  assert.match(themePageSource, /sourceType="theme"/);
  assert.match(drawerSource, /sourceType="chat_ref"/);
  assert.match(drawerSource, /sourceType="task"/);
  assert.match(drawerSource, /sourceType=\{isReport \? "report" : "note"\}/);
  assert.match(contractsSource, /dialogChooseFiles/);
});

test("Artifactカードは前面操作を主操作1つ＋メニューに整理する", () => {
  // 前面: 名前・種別バッジ・保存方式・主操作。詳細はメニュー。
  assert.match(artifactsComponentSource, /artifact-card-title/);
  assert.match(artifactsComponentSource, /artifact-badge-type/);
  assert.match(artifactsComponentSource, /artifact-badge-storage/);
  assert.match(artifactsComponentSource, /artifact-card-open/);
  assert.match(artifactsComponentSource, /その他の操作/);
  assert.match(artifactsComponentSource, /IconDotsVertical/);
  // 種別ラベル分岐（画像/MDはプレビュー、表計算等は外部）
  assert.match(artifactsComponentSource, /return "プレビュー"/);
  assert.match(artifactsComponentSource, /return "外部で開く"/);
  // Drawer/Page は同一 ArtifactCard
  assert.match(artifactsComponentSource, /<ArtifactCard/);
  assert.match(artifactsPageSource, /<ArtifactCard/);
  // 密集した直置き操作ボタン列は廃止
  assert.doesNotMatch(artifactsComponentSource, /artifact-row-actions/);
  assert.doesNotMatch(artifactsPageSource, /artifact-row-actions/);
});

test("managed / linked 添付UIと操作が接続されている", () => {
  // モードタブは持たず、操作そのもので方式を分ける。
  assert.doesNotMatch(artifactsComponentSource, /コピーして管理/);
  assert.doesNotMatch(artifactsComponentSource, /場所だけリンク/);
  assert.doesNotMatch(artifactsComponentSource, /artifact-attach-mode/);
  assert.match(artifactsComponentSource, /aria-label="URLをリンク"/);
  assert.match(artifactsComponentSource, /aria-label="Artifactを追加"/);
  assert.match(artifactsComponentSource, /IconLink size=\{14\} \/>URL/);
  assert.match(artifactsComponentSource, /IconPlus size=\{14\} \/>Artifact/);
  assert.match(artifactsComponentSource, /参照のみ/);
  assert.match(artifactsComponentSource, /storage_mode: "managed"/);
  assert.match(artifactsComponentSource, /storage_mode: "linked"/);
  assert.match(artifactsComponentSource, /promoteArtifactToManaged/);
  assert.match(artifactsComponentSource, /checkArtifactLink/);
  assert.match(artifactsComponentSource, /retargetLinkedArtifact/);
  assert.match(artifactsComponentSource, /Tasken管理へコピー/);
  assert.match(artifactsComponentSource, /リンクを確認/);
  assert.match(artifactsComponentSource, /参照先を変更/);
  assert.match(artifactsPageSource, /saveEntities/);
  assert.match(contractsSource, /filePathExists/);
});

test("URLリンクは OSプロンプトではなくインライン入力とドロップで行う", () => {
  // Electron では prompt ダイアログが使えない（ChatRefs と同じ制約）。
  assert.doesNotMatch(artifactsComponentSource, /window\.prompt\s*\(/);
  assert.match(artifactsComponentSource, /artifact-url-form/);
  assert.match(artifactsComponentSource, /extractUrlsFromDataTransfer/);
  assert.match(artifactsComponentSource, /linkUrls/);
  assert.match(artifactsComponentSource, /placeholder="https:\/\/\.\.\."/);
});

test("extractHttpUrls / DataTransfer からURLを拾える", () => {
  assert.deepEqual(
    extractHttpUrls("見る: https://example.com/a.pdf と https://contoso.sharepoint.com/b"),
    ["https://example.com/a.pdf", "https://contoso.sharepoint.com/b"],
  );
  assert.deepEqual(extractHttpUrls("https://example.com/x,"), ["https://example.com/x"]);

  const fakeTransfer = {
    getData(type) {
      if (type === "text/uri-list") return "https://example.com/from-uri\n#comment";
      if (type === "text/plain") return "メモ https://example.com/from-plain";
      if (type === "text/html") return '<a href="https://example.com/from-html">x</a>';
      return "";
    },
  };
  assert.deepEqual(extractUrlsFromDataTransfer(fakeTransfer), [
    "https://example.com/from-uri",
    "https://example.com/from-plain",
    "https://example.com/from-html",
  ]);
});

test("常用のeditドロワー（Chat参照・タスク・メモ）に Artifact セクションがある", () => {
  // Chat/Taskは行クリックがedit直行なので、EditDrawer側に Artifact がないと添付ルートが死ぬ。
  // 下部固定（drawer-edit-footer）に置き、上の編集フォームだけスクロールさせる。
  assert.match(drawerSource, /drawer-edit-footer/);
  assert.match(drawerSource, /type === "resource" && isChatReferenceEntity\(entity\)/);
  assert.match(drawerSource, /sourceType: "chat_ref"/);
  assert.match(drawerSource, /sourceType: "task"/);
  assert.match(drawerSource, /sourceType: \(isReport \? "report" : "note"\)/);
});
