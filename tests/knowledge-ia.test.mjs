import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
const notesPageSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
const importExportPageSource = readFileSync("src/renderer/src/features/workspace/pages/ImportExportPage.tsx", "utf8");
const chatRefsPageSource = readFileSync("src/renderer/src/features/workspace/pages/ChatRefsPage.tsx", "utf8");

test("Prompts are folded into Notes instead of a separate Knowledge nav item", () => {
  assert.doesNotMatch(routesSource, /\["prompts", "Prompts"\]/);
  assert.match(routesSource, /prompts:\s*"notes"/);
  assert.match(workspaceAppSource, /route === "prompts" \? "notes"/);
  assert.doesNotMatch(workspaceAppSource, /PromptsPage/);
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/PromptsPage.tsx"), false);
});

test("Notes owns prompt inventory and creation", () => {
  assert.doesNotMatch(shellSource, /promptCount/);
  assert.match(notesPageSource, /type NoteScope = "all" \| NotesKind/);
  assert.match(notesPageSource, /\["note", "Note"\]/);
  assert.match(notesPageSource, /\["resource", "Resource"\]/);
  assert.match(notesPageSource, /\["report", "Report"\]/);
  assert.match(notesPageSource, /\["prompt", "Prompt"\]/);
  assert.doesNotMatch(notesPageSource, /\["memo", "メモ"\]/);
  assert.doesNotMatch(notesPageSource, /\["learning", "学び"\]/);
  assert.match(notesPageSource, /addPrompt/);
  assert.match(notesPageSource, /prompt_purpose/);
});

test("Notes kinds are simplified to Note Resource Report Prompt", () => {
  assert.match(notesPageSource, /PageHeader route="notes"/);
  assert.doesNotMatch(notesPageSource, /Notes & Resources/);
  // 4種別は残すが、常設buttonは1つのprimary actionへ集約した（#313）。
  const createMenuSource = readFileSync("src/renderer/src/features/workspace/components/NoteCreateMenu.tsx", "utf8");
  assert.match(notesPageSource, /<NoteCreateMenu /);
  assert.match(createMenuSource, /\["note", "resource", "report", "prompt"\]/);
  assert.match(createMenuSource, /className="primary-button note-create-primary"/);
  // コピー操作は secondary のまま。
  assert.match(notesPageSource, /secondary-button[\s\S]*?>一覧をコピー</);
  assert.match(notesPageSource, /body_markdown/);
  assert.match(notesPageSource, /recordType === "resource"/);
});

test("AI IO runs document publish export without owning target selection", () => {
  assert.match(importExportPageSource, /publishMarkdownTargets/);
  assert.match(importExportPageSource, /notePublishEnabled/);
  assert.doesNotMatch(importExportPageSource, /setNotePublishEnabled/);
  assert.doesNotMatch(importExportPageSource, /type="checkbox" checked=\{enabled\}/);
  assert.doesNotMatch(importExportPageSource, /Document Publish|Publish対象/);
  assert.match(notesPageSource, /showDocumentPublish/);
  assert.match(notesPageSource, /exportSelectedMarkdown/);
  assert.doesNotMatch(notesPageSource, /Document Publish|Publish対象/);
  // Resource / Prompt は出力しない。Note と Report だけ一括出力。
  assert.match(notesPageSource, /showDocumentPublish = selectedKind === "note" \|\| selectedKind === "report"/);
});

test("Notes no longer offers moving resources to Chat References", () => {
  assert.doesNotMatch(notesPageSource, /moveResourceToChatRefs/);
  assert.doesNotMatch(notesPageSource, /チャット参照へ移す/);
  assert.doesNotMatch(notesPageSource, /resource_scope:\s*"chat_ref"/);
  assert.doesNotMatch(chatRefsPageSource, /moveResourceToNotes/);
  assert.doesNotMatch(chatRefsPageSource, /resource_scope:\s*"note"/);
});
