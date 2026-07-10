import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  artifactFileTypeOf,
  artifactMimeTypeOf,
  artifactMonthSegments,
  resolveUniqueArtifactFileName,
  safeArtifactFileName,
  splitArtifactFileName,
} from "../src/main/services/artifactStorage.mjs";
import { artifactSourceEntityTypes, validateEntity, workspaceEntityTypes } from "../src/main/repositories/domain.mjs";
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
  assert.deepEqual(artifactMonthSegments(new Date(2026, 6, 9)), ["2026", "07"]);
  assert.deepEqual(artifactMonthSegments(new Date(2025, 11, 31)), ["2025", "12"]);
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
  assert.match(artifactsComponentSource, /Artifact を追加/);
  assert.match(artifactsComponentSource, /chooseFiles/);
  assert.match(artifactsComponentSource, /openArtifactSource/);
  assert.match(artifactsComponentSource, /artifactOpenLabel/);
  assert.match(artifactsPageSource, /元へ/);
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

test("常用のeditドロワー（Chat参照・タスク・メモ）に Artifact セクションがある", () => {
  // Chat/Taskは行クリックがedit直行なので、EditDrawer側に Artifact がないと添付ルートが死ぬ。
  // 下部固定（drawer-edit-footer）に置き、上の編集フォームだけスクロールさせる。
  assert.match(drawerSource, /drawer-edit-footer/);
  assert.match(drawerSource, /type === "resource" && isChatReferenceEntity\(entity\)/);
  assert.match(drawerSource, /sourceType: "chat_ref"/);
  assert.match(drawerSource, /sourceType: "task"/);
  assert.match(drawerSource, /sourceType: \(isReport \? "report" : "note"\)/);
});
