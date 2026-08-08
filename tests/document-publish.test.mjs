import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const fileExport = await importBundled("src/shared/fileExport.ts");

test("document publish signature changes when markdown body changes", () => {
  const before = fileExport.noteExportSignature("# A\nbody");
  const after = fileExport.noteExportSignature("# A\nbody changed");
  assert.notEqual(before, after);
  assert.equal(before, fileExport.noteExportSignature("# A\nbody"));
});

test("document publish uses Markdown as primary output and removes Word", () => {
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const contractsSource = readFileSync("src/shared/ipc/contracts.ts", "utf8");
  const workspaceApiSource = readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");
  const workspaceServiceSource = readFileSync("src/main/services/workspaceService.ts", "utf8");

  assert.match(drawerSource, /label="出力設定"/);
  assert.match(drawerSource, /exportMarkdown\(/);
  assert.match(drawerSource, /document-publish-open|IconFolder/);
  assert.match(drawerSource, /markdown_export/);
  assert.match(drawerSource, /markdownExporting \? "保存中" : "保存"/);
  assert.doesNotMatch(drawerSource, /Document Publish|Publish対象|Word出力|exportWord|word_export|exportMarkdownNoteToWord/);

  assert.match(notesSource, /showDocumentPublish/);
  assert.match(notesSource, /exportSelectedMarkdown/);
  assert.match(notesSource, /document-publish-open|IconFolder/);
  assert.match(notesSource, /markdown_export/);
  assert.match(notesSource, /primary-button compact.*exportSelectedMarkdown|exportSelectedMarkdown[\s\S]*primary-button/);
  assert.doesNotMatch(notesSource, /Document Publish|Publish対象|Word出力|exportSelectedWord|word_export|exportMarkdownNoteToWord|Markdown=AI|document-publish-inline-meta/);

  assert.match(workspaceServiceSource, /PDF は都度選択する/);
  assert.match(workspaceServiceSource, /const defaultPath = directory \|\| undefined/);
  assert.doesNotMatch(workspaceServiceSource, /resolveThemeContentDirectory\(request\.themeId, "exports"\)/);

  assert.doesNotMatch(contractsSource, /noteWordExport|WordExport|markdownNoteToWord/);
  assert.doesNotMatch(workspaceApiSource, /exportMarkdownNoteToWord|WordExport|wordExport/);
});

test("export artifacts auto-link only to explicitly remembered chat refs", async () => {
  const exportArtifacts = await importBundled("src/renderer/src/features/workspace/lib/noteExportArtifacts.ts");
  const chatRefs = [
    { id: "ref-1", title: "設計相談", link_type: "chatgpt", url: "https://chatgpt.com/c/1" },
    { id: "ref-2", title: "別の相談", link_type: "claude", url: "https://claude.ai/chat/2" },
    { id: "ref-3", title: "削除済み", link_type: "chatgpt", url: "https://chatgpt.com/c/3", deleted_at: "2026-08-01T00:00:00.000Z" },
  ];

  // 記憶がなければ自動追加しない（Theme一致や推定関係を根拠にしない）。
  const plain = { id: "note-1", title: "設計メモ", theme_id: "theme-1" };
  assert.deepEqual(exportArtifacts.noteArtifactExportTargetIds(plain), []);
  assert.deepEqual(exportArtifacts.resolveNoteExportTargets(plain, chatRefs), []);

  const properties = exportArtifacts.withNoteArtifactExportTargets({ markdown_export: { directory: "D:/out" } }, ["ref-1", "ref-1", ""]);
  assert.deepEqual(properties.artifact_export_targets, ["ref-1"]);
  assert.deepEqual(properties.markdown_export, { directory: "D:/out" });

  const remembered = { ...plain, properties_json: properties };
  assert.deepEqual(exportArtifacts.resolveNoteExportTargets(remembered, chatRefs).map((ref) => ref.id), ["ref-1"]);

  // 削除済みChatRefは自動追加先にしない。
  const stale = { ...plain, properties_json: { artifact_export_targets: ["ref-3", "ref-2"] } };
  assert.deepEqual(exportArtifacts.resolveNoteExportTargets(stale, chatRefs).map((ref) => ref.id), ["ref-2"]);

  // 解除するとキー自体を残さない。
  assert.deepEqual(exportArtifacts.withNoteArtifactExportTargets(properties, []), { markdown_export: { directory: "D:/out" } });

  // 同じファイルを同じChatRefへ2度出しても既存Artifactを更新する（重複を作らない）。
  const exported = {
    id: "exp-1", format: "pdf", filePath: "D:/out/設計メモ.pdf", directory: "D:/out",
    exportedAt: "2026-08-06T00:00:00.000Z", storageMode: "linked",
    noteId: "note-1", noteTitle: "設計メモ", themeId: "theme-1",
  };
  const first = exportArtifacts.buildNoteExportArtifactOperation({ exported, chatRef: chatRefs[0], artifacts: [] });
  assert.equal(first.reused, false);
  const second = exportArtifacts.buildNoteExportArtifactOperation({
    exported,
    chatRef: chatRefs[0],
    artifacts: [first.operation.entity],
  });
  assert.equal(second.reused, true);
  assert.equal(second.operation.entity.id, first.operation.entity.id);
  assert.equal(second.operation.entity.origin_note_id, "note-1");
});

test("Notes export shows the auto-link target and keeps undo reachable", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(source, /autoLinkExportArtifacts/);
  assert.match(source, /へ自動追加します。/);
  assert.match(source, /取り消す/);
  assert.match(source, /紐づけ先を変更/);
  // 自動追加に失敗しても書き出したファイルは残す。
  assert.match(source, /書き出したファイルはそのまま残っています/);
});
