import { IconCloudCheck, IconCloudUpload, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { parseConversationContextMessages } from "../../../../../shared/conversationContext.mjs";
import type { ConversationContextPreviewResult, ConversationContextScope } from "../../../../../shared/ipc/contracts";
import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord } from "../types";

const STATE_LABELS: Record<string, string> = {
  not_published: "ローカルのみ",
  published: "OneDriveへ公開済み",
  dirty: "更新あり",
  published_but_blocked: "公開範囲外・解除が必要",
  publishing: "公開処理を再開待ち",
  publish_failed: "公開に失敗",
  removing: "解除処理を再開待ち",
  removal_failed: "解除に失敗",
  removed: "AI Contextから解除済み",
};

export function ConversationContextPanel({
  resource,
  setToast,
}: {
  resource: BaseRecord;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}) {
  const [preview, setPreview] = useState<ConversationContextPreviewResult | null>(null);
  const [scope, setScope] = useState<ConversationContextScope>("full");
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const messages = useMemo(() => parseConversationContextMessages(resource.body_markdown), [resource.body_markdown]);
  const selectableMessages = messages.filter((message) => message.role === "user" || message.role === "assistant");

  async function refresh(nextScope?: ConversationContextScope, nextSelected?: number[], usePersisted = false) {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const requestedScope = nextScope || scope;
    const requestedSelected = nextSelected || selected;
    setLoading(true);
    setError("");
    try {
      const result = await workspaceApi.previewConversationContext(usePersisted
        ? { conversationId: resource.id }
        : { conversationId: resource.id, scope: requestedScope, selectedMessageIndexes: requestedSelected });
      if (sequence !== requestSequence.current) return;
      setPreview(result);
      setScope(result.scope);
      setSelected(result.selectedMessageIndexes);
    } catch {
      if (sequence !== requestSequence.current) return;
      setError("公開Previewを作れませんでした。ThemeとAI公開範囲を確認して再試行してください。");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(undefined, undefined, true);
    // The Main-side preview reads the persisted Resource. Workspace change events
    // remount the Viewer; local publication state is refreshed after each action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.id]);

  function changeScope(next: ConversationContextScope) {
    const nextSelected = next === "selected_turns"
      ? (selected.length ? selected : selectableMessages.map((message) => message.index))
      : selectableMessages.map((message) => message.index);
    setScope(next);
    setSelected(nextSelected);
    void refresh(next, nextSelected);
  }

  function toggleMessage(index: number) {
    const next = selected.includes(index) ? selected.filter((entry) => entry !== index) : [...selected, index].sort((a, b) => a - b);
    setSelected(next);
    void refresh("selected_turns", next);
  }

  async function publish() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await workspaceApi.publishConversationContext({
        conversationId: resource.id,
        scope: preview.scope,
        selectedMessageIndexes: preview.selectedMessageIndexes,
        expectedContentHash: preview.contentHash,
        plannedPublishedAt: preview.plannedPublishedAt,
      });
      if (result.publicationState === "stale_preview") {
        setToast(result.error || "Conversationが更新されています。Previewを確認し直してください。", "warning");
      } else {
        setToast(result.written ? "ConversationをAI Contextへ保存しました。" : "AI Contextは最新です。", "success");
      }
      if (result.warning) setToast(result.warning, "warning");
      await refresh(preview.scope, preview.selectedMessageIndexes);
    } catch {
      setToast("AI Contextへ保存できませんでした。OneDriveの同期状態とTheme設定を確認して再試行してください。", "danger");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const result = await workspaceApi.removeConversationContext(resource.id);
      setToast("ConversationをAI Contextから外しました。ローカルの会話は残っています。", "success");
      if (result.warning) setToast(result.warning, "warning");
      await refresh();
    } catch {
      setToast("AI Contextから外せませんでした。OneDriveの同期状態を確認して再試行してください。", "danger");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const published = preview && ["published", "dirty", "published_but_blocked", "publishing", "publish_failed", "removing", "removal_failed"].includes(preview.publicationState);
  const publishLabel = preview?.publicationState === "dirty" || preview?.publicationState === "published_but_blocked"
    ? "公開内容を更新"
    : "AI Contextへ保存";

  return (
    <section className="conversation-context-panel" aria-label="Conversation AI Context">
      <div className="conversation-context-heading">
        <div>
          <strong>AI Context</strong>
          {preview && <span className={`conversation-context-state is-${preview.publicationState}`}>{STATE_LABELS[preview.publicationState] || preview.publicationState}</span>}
        </div>
        <div className="conversation-context-actions">
          {preview?.publicationState === "published" && <span className="conversation-context-published"><IconCloudCheck size={15} />OneDriveへ公開済み</span>}
          {preview && preview.publicationState !== "published" && (
            <button type="button" className="secondary-button compact" disabled={busy || loading || !preview.allowed} onClick={() => { void publish(); }}>
              {preview.publicationState === "dirty" ? <IconRefresh size={15} /> : <IconCloudUpload size={15} />}{publishLabel}
            </button>
          )}
          {published && (
            <button type="button" className="text-button compact danger" disabled={busy} onClick={() => { void remove(); }}>
              <IconTrash size={15} />AI Contextから外す
            </button>
          )}
        </div>
      </div>

      {loading && <p className="conversation-context-status" role="status">公開Previewを確認中…</p>}
      {error && <p className="conversation-context-status is-error" role="alert">{error}</p>}
      {preview && !loading && (
        <>
          <div className="conversation-context-scope" role="group" aria-label="公開する発言">
            <button type="button" disabled={busy || loading} className={`text-button compact ${scope === "full" ? "is-active" : ""}`} onClick={() => changeScope("full")}>会話全体</button>
            <button type="button" disabled={busy || loading} className={`text-button compact ${scope === "selected_turns" ? "is-active" : ""}`} onClick={() => changeScope("selected_turns")}>発言を選択</button>
          </div>
          {scope === "selected_turns" && (
            <div className="conversation-context-turns">
              {selectableMessages.map((message) => (
                <label key={message.index}>
                  <input type="checkbox" disabled={busy || loading} checked={selected.includes(message.index)} onChange={() => toggleMessage(message.index)} />
                  <span>{message.index + 1}. {message.role === "user" ? "User" : "Assistant"}</span>
                  <small>{message.content.replace(/\s+/g, " ").slice(0, 80)}</small>
                </label>
              ))}
            </div>
          )}
          <p className="conversation-context-path"><span>保存先</span><code>{preview.storageRootId}:{preview.relativePath}</code></p>
          <dl className="conversation-context-metadata">
            <div><dt>Theme</dt><dd>{preview.theme.title || preview.theme.id}</dd></div>
            <div><dt>Source</dt><dd>{preview.sourceUrl || "なし"}</dd></div>
            <div><dt>Summary</dt><dd>{preview.summary || "未設定"}</dd></div>
            <div><dt>Freshness</dt><dd>{preview.freshness}</dd></div>
            <div><dt>Authority</dt><dd>{preview.authority}</dd></div>
            <div><dt>AI visibility</dt><dd>{preview.aiVisibility.join(", ") || "local only"}</dd></div>
          </dl>
          {preview.blockingReasons.length > 0 && (
            <ul className="conversation-context-warnings is-blocked">
              {preview.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
          {preview.warnings.length > 0 && (
            <ul className="conversation-context-warnings">
              {preview.warnings.includes("secret_candidate") && <li>秘密情報の可能性がある行を除外しました。</li>}
              {preview.warnings.includes("local_path") && <li>ローカルパスを含む行を除外しました。</li>}
              {(preview.warnings.includes("system_turn") || preview.warnings.includes("tool_turn")) && <li>system・tool・raw outputは公開しません。</li>}
            </ul>
          )}
          <details className="conversation-context-preview">
            <summary>公開内容を確認</summary>
            <pre>{preview.content}</pre>
          </details>
        </>
      )}
    </section>
  );
}
