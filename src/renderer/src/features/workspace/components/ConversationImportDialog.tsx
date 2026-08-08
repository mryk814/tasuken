import { useState } from "react";
import { IconFileImport, IconClipboard } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { canonicalThemeId } from "../../../../../shared/themeRef.mjs";
import { buildSaveResourceOperations } from "../domain-model/persistence";
import type { Resource } from "../domain-model/types";
import { listActiveChatGroupNames } from "../lib/chatRefs";
import { CHAT_SERVICE_LABELS, type ChatServiceType } from "../lib/chatServices";
import { parseConversation, type ParsedConversation } from "../lib/conversationParser";
import {
  CONVERSATION_IMPORT_DESTINATIONS,
  CONVERSATION_IMPORT_MANIFEST_SAMPLE,
  CONVERSATION_IMPORT_MARKDOWN_SAMPLE,
  CONVERSATION_IMPORT_PRIVACY_NOTE,
  CONVERSATION_IMPORT_PROVIDERS,
} from "../../../../../shared/conversationImportGuide.mjs";
import { uuid } from "../lib/format";
import { previewHtml } from "../lib/markdown";
import { MarkdownPreview } from "./MarkdownPreview";
import type { SaveEntities, Theme } from "../types";

type DialogState =
  | { step: "source" }
  | { step: "loading" }
  | { step: "preview"; parsed: ParsedConversation; rawText: string }
  | { step: "error"; message: string };

export function ConversationImportDialog({
  themes,
  resources,
  initialThemeId,
  saveEntities,
  setToast,
  close,
}: {
  themes: Theme[];
  resources: { chat_group?: string | null; project_id?: string | null; theme_id?: string | null; archived_at?: string | null }[];
  initialThemeId: string;
  saveEntities: SaveEntities;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  close: () => void;
}) {
  const [state, setState] = useState<DialogState>({ step: "source" });
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [linkType, setLinkType] = useState<string>("other");
  const [themeId, setThemeId] = useState(initialThemeId);
  const [chatGroup, setChatGroup] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [busy, setBusy] = useState(false);
  // 対応形式ガイドの開閉（#303）。既定は閉じ、必要なときだけ出す。
  const [guideOpen, setGuideOpen] = useState(false);

  function applyParsed(parsed: ParsedConversation, rawText: string) {
    if (!parsed.messageCount) {
      setState({
        step: "error",
        message: "会話の区切りが見つかりませんでした。発言ごとに「## You」「## Assistant」のような見出しが付いたMarkdownを選んでください。",
      });
      return;
    }
    setTitle(parsed.inferredTitle);
    setUrl(parsed.frontmatter.source_url || "");
    setLinkType(parsed.inferredLinkType);
    setCapturedAt(parsed.frontmatter.captured_at?.slice(0, 10) || "");
    setState({ step: "preview", parsed, rawText });
  }

  async function pickFile() {
    setState({ step: "loading" });
    try {
      const result = await workspaceApi.chooseFiles("会話ログを選択");
      if (result.canceled || !result.files?.length) {
        setState({ step: "source" });
        return;
      }
      const file = result.files[0];
      const preview = await workspaceApi.readFilePreview(file.path);
      if (!preview?.ok || preview.kind !== "text" || !preview.text) {
        setState({ step: "error", message: "ファイルを読み取れませんでした。テキストファイルを選択してください。" });
        return;
      }
      const parsed = parseConversation(preview.text);
      applyParsed(parsed, preview.text);
    } catch (error) {
      setState({ step: "error", message: `ファイル読込に失敗しました。${error instanceof Error ? error.message : ""}` });
    }
  }

  async function pasteClipboard() {
    setState({ step: "loading" });
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setState({ step: "error", message: "クリップボードにテキストがありません。" });
        return;
      }
      const parsed = parseConversation(text);
      applyParsed(parsed, text);
    } catch (error) {
      setState({ step: "error", message: `クリップボードの読み取りに失敗しました。${error instanceof Error ? error.message : ""}` });
    }
  }

  async function importConversation() {
    if (state.step !== "preview") return;
    setBusy(true);
    try {
      const { parsed, rawText } = state;
      const resource: Resource = {
        id: uuid(),
        title: title || parsed.inferredTitle,
        url: url || null,
        description: null,
        body_markdown: rawText,
        project_id: canonicalThemeId(themeId, { defaultPersonal: true }),
        source_record_id: null,
        link_type: linkType !== "other" ? linkType : null,
        reference_status: "inbox",
        importance: null,
        resource_scope: "chat_ref",
        captured_at: capturedAt || new Date().toISOString(),
        chat_group: chatGroup || null,
        parent_resource_id: null,
        sort_order: null,
        archived_at: null,
        source_format: parsed.frontmatter.source_format || "generic_markdown",
        fidelity: parsed.frontmatter.fidelity || null,
        parser_version: "1.0",
        message_count: parsed.messageCount,
      };
      await saveEntities(buildSaveResourceOperations(resource), "会話ログを取り込みました。");
      close();
    } catch (error) {
      setToast(`取り込みに失敗しました。${error instanceof Error ? error.message : ""}`, "danger");
    } finally {
      setBusy(false);
    }
  }

  const groupNames = listActiveChatGroupNames(resources, themeId);

  async function copySample(sample: string, label: string) {
    try {
      await workspaceApi.copyText(sample);
      setToast(`${label}をコピーしました。`, "success");
    } catch (error) {
      setToast(`コピーできませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }
  const previewMessages = state.step === "preview" ? buildPreviewMessages(state.parsed) : [];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className="modal-card conversation-import-dialog" role="dialog" aria-modal="true" aria-labelledby="conv-import-title">
        <header className="modal-card-header">
          <h2 id="conv-import-title">会話ログを取り込む</h2>
          <button type="button" className="text-button compact" onClick={close}>閉じる</button>
        </header>

        {state.step === "source" && (
          <>
            <div className="conversation-import-source">
              <button type="button" className="secondary-button" onClick={pickFile}>
                <IconFileImport size={16} />ファイルを選択
              </button>
              <button type="button" className="secondary-button" onClick={pasteClipboard}>
                <IconClipboard size={16} />クリップボードから貼り付け
              </button>
              <button type="button" className="text-button compact" aria-expanded={guideOpen} onClick={() => setGuideOpen((open) => !open)}>
                対応形式・取り込み方法
              </button>
            </div>
            {/* 何を投入できて、取り込んだ後どこへ入るのかを画面から確認できるようにする（#303）。 */}
            <p className="conversation-import-destinations">
              {CONVERSATION_IMPORT_DESTINATIONS.map((entry) => `${entry.label}: ${entry.value}`).join(" / ")}
              <br />
              <strong>{CONVERSATION_IMPORT_PRIVACY_NOTE}</strong>
            </p>
            {guideOpen && (
              <div className="conversation-import-guide">
                <table>
                  <caption>取り込めるサービスと取得方法</caption>
                  <thead>
                    <tr><th>サービス</th><th>取得方法</th><th>忠実度</th><th>形式</th><th>保持</th><th>失われる可能性</th></tr>
                  </thead>
                  <tbody>
                    {CONVERSATION_IMPORT_PROVIDERS.map((provider) => (
                      <tr key={provider.id}>
                        <th scope="row">{provider.name}</th>
                        <td>{provider.method}</td>
                        <td>{provider.fidelity}</td>
                        <td>{provider.extensions.join(" ")}</td>
                        <td>{provider.keeps}</td>
                        <td>{provider.loses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="conversation-import-sample">
                  <div className="section-heading">
                    <h3>Tasken標準のMarkdown Bundle</h3>
                    <button type="button" className="text-button compact" onClick={() => void copySample(CONVERSATION_IMPORT_MARKDOWN_SAMPLE, "Markdown Bundle例")}>コピー</button>
                  </div>
                  <pre>{CONVERSATION_IMPORT_MARKDOWN_SAMPLE}</pre>
                  <div className="section-heading">
                    <h3>Manifest + transcript（ZIP Bundle）</h3>
                    <button type="button" className="text-button compact" onClick={() => void copySample(CONVERSATION_IMPORT_MANIFEST_SAMPLE, "Manifest例")}>コピー</button>
                  </div>
                  <pre>{CONVERSATION_IMPORT_MANIFEST_SAMPLE}</pre>
                </div>
              </div>
            )}
          </>
        )}

        {state.step === "loading" && (
          <p className="conversation-import-loading">読み込み中…</p>
        )}

        {state.step === "error" && (
          <div className="conversation-import-error">
            <p>{state.message}</p>
            <button type="button" className="secondary-button" onClick={() => setState({ step: "source" })}>やり直す</button>
          </div>
        )}

        {state.step === "preview" && (
          <div className="conversation-import-preview">
            <label>
              タイトル
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            <label>
              URL（任意）
              <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="https://..." />
            </label>
            <div className="conversation-import-row">
              <label>
                サービス
                <select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                  {(Object.entries(CHAT_SERVICE_LABELS) as [ChatServiceType, string][]).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                取得日
                <input type="date" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
              </label>
            </div>
            <label>
              Theme
              <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
                <option value="">未設定</option>
                {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>
              グループ
              <input value={chatGroup} onChange={(e) => setChatGroup(e.target.value)} placeholder="例: 〇〇検討" />
              {groupNames.length > 0 && (
                <div className="group-chip-list">
                  {groupNames.map((g) => (
                    <button key={g} type="button" className={`theme-chip${chatGroup === g ? " is-selected" : ""}`} onClick={() => setChatGroup(g)}>{g}</button>
                  ))}
                </div>
              )}
            </label>

            <div className="conversation-import-stats">
              <span className="badge">{state.parsed.messageCount}件のメッセージ</span>
              {state.parsed.frontmatter.fidelity && <span className="badge badge-secondary">{state.parsed.frontmatter.fidelity}</span>}
            </div>

            {previewMessages.length > 0 && (
              <div className="conversation-import-messages">
                {previewMessages.map((msg, i) => (
                  <div key={i} className={`conversation-import-message conversation-import-role-${msg.role}`}>
                    <div className="conversation-import-role">{msg.displayName}</div>
                    <MarkdownPreview className="markdown-preview" html={previewHtml(msg.content, "markdown")} />
                  </div>
                ))}
                {state.parsed.messageCount > 4 && (
                  <p className="conversation-import-ellipsis">…他 {state.parsed.messageCount - 4}件</p>
                )}
              </div>
            )}
          </div>
        )}

        {state.step === "preview" && (
          <footer className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => setState({ step: "source" })}>戻る</button>
            <button type="button" className="primary-button" disabled={busy || !title.trim()} onClick={importConversation}>
              {busy ? "取り込み中…" : "取り込む"}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}

function buildPreviewMessages(parsed: ParsedConversation) {
  const { messages } = parsed;
  if (messages.length <= 4) return messages;
  return [...messages.slice(0, 2), ...messages.slice(-2)];
}
