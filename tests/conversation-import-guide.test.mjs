import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

import {
  CONVERSATION_IMPORT_DESTINATIONS,
  CONVERSATION_IMPORT_MANIFEST_SAMPLE,
  CONVERSATION_IMPORT_MARKDOWN_SAMPLE,
  CONVERSATION_IMPORT_PRIVACY_NOTE,
  CONVERSATION_IMPORT_PROVIDERS,
  CONVERSATION_IMPORT_SCHEMA,
  validateConversationImportSchema,
} from "../src/shared/conversationImportGuide.mjs";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const parser = await importBundled("src/renderer/src/features/workspace/lib/conversationParser.ts");

test("schema版数を検証し、未知でも本文は読み込む（#303）", () => {
  assert.equal(validateConversationImportSchema(CONVERSATION_IMPORT_SCHEMA).state, "supported");
  // 指定なしは既定として扱う。取り込みを止めない。
  assert.equal(validateConversationImportSchema("").state, "missing");
  // 将来versionは理由付きで扱う。
  const unknown = validateConversationImportSchema("tasken-conversation-import/v9");
  assert.equal(unknown.state, "unknown");
  assert.match(unknown.message, /未知の形式/);
});

test("validatorと実際のparser契約が乖離しない（#303）", () => {
  // サンプルBundleがそのままparserを通る。
  const parsed = parser.parseConversation(CONVERSATION_IMPORT_MARKDOWN_SAMPLE);
  assert.equal(parsed.frontmatter.schema, CONVERSATION_IMPORT_SCHEMA);
  assert.equal(parsed.schemaCheck.state, "supported");
  assert.equal(parsed.frontmatter.provider, "chatgpt");
  assert.equal(parsed.inferredTitle, "認証方式の相談");
  assert.equal(parsed.inferredLinkType, "chatgpt");
  assert.equal(parsed.messageCount, 2);

  // schemaのないMarkdownでも読めるが、状態としては missing で区別する。
  const plain = parser.parseConversation("## User\n\n相談\n\n## Assistant\n\n回答\n");
  assert.equal(plain.schemaCheck.state, "missing");
  assert.equal(plain.messageCount, 2);
});

test("Manifest例がそのままJSONとして読める（#303）", () => {
  const manifest = JSON.parse(CONVERSATION_IMPORT_MANIFEST_SAMPLE);
  assert.equal(manifest.schema, CONVERSATION_IMPORT_SCHEMA);
  assert.equal(manifest.sourceLocator.kind, "session");
  assert.equal(manifest.transcriptFile, "conversation.json");
});

test("provider別の取得方法と失われる情報を併記する（#303）", () => {
  const ids = CONVERSATION_IMPORT_PROVIDERS.map((provider) => provider.id);
  for (const id of ["microsoft_365_copilot", "vscode_copilot", "github_copilot", "chatgpt", "codex", "claude_code", "generic"]) {
    assert.ok(ids.includes(id), `${id} のガイドがない`);
  }
  for (const provider of CONVERSATION_IMPORT_PROVIDERS) {
    // 取り込めば元通り、という誤解を作らないため必ず両方書く。
    assert.ok(provider.keeps && provider.loses, `${provider.id} に保持/欠落の記載がない`);
    assert.ok(provider.extensions.length > 0);
  }
  // 未対応サービスは汎用Markdown / 貼り付けで取り込めることが分かる。
  const generic = CONVERSATION_IMPORT_PROVIDERS.find((provider) => provider.id === "generic");
  assert.match(generic.method, /貼り付け/);
});

test("取り込み後の保存先と、自動公開しないことを明示する（#303）", () => {
  assert.deepEqual(
    CONVERSATION_IMPORT_DESTINATIONS.map((entry) => entry.label),
    ["会話本文", "取込原本", "元URL / session"],
  );
  assert.match(CONVERSATION_IMPORT_PRIVACY_NOTE, /OneDriveへは自動公開されません/);

  const dialogSource = readFileSync("src/renderer/src/features/workspace/components/ConversationImportDialog.tsx", "utf8");
  // Import画面から開けること。
  assert.match(dialogSource, /対応形式・取り込み方法/);
  assert.match(dialogSource, /aria-expanded=\{guideOpen\}/);
  assert.match(dialogSource, /CONVERSATION_IMPORT_PROVIDERS\.map/);
  // サンプルをコピーできる。
  assert.match(dialogSource, /copySample\(CONVERSATION_IMPORT_MARKDOWN_SAMPLE/);
  assert.match(dialogSource, /copySample\(CONVERSATION_IMPORT_MANIFEST_SAMPLE/);
  assert.match(dialogSource, /CONVERSATION_IMPORT_PRIVACY_NOTE/);
});
