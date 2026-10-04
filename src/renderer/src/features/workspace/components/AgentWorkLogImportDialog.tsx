import { useEffect, useRef, useState } from "react";
import { IconFileImport, IconX } from "@tabler/icons-react";
import {
  parseAgentWorkLog,
  type ImportedAgentWorkLog,
} from "../../../../../shared/agentWorkLogImport";
import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps } from "../types";
import { Button } from "./common";

export function AgentWorkLogImportDialog({
  domain,
  setToast,
  close,
  onQueued,
}: Pick<PageProps, "domain" | "setToast"> & {
  close(): void;
  onQueued(id: string, startedAt: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<ImportedAgentWorkLog | null>(null);
  const [repository, setRepository] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function read(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("2MB以下のJSON・JSONLファイルを選択してください。");
      const value = await file.text();
      setRaw(value);
      setPreview(parseAgentWorkLog(value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function queue() {
    setBusy(true);
    setError("");
    try {
      const result = await workspaceApi.importAgentWorkLog(raw, repository ? [repository] : []);
      setToast(
        result.status === "duplicate"
          ? "同じ記録は受信済みです。"
          : "取込内容を確認して採用してください。",
        "success",
      );
      onQueued(result.agent_session_id, preview!.started_at);
      close();
    } catch (cause) {
      setError(
        `取込できませんでした。内容を保持しています。${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="agent-log-import-dialog"
      onCancel={close}
      onClose={close}
      aria-labelledby="agent-log-import-title"
    >
      <header>
        <h2 id="agent-log-import-title">AI作業ログを取り込む</h2>
        <Button aria-label="閉じる" onClick={close}>
          <IconX size={18} aria-hidden="true" />
        </Button>
      </header>
      <p>選んだログから依頼と回答を確認し、採用後に保存します。hooks の設定は不要です。</p>
      <label className="agent-log-file">
        <IconFileImport size={22} aria-hidden="true" />
        JSON・JSONLを選択
        <input
          type="file"
          accept=".json,.jsonl,application/json,application/x-ndjson"
          disabled={busy}
          onChange={(event) => void read(event.target.files?.[0])}
          aria-describedby="agent-log-import-help"
        />
      </label>
      <small id="agent-log-import-help">
        生ログ: Codex rollout・Claude Code transcript。ほかの provider は対応する版付きJSON。
      </small>
      {busy && <p role="status">読み込み・検証中…</p>}
      {error && (
        <p className="agent-log-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="agent-log-import-preview">
          <dl>
            <dt>依頼</dt>
            <dd>{preview.intent.summary}</dd>
            <dt>成果</dt>
            <dd>{preview.outcome.summary}</dd>
            <dt>観測範囲</dt>
            <dd>
              {new Date(preview.started_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} ～{" "}
              {new Date(preview.observation.observed_until).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}{" "}
              (日本時間・最終観測)
            </dd>
            <dt>収録</dt>
            <dd>
              {preview.observation.coverage === "partial" ? "一部" : "選択範囲全体"} ·{" "}
              {preview.request_events.length}依頼 / {preview.response_checkpoints.length}回答
            </dd>
          </dl>
          <label>
            関連Repository
            <select value={repository} onChange={(event) => setRepository(event.target.value)}>
              <option value="">未分類</option>
              {domain.repository_contexts.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" disabled={busy} onClick={() => void queue()}>
            確認へ進む
          </Button>
        </div>
      )}
      <details>
        <summary>対応形式と保存内容</summary>
        <p>
          Codex は sessions/YYYY/MM/DD の rollout-*.jsonl、Claude Code は projects 配下の Session
          JSONL を選びます。保存先の変更やログ自動探索は行いません。2MB以内の単一Sessionが対象です。
        </p>
        <p>
          依頼と回答の本文だけを取り込みます。tool入出力・推論・添付は除外し、既知のcredential表記とローカルパスを伏せます。保存前に本文を確認してください。版付き
          tasken-ai-work-log/1 も利用できます。
        </p>
      </details>
    </dialog>
  );
}
