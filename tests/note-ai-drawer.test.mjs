import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AiNoteStreamRegistry } from "../src/main/services/ai/noteStreamRegistry.mjs";
import {
  authorizeNoteAiRequest,
  NOTE_AI_CONTEXT_CONFIRMATION,
} from "../src/main/services/ai/noteContextAuthority.mjs";
import {
  buildNoteAiHistory,
  buildNoteAiProposal,
  markdownCaretAnchor,
  markdownHeadingAnchor,
  markdownHeadingAt,
  noteAiSecretWarning,
} from "../src/shared/noteAiConversation.mjs";
import { markdownSignature } from "../src/shared/canonicalMarkdown.mjs";

const drawer = readFileSync("src/renderer/src/features/workspace/components/NoteAiDrawer.tsx", "utf8");
const notes = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
const ipc = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");
const serviceSource = readFileSync("src/main/services/aiProviderService.ts", "utf8");

function request(instruction = "要点を整理") {
  return {
    noteId: "note-1",
    baseRevision: 4,
    expectedBodySignature: markdownSignature("# Result\n\nserver body"),
    confirmationToken: NOTE_AI_CONTEXT_CONFIRMATION,
    anchorOffset: 6,
    scope: "selection",
    title: "実験メモ",
    body: "# 結果\n\nold",
    instruction,
    selection: { start: 6, end: 9, text: "old" },
    context: { includeTitle: true, includeBody: false, includeSelection: true, includeHeading: true, includeHistory: true, heading: "結果" },
  };
}

test("current Markdown heading is derived from the caret or explicit selection", () => {
  const markdown = "# Overview\nintro\n\n## Result\nvalue\n\n## Next\nitem";
  assert.equal(markdownHeadingAt(markdown, markdown.indexOf("value")), "Result");
  assert.equal(markdownHeadingAt(markdown, markdown.indexOf("item")), "Next");
  assert.equal(markdownHeadingAt("plain", 2), "");
  assert.deepEqual(markdownHeadingAnchor(markdown, 1), { heading: "Result", offset: markdown.indexOf("\n\n## Next") });
  assert.deepEqual(markdownCaretAnchor(markdown, 1, "value", "val"), { heading: "Result", offset: markdown.indexOf("value") + 3 });
  assert.match(notes, /heading: selection\.heading \|\| markdownHeadingAt\(source, first\)/);
  assert.match(notes, /richAiAnchorRef\.current = null;[\s\S]*\[selectedOwnerKey\]/);
  assert.match(drawer, /現在の見出し\{target\.heading/);
});

test("unsaved body signature mismatch stops before provider call", () => {
  const note = { id: "note-1", title: "Saved", body_markdown: "saved private body", version: 4, ai_visibility: ["external_ai"] };
  const repository = { get: (type, id) => type === "note" && id === note.id ? note : null, list: () => [], getPreference: () => ["external_ai"] };
  let providerCalls = 0;
  assert.throws(() => {
    authorizeNoteAiRequest(repository, { ...request(), scope: "document", selection: undefined, expectedBodySignature: markdownSignature("unsaved safe-looking body") });
    providerCalls += 1;
  }, /未保存/);
  assert.equal(providerCalls, 0);
  assert.match(ipc, /authorizeNoteAiRequest\(repository, request\)[\s\S]*streamNote/);
});

test("Main re-reads visible Note context, bounds history, and strips renderer-only private fields", () => {
  const note = { id: "note-1", title: "Authoritative", body_markdown: "# Result\n\nserver body", version: 4, project_id: "theme-1", ai_visibility: ["external_ai"] };
  const theme = { id: "theme-1", name: "Theme", description: "safe theme", default_ai_visibility: ["external_ai"] };
  const proposal = { id: "p-1", status: "accepted", request: { instruction: "old prompt", target: { type: "note", id: "note-1" } }, response: { text: "old response" } };
  const repository = {
    get: (type, id) => type === "note" && id === note.id ? note : type === "theme" && id === theme.id ? theme : null,
    list: (type) => type === "ai_proposal" ? [proposal] : [],
    getPreference: () => ["external_ai"],
  };
  const authorized = authorizeNoteAiRequest(repository, {
    ...request(), title: "forged", body: "private renderer body", unknown_private: "C:\\Users\\secret",
  });
  assert.equal(authorized.title, "Authoritative");
  assert.equal(authorized.body, note.body_markdown);
  assert.equal(authorized.selection.text, note.body_markdown.slice(6, 9));
  assert.equal(authorized.unknown_private, undefined);
  assert.deepEqual(authorized.history.map(({ role, text }) => [role, text]), [["user", "old prompt"], ["assistant", "old response"]]);
});

test("Main blocks local-only Note content before any provider request and requires confirmation/revision", () => {
  const note = { id: "note-1", title: "Private", body_markdown: "secret", version: 4, ai_visibility: [] };
  const repository = { get: (type, id) => type === "note" && id === note.id ? note : null, list: () => [], getPreference: () => ["external_ai"] };
  const authoritativeRequest = { ...request(), expectedBodySignature: markdownSignature(note.body_markdown) };
  assert.throws(() => authorizeNoteAiRequest(repository, { ...authoritativeRequest, scope: "document", selection: undefined }), /外部AIへの公開範囲/);
  assert.throws(() => authorizeNoteAiRequest(repository, { ...authoritativeRequest, confirmationToken: "" }), /明示確認/);
  assert.throws(() => authorizeNoteAiRequest(repository, { ...authoritativeRequest, baseRevision: 3 }), /更新済み/);
  assert.throws(() => authorizeNoteAiRequest(repository, { ...authoritativeRequest, expectedBodySignature: markdownSignature("unsaved draft") }), /未保存/);
});

test("conversation history stays associated with one Note and preserves legacy Draft sources", () => {
  const note = { id: "note-1", properties_json: { draft_workspace: { sources: [{ id: "legacy", body: "legacy answer", instruction: "old prompt", created_at: "2026-01-01T00:00:00.000Z", ai_service: "Claude" }] } } };
  const proposals = [
    { id: "other", request: { target: { type: "note", id: "note-2" } }, response: { text: "drop" } },
    { id: "current", status: "pending", created_at: "2026-02-01T00:00:00.000Z", request: { instruction: "new prompt", target: { type: "note", id: "note-1" }, provenance: { providerLabel: "OpenAI", model: "gpt" } }, response: { text: "new answer", generated_at: "2026-02-01T00:00:00.000Z" } },
    { id: "deleted", deleted_at: "2026-02-02T00:00:00.000Z", request: { target: { type: "note", id: "note-1" } }, response: { text: "deleted secret" } },
  ];
  const history = buildNoteAiHistory(note, proposals);
  assert.deepEqual(history.map(({ id, response }) => [id, response]), [["legacy", "legacy answer"], ["current", "new answer"]]);
  assert.equal(history.some((entry) => entry.response === "deleted secret"), false);
  assert.equal(history[1].provider, "OpenAI");
});

test("completed response becomes a pending proposal with context and provenance; secrets are warned", () => {
  const proposal = buildNoteAiProposal({
    id: "proposal-1",
    note: { id: "note-1", title: "Memo", version: 4 },
    instruction: "rewrite",
    request: request("rewrite"),
    result: {
      providerProfileId: "provider", providerLabel: "OpenAI", adapterKind: "openai-native", modelProfileId: "model", model: "gpt",
      capabilityPath: ["text", "streaming"], usage: null, proposedBody: "# Result\n\nnew", responseText: "new",
    },
    generatedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.request.conversation_id, "note-ai:note-1");
  assert.equal(proposal.request.context.heading, "結果");
  assert.equal(proposal.response.text, "new");
  assert.match(noteAiSecretWarning("api_key=sk-test"), /credential/);
  assert.equal(noteAiSecretWarning("ordinary stable-id:123"), "");
});

test("drawer is chat-first and exposes every safe result action through Diff/Application Command", () => {
  assert.doesNotMatch(drawer, /AiNoteMode|rewrite.*continue.*chat/s);
  for (const label of ["コピー", "現在位置へ挿入", "選択範囲を置換", "新しいNote", "Diff review", "却下", "直前のAI採用を元に戻す"]) assert.match(drawer, new RegExp(label));
  assert.match(drawer, /applyCanonicalNoteAiProposal/);
  assert.match(drawer, /withoutCanonicalBinding\(candidate\)/);
  assert.match(drawer, /status: acceptedHunks\.size < reviewHunks\.length \? "partially_accepted" : "accepted"/);
  assert.match(drawer, /Ctrl\+Enterで送信/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /sibling\.inert = true/);
  assert.match(drawer, /page\?\.children/);
  assert.match(drawer, /!drawerRef\.current\?\.contains\(document\.activeElement\)/);
  assert.match(drawer, /activeProposalIsPending && <button[\s\S]*現在位置へ挿入/);
  assert.match(drawer, /includeHistory && history\.length/);
  assert.match(drawer, /role="separator" tabIndex=\{0\}/);
  assert.match(notes, /has-note-ai-drawer/);
  assert.doesNotMatch(notes, /DraftWorkspaceDialog|NoteAiDialog|AI Draft/);
  assert.doesNotMatch(readFileSync("src/renderer/src/styles/app.css", "utf8"), /\.note-ai-selection\b/);
});

test("stream registry cancels one request without touching another and cleans completed requests", () => {
  const registry = new AiNoteStreamRegistry();
  const first = registry.start("request-first-123");
  const second = registry.start("request-second-123");
  assert.equal(registry.cancel("request-first-123"), true);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(registry.finish("request-first-123"), true);
  assert.equal(registry.cancel("request-first-123"), false);
  assert.equal(registry.has("request-second-123"), true);
  assert.equal(registry.finish("request-second-123"), true);
  assert.equal(registry.has("request-second-123"), false);
});

test("sender destruction is wired to request-scoped cancellation with listener cleanup", () => {
  assert.match(ipc, /event\.sender\.once\("destroyed", cancelOnDestroyed\)/);
  assert.match(ipc, /cancelNoteStream\(normalizedRequestId\)/);
  assert.match(ipc, /finally[\s\S]*removeListener\("destroyed", cancelOnDestroyed\)/);
  assert.match(preload, /onNoteStreamEvent/);
  assert.match(serviceSource, /noteStreams = new AiNoteStreamRegistry/);
  assert.match(serviceSource, /this\.noteStreams\.finish\(requestId\)/);
});
