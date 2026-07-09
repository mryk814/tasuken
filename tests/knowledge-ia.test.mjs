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
  assert.match(notesPageSource, /NoteScope = "all" \| "memo" \| "document" \| "resource" \| "report" \| "prompt" \| "learning"/);
  assert.match(notesPageSource, /addPrompt/);
  assert.match(notesPageSource, /prompt_purpose/);
});

test("AI IO runs document publish export without owning target selection", () => {
  assert.match(importExportPageSource, /publishMarkdownTargets/);
  assert.match(importExportPageSource, /notePublishEnabled/);
  assert.doesNotMatch(importExportPageSource, /setNotePublishEnabled/);
  assert.doesNotMatch(importExportPageSource, /type="checkbox" checked=\{enabled\}/);
  assert.match(notesPageSource, /Document Publish/);
  assert.match(notesPageSource, /exportSelectedMarkdown/);
});

test("resources can still move from Notes to Chat References without changing data type", () => {
  assert.match(notesPageSource, /moveResourceToChatRefs/);
  assert.match(notesPageSource, /resource_scope:\s*"chat_ref"/);
  assert.doesNotMatch(chatRefsPageSource, /moveResourceToNotes/);
  assert.doesNotMatch(chatRefsPageSource, /resource_scope:\s*"note"/);
});
