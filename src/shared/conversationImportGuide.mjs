/**
 * AI会話ログの取り込み契約と、利用者向けガイドの正本（#303）。
 *
 * 「どの形式なら取り込めるのか」「各サービスで何をすればよいのか」「取り込んだ後
 * どこへ保存されるのか」が画面から確認できないと、Import機能は使われない。
 *
 * validator・parser・画面の説明・サンプルが同じ定義を見るようにして、
 * 説明と実装が乖離しないようにする。
 */

export const CONVERSATION_IMPORT_SCHEMA = "tasken-conversation-import/v1";

/** 将来versionを足してもv1を読み続けられるよう、既知versionは配列で持つ。 */
export const SUPPORTED_CONVERSATION_IMPORT_SCHEMAS = [CONVERSATION_IMPORT_SCHEMA];

/**
 * schema版数を検証する（#303）。
 * 未知のversionでも取り込み自体は止めず、理由を添えて利用者へ判断させる。
 *
 * @returns {{ state: "supported" | "missing" | "unknown", schema: string, message: string }}
 */
export function validateConversationImportSchema(value) {
  const schema = String(value || "").trim();
  if (!schema) {
    return {
      state: "missing",
      schema: "",
      message: `schemaの指定がありません。${CONVERSATION_IMPORT_SCHEMA} として読み込みます。`,
    };
  }
  if (SUPPORTED_CONVERSATION_IMPORT_SCHEMAS.includes(schema)) {
    return { state: "supported", schema, message: `対応形式です（${schema}）。` };
  }
  return {
    state: "unknown",
    schema,
    message: `未知の形式です（${schema}）。本文は読み込みますが、一部の項目を解釈できない場合があります。`,
  };
}

/** Tasken標準のMarkdown Bundle例。テンプレートとしてコピー・保存できる。 */
export const CONVERSATION_IMPORT_MARKDOWN_SAMPLE = `---
schema: ${CONVERSATION_IMPORT_SCHEMA}
provider: chatgpt
source_url: https://example.com/conversation
title: 認証方式の相談
captured_at: 2026-08-05T23:00:00+09:00
source_format: rendered_markdown
fidelity: rich_markdown
---

## User

相談内容

## Assistant

回答内容
`;

/** 複数ファイル・添付があるときのManifest例。ZIP Bundleとして扱う。 */
export const CONVERSATION_IMPORT_MANIFEST_SAMPLE = `{
  "schema": "${CONVERSATION_IMPORT_SCHEMA}",
  "provider": "vscode_copilot",
  "title": "Authentication refactor",
  "sourceLocator": { "kind": "session", "value": "session-id" },
  "capturedAt": "2026-08-05T23:00:00+09:00",
  "transcriptFile": "conversation.json",
  "fidelity": "structured"
}
`;

/**
 * provider別の取得方法（#303）。
 * 忠実度と「失われる可能性のあるもの」を必ず併記し、取り込めば元通りという誤解を作らない。
 */
export const CONVERSATION_IMPORT_PROVIDERS = [
  {
    id: "microsoft_365_copilot",
    name: "Microsoft 365 Copilot",
    method: "会話画面を選択してコピーし、Markdownとして貼り付ける",
    fidelity: "rendered_text",
    extensions: [".md", ".txt"],
    keeps: "話者・順序・ページURL・タイトル",
    loses: "コード構造・citation・添付",
  },
  {
    id: "vscode_copilot",
    name: "VS Code Chat",
    method: "チャットのExportでJSONを保存する",
    fidelity: "structured",
    extensions: [".json", ".md"],
    keeps: "話者・順序・session id・モデル名",
    loses: "ワークスペースの文脈・添付ファイルの実体",
  },
  {
    id: "github_copilot",
    name: "GitHub Copilot CLI",
    method: "セッションログを保存するか、ターミナル出力を貼り付ける",
    fidelity: "rendered_text",
    extensions: [".md", ".txt"],
    keeps: "話者・順序・実行コマンド",
    loses: "端末の装飾・進行中の表示",
  },
  {
    id: "chatgpt",
    name: "ChatGPT Export",
    method: "設定のデータエクスポートから会話を書き出す",
    fidelity: "structured",
    extensions: [".json", ".zip", ".md"],
    keeps: "話者・順序・作成日時・会話URL",
    loses: "画像・添付の実体、非表示の推論",
  },
  {
    id: "codex",
    name: "Codex session / rollout",
    method: "session / rolloutのJSONを保存する",
    fidelity: "structured",
    extensions: [".json"],
    keeps: "話者・順序・session id",
    loses: "実行環境の状態",
  },
  {
    id: "claude_code",
    name: "Claude Code",
    method: "セッションの記録をMarkdownとして保存するか貼り付ける",
    fidelity: "rich_markdown",
    extensions: [".md", ".txt"],
    keeps: "話者・順序・コードブロック",
    loses: "ツール実行の詳細・添付の実体",
  },
  {
    id: "generic",
    name: "その他のサービス / 手貼り付け",
    method: "会話をMarkdownまたはテキストで貼り付ける。話者の区切りはPreviewで直せる",
    fidelity: "rendered_text",
    extensions: [".md", ".txt"],
    keeps: "本文・おおよその話者",
    loses: "サービス固有のmetadata",
  },
];

/**
 * 取り込み後の保存先（#303）。
 * どこへ行くのか分からないまま投入させない。OneDriveへ自動公開しないことも明示する。
 */
export const CONVERSATION_IMPORT_DESTINATIONS = [
  { label: "会話本文", value: "Tasken内のConversation" },
  { label: "取込原本", value: "raw Artifact（元のファイル・貼り付け内容）" },
  { label: "元URL / session", value: "source locator" },
];

export const CONVERSATION_IMPORT_PRIVACY_NOTE =
  "OneDriveへは自動公開されません。必要な会話だけ、後からAI Contextへ保存できます。";
