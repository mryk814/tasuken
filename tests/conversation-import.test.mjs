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
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
}

const parser = await importBundled("src/renderer/src/features/workspace/lib/conversationParser.ts");

test("parseConversation extracts frontmatter fields", () => {
  const text = `---
provider: microsoft_365_copilot
source_url: https://m365.cloud.microsoft/chat/123
title: TypeScript配列の重複除去
captured_at: 2026-08-04T16:30:00+09:00
source_format: rendered_markdown
fidelity: rendered_text
---

## 🧑 You

TypeScriptで配列の重複を除くには？

## 🤖 Copilot

Setを使うのが簡単です。
`;
  const result = parser.parseConversation(text);
  assert.equal(result.frontmatter.provider, "microsoft_365_copilot");
  assert.equal(result.frontmatter.source_url, "https://m365.cloud.microsoft/chat/123");
  assert.equal(result.frontmatter.title, "TypeScript配列の重複除去");
  assert.equal(result.frontmatter.source_format, "rendered_markdown");
  assert.equal(result.frontmatter.fidelity, "rendered_text");
  assert.equal(result.inferredTitle, "TypeScript配列の重複除去");
  assert.equal(result.inferredLinkType, "copilot");
  assert.equal(result.messageCount, 2);
});

test("parseConversation works without frontmatter", () => {
  const text = `## 🧑 You

Hello!

## 🤖 Assistant

Hi there!
`;
  const result = parser.parseConversation(text);
  assert.equal(result.messageCount, 2);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[0].content, "Hello!");
  assert.equal(result.messages[1].role, "assistant");
  assert.equal(result.messages[1].content, "Hi there!");
  assert.equal(result.inferredTitle, "Hello!");
});

test("parseConversationMessages handles ## User / ## Assistant headings", () => {
  const body = `## User

First question

## Assistant

First answer

## User

Second question
`;
  const messages = parser.parseConversationMessages(body);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[2].role, "user");
});

test("parseConversationMessages ignores sub-headings inside a reply", () => {
  const body = `## 🧑 You

配列の重複を除くには？

## 🤖 Copilot

いくつか方法があります。

### 1. Setを使う

コード1

### 2. filterを使う

コード2

## 🧑 You

パフォーマンスは？

## 🤖 Copilot

Setが最速です。
`;
  const messages = parser.parseConversationMessages(body);
  assert.equal(messages.length, 4);
  assert.deepEqual(
    messages.map((m) => m.role),
    ["user", "assistant", "user", "assistant"],
  );
  assert.match(messages[1].content, /### 1\. Setを使う/);
  assert.match(messages[1].content, /### 2\. filterを使う/);
});

test("parseConversationMessages uses ### as separator when no ## role heading exists", () => {
  const body = `# 会話ログ

### User

質問です

### Assistant

回答です
`;
  const messages = parser.parseConversationMessages(body);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
});

test("parseConversationMessages returns empty when no role heading exists", () => {
  assert.deepEqual(
    parser.parseConversationMessages("## Section 1\n\nText\n\n## Section 2\n\nMore"),
    [],
  );
});

test("mapProviderToLinkType maps known providers", () => {
  assert.equal(parser.mapProviderToLinkType("microsoft_365_copilot"), "copilot");
  assert.equal(parser.mapProviderToLinkType("claude"), "claude");
  assert.equal(parser.mapProviderToLinkType("claude_code"), "claude");
  assert.equal(parser.mapProviderToLinkType("chatgpt"), "chatgpt");
  assert.equal(parser.mapProviderToLinkType("gemini"), "gemini");
  assert.equal(parser.mapProviderToLinkType("codex"), "chatgpt");
  assert.equal(parser.mapProviderToLinkType("vscode_copilot"), "copilot");
  assert.equal(parser.mapProviderToLinkType("unknown_service"), "other");
});

test("inferredTitle falls back to first user message truncated to 60 chars", () => {
  const longMessage = "a".repeat(100);
  const text = `## 🧑 You\n\n${longMessage}\n\n## 🤖 Assistant\n\nOK`;
  const result = parser.parseConversation(text);
  assert.equal(result.inferredTitle.length, 60);
});

test("isConversationMarkdown returns true for conversation patterns", () => {
  assert.ok(parser.isConversationMarkdown("## 🧑 You\n\nHello\n\n## 🤖 Assistant\n\nHi"));
  assert.ok(parser.isConversationMarkdown("## User\n\nHello\n\n## Assistant\n\nHi"));
});

test("isConversationMarkdown returns false for regular markdown", () => {
  assert.ok(
    !parser.isConversationMarkdown("# Title\n\n## Section 1\n\nContent\n\n## Section 2\n\nMore"),
  );
  assert.ok(!parser.isConversationMarkdown("Just some text"));
});

test("parseConversation returns empty messages for empty input", () => {
  const result = parser.parseConversation("");
  assert.equal(result.messageCount, 0);
  assert.deepEqual(result.messages, []);
  assert.equal(result.inferredTitle, "Imported conversation");
});

test("parseFlatYaml parses key-value pairs", () => {
  const result = parser.parseFlatYaml("provider: chatgpt\ntitle: Test Title\nfidelity: structured");
  assert.equal(result.provider, "chatgpt");
  assert.equal(result.title, "Test Title");
  assert.equal(result.fidelity, "structured");
});

test("ChatRefsPage includes ConversationImportDialog integration", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/ChatRefsPage.tsx", "utf8");
  assert.match(source, /ConversationImportDialog/);
  assert.match(source, /importDialogOpen/);
  assert.match(source, /会話ログを取り込む/);
});

test("drawer.tsx includes ConversationPreview integration", () => {
  const source = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  assert.match(source, /ConversationPreview/);
  assert.match(source, /isConversationMarkdown/);
});

test("ContentViewer renders chat_log target with ConversationPreview", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/components/ContentViewer.tsx",
    "utf8",
  );
  assert.match(source, /target\.type === "chat_log"/);
  assert.match(source, /mode: "conversation"/);
  assert.match(source, /<ConversationPreview/);
  assert.match(source, /会話ログをコピー/);
  assert.match(source, /元チャットを開く/);
  assert.match(source, /参照を編集/);
});

test("ContentViewerTarget type includes chat_log", () => {
  const source = readFileSync("src/renderer/src/features/workspace/types.ts", "utf8");
  assert.match(source, /\{ type: "chat_log"; resourceId: string \}/);
});

test("ChatRefsPage opens the conversation viewer from the row", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/ChatRefsPage.tsx", "utf8");
  assert.match(source, /openContentViewer\(\{ type: "chat_log", resourceId: String\(r\.id\) \}\)/);
  assert.match(source, /会話ログを読む/);
  assert.match(source, /isConversationMarkdown/);
});

test("the conversation log is not embedded in the resource edit form", () => {
  const source = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  assert.doesNotMatch(source, /conversation-log-details/);
});

test("drawerFormPlans allows resource without URL when body_markdown exists", () => {
  const source = readFileSync("src/renderer/src/features/workspace/lib/drawerFormPlans.ts", "utf8");
  assert.match(source, /URLまたは会話ログを入力してください/);
  assert.match(source, /!url && !bodyMarkdown/);
});

test("Resource type includes conversation metadata fields", () => {
  const source = readFileSync("src/renderer/src/features/workspace/domain-model/types.ts", "utf8");
  assert.match(source, /source_format\?: string \| null/);
  assert.match(source, /fidelity\?: string \| null/);
  assert.match(source, /parser_version\?: string \| null/);
  assert.match(source, /message_count\?: number \| null/);
});

test("CSS styles exist for conversation import and viewer", () => {
  const source = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(source, /\.conversation-import-dialog/);
  assert.match(source, /\.conversation-import-source/);
  assert.match(source, /\.conversation-import-preview/);
  assert.match(source, /\.conversation-view/);
  assert.match(source, /\.conversation-thread/);
  assert.match(source, /\.conversation-turn/);
  assert.match(source, /\.conversation-turn-label/);
  assert.match(source, /\.conversation-role-user/);
  assert.match(source, /\.content-viewer-conversation/);
});

test("role display names drop emoji from the source heading", () => {
  const result = parser.parseConversation("## 🧑 You\n\nHello\n\n## 🤖 Copilot\n\nHi");
  assert.equal(result.messages[0].displayName, "You");
  assert.equal(result.messages[1].displayName, "Copilot");
});

test("ConversationPreview uses Tabler icons instead of emoji", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/components/ConversationPreview.tsx",
    "utf8",
  );
  assert.match(source, /@tabler\/icons-react/);
  assert.match(source, /conversation-thread/);
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u);
});

const conversationCopy = await importBundled(
  "src/renderer/src/features/workspace/lib/conversationCopy.ts",
);

const COPY_MESSAGES = [
  { role: "system", displayName: "System", content: "system prompt" },
  { role: "user", displayName: "You", content: "重複を除くには？" },
  { role: "tool", displayName: "Tool", content: "tool output" },
  { role: "assistant", displayName: "Copilot", content: "Setを使います。" },
  { role: "user", displayName: "You", content: "順序は保たれる？" },
  { role: "assistant", displayName: "Copilot", content: "保たれます。" },
];

test("conversation copy renders a message with or without its speaker", () => {
  assert.equal(
    conversationCopy.conversationMessageMarkdown(COPY_MESSAGES[3]),
    "## Copilot\n\nSetを使います。",
  );
  assert.equal(
    conversationCopy.conversationMessageMarkdown(COPY_MESSAGES[3], { withSpeaker: false }),
    "Setを使います。",
  );
});

test("conversation turn range pairs a question with the following answer", () => {
  // User起点でも、間のtool messageを跨いで直後のAssistant回答まで1組にする。
  assert.deepEqual(conversationCopy.conversationTurnRange(COPY_MESSAGES, 1), { from: 1, to: 3 });
  // Assistant起点でも同じ組を返す。
  assert.deepEqual(conversationCopy.conversationTurnRange(COPY_MESSAGES, 3), { from: 1, to: 3 });
  assert.deepEqual(conversationCopy.conversationTurnRange(COPY_MESSAGES, 4), { from: 4, to: 5 });
  // 次のUser質問を越えて広がらない。
  assert.deepEqual(conversationCopy.conversationTurnRange(COPY_MESSAGES, 5), { from: 4, to: 5 });
  // 回答が続かない単独messageは1件のまま。
  assert.deepEqual(conversationCopy.conversationTurnRange(COPY_MESSAGES, 0), { from: 0, to: 0 });
  assert.equal(conversationCopy.conversationTurnRange(COPY_MESSAGES, 9), null);
});

test("conversation range copy excludes tool and system messages by default", () => {
  const turn = conversationCopy.conversationRangeMarkdown(COPY_MESSAGES, 1, 3);
  assert.equal(turn.markdown, "## You\n\n重複を除くには？\n\n## Copilot\n\nSetを使います。");
  assert.equal(turn.count, 2);
  assert.equal(turn.excluded, 1);

  const withTools = conversationCopy.conversationRangeMarkdown(COPY_MESSAGES, 1, 3, {
    includeToolAndSystem: true,
  });
  assert.match(withTools.markdown, /## Tool\n\ntool output/);
  assert.equal(withTools.excluded, 0);

  // 逆向きに選んでも同じ範囲になる。
  assert.equal(
    conversationCopy.conversationRangeMarkdown(COPY_MESSAGES, 5, 4).markdown,
    conversationCopy.conversationRangeMarkdown(COPY_MESSAGES, 4, 5).markdown,
  );

  // 本文のみの連結は区切りを入れ、話者名を混ぜない。
  const bodies = conversationCopy.conversationRangeMarkdown(COPY_MESSAGES, 4, 5, {
    withSpeaker: false,
  });
  assert.equal(bodies.markdown, "順序は保たれる？\n\n---\n\n保たれます。");
  assert.doesNotMatch(bodies.markdown, /##/);

  assert.deepEqual(conversationCopy.conversationRangeMarkdown([], 0, 0), {
    markdown: "",
    count: 0,
    excluded: 0,
  });
});

test("Conversation Viewer offers message, turn, range and code block copy", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/components/ConversationPreview.tsx",
    "utf8",
  );
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(source, /本文のみ/);
  assert.match(source, /このやり取り/);
  assert.match(source, /ここから選択/);
  assert.match(source, /ここまでコピー/);
  assert.match(source, /conversation-code-copy/);
  // hoverだけに頼らず、focusでも操作が現れること。
  assert.match(
    styles,
    /\.conversation-turn:focus-within \.conversation-turn-actions\s*\{\s*opacity: 1;/,
  );
  assert.match(
    styles,
    /\.conversation-code-copy:focus-visible\s*\{\s*outline: 2px solid var\(--color-focus\)/,
  );
});
