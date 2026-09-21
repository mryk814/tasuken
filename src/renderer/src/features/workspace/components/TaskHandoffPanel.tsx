import { useCallback, useEffect, useState } from "react";

import {
  HANDOFF_DELEGATE_LABELS,
  describeHandoffContextChange,
  handoffContextRef,
  isSameHandoffContextRef,
  type HandoffDelegate,
} from "../../../../../shared/contracts/task/public.ts";
import type { CommandEnvelope } from "../../../../../shared/applicationCommand";
import { workspaceApi } from "../../../services/workspaceApi";
import type { Task } from "../domain-model/types";
import { buildSaveTaskOperations } from "../domain-model/persistence";
import type { SaveEntities, ExecuteCommand } from "../types";
import { uuid } from "../lib/format";
import { buildTaskAiRequest, type HandoffRequestInfo } from "../lib/taskAiRequest";
import { Button } from "./common";

type PreviewEntry = {
  ref?: { type?: string; id?: string } | null;
  label?: string | null;
  includedReason?: string | null;
  visibility?: string[] | null;
  freshness?: string | null;
};

type PreviewResult = {
  state?: string;
  error?: string;
  preview?: {
    included?: PreviewEntry[];
    excluded?: unknown[];
    warnings?: Array<{ code?: string; message?: string }>;
    truncation?: { truncated?: boolean; reasons?: string[] };
    estimatedCharacters?: number;
    counts?: Record<string, number>;
  } | null;
};

const DELEGATE_OPTIONS: HandoffDelegate[] = ["external_ai", "codex", "claude_code", "other"];

function previewSummary(result: PreviewResult | null): string {
  if (!result) return "Contextを確認していません。";
  if (result.state === "error") return result.error || "Contextを取得できませんでした。";
  const preview = result.preview;
  if (!preview) return "Contextを取得できませんでした。";
  const included = preview.included?.length || 0;
  if (!included) return "渡せるContextがありません。Task本文とThemeを確認してください。";
  const parts = [`渡す項目 ${included}件`];
  if (preview.excluded?.length) parts.push(`除外 ${preview.excluded.length}件`);
  if (preview.truncation?.truncated) parts.push("一部を切り詰めています");
  if (result.state === "empty") parts.push("公開範囲が未設定です");
  return parts.join("／");
}

/**
 * Task詳細からのHandoff（#598）。
 *
 * **Taskの正本を変えない。** 委任先と依頼内容をTaskへ記録するだけで、
 * 本文・完了条件・ownerはそのまま残る。
 * Context Previewとコピーする依頼は同じ参照版を指し、準備時にもう一度確かめる。
 * 外部AIの開始を観測するまでは「開始待ち」と表示し、取得済みとは扱わない。
 */
export function TaskHandoffPanel({
  task,
  saveEntities,
  executeCommand,
  setToast,
}: {
  task: Task;
  saveEntities: SaveEntities;
  executeCommand?: ExecuteCommand;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}) {
  const [delegate, setDelegate] = useState<HandoffDelegate>(() =>
    task.executor_identity === "Claude Code"
      ? "claude_code"
      : task.executor_identity === "Codex"
        ? "codex"
        : "external_ai",
  );
  const [expectedResult, setExpectedResult] = useState(String(task.handoff_expected_result || ""));
  const [instruction, setInstruction] = useState(String(task.handoff_instruction || ""));
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmedRef, setConfirmedRef] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const workState =
    task.work_state ||
    (task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated");
  const waitingForStart = Boolean(task.handoff_requested_at) && workState === "ready_for_agent";
  /** 確認待ちは先に採用か差戻しをしてもらう。それ以外は明示操作で任せ直せる。 */
  const reassignable = !["reported_done", "needs_human_review"].includes(workState);

  const loadPreview = useCallback(async () => {
    setBusy(true);
    try {
      const result = (await workspaceApi.previewAiContext({
        scope: { type: "task", id: task.id },
        audience: "coding_agent",
      })) as PreviewResult;
      setPreview(result);
      return result;
    } catch (error) {
      setPreview({ state: "error", error: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setBusy(false);
    }
  }, [task.id]);

  useEffect(() => {
    void loadPreview().then((result) => {
      if (result?.preview) setConfirmedRef(handoffContextRef(result.preview));
    });
  }, [loadPreview]);

  const requestInfo: HandoffRequestInfo = {
    delegateLabel: HANDOFF_DELEGATE_LABELS[delegate],
    expectedResult,
    instruction,
    contextRef: confirmedRef,
  };

  const copyRequest = useCallback(
    async (ref: string | null) => {
      try {
        await workspaceApi.copyText(
          buildTaskAiRequest([task], { ...requestInfo, contextRef: ref }),
        );
        return true;
      } catch {
        return false;
      }
    },
    // requestInfoは毎renderで作り直すため、依存はプリミティブに絞る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [task, delegate, expectedResult, instruction],
  );

  async function prepareHandoff() {
    if (busy) return;
    // 準備の直前にContextを取り直し、Previewで確認した参照版と一致するか確かめる。
    const fresh = await loadPreview();
    if (!fresh?.preview) {
      setToast(
        "Contextを確認できないため準備できません。時間をおいて再試行してください。",
        "danger",
      );
      return;
    }
    const freshRef = handoffContextRef(fresh.preview);
    if (!isSameHandoffContextRef(confirmedRef, freshRef)) {
      setConfirmedRef(freshRef);
      setStaleNotice(
        confirmedRef
          ? describeHandoffContextChange(confirmedRef, freshRef)
          : "Contextを確認しました。内容を確かめて、もう一度準備してください。",
      );
      setToast("Contextが更新されました。内容を確認してから準備してください。", "warning");
      return;
    }
    setStaleNotice(null);
    setBusy(true);
    try {
      await saveEntities(
        buildSaveTaskOperations({
          ...task,
          intended_executor: "ai_agent",
          executor_identity: HANDOFF_DELEGATE_LABELS[delegate],
          work_state: "ready_for_agent",
          work_started_at: null,
          work_reported_at: null,
          work_review_note: null,
          handoff_expected_result: expectedResult.trim() || null,
          handoff_instruction: instruction.trim() || null,
          handoff_context_ref: freshRef,
          handoff_requested_at: new Date().toISOString(),
        }),
        "AIへの依頼を準備しました。依頼文を外部AIへ渡すと開始できます。",
        "main_ui",
      );
      const copied = await copyRequest(freshRef);
      setToast(
        copied
          ? "AIへの依頼を準備し、依頼文をコピーしました。外部AIへ渡すと開始できます。"
          : "依頼は準備しましたが、依頼文をコピーできませんでした。「依頼をコピー」から再試行してください。",
        copied ? "success" : "warning",
      );
    } catch (error) {
      setToast(
        `AIへの依頼を準備できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function releaseDelegation() {
    if (busy) return;
    setBusy(true);
    try {
      await saveEntities(
        buildSaveTaskOperations({
          ...task,
          intended_executor: "self",
          executor_identity: null,
          work_state: "not_delegated",
          handoff_expected_result: null,
          handoff_instruction: null,
          handoff_context_ref: null,
          handoff_requested_at: null,
        }),
        "委任を解除しました。外部AIでの実行停止は保証されません。",
        "main_ui",
      );
    } catch (error) {
      setToast(
        `委任を解除できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * 委任を解除して、新しい作業単位で任せ直す（#602）。
   *
   * 実行中の相手を止める保証はないため、「停止」とは書かない。作業単位が変わるので、
   * 前の相手の遅い報告は履歴として読め、いまの判断を動かさない。
   */
  async function reassignWork() {
    if (busy || !executeCommand) return;
    setBusy(true);
    try {
      await executeCommand({
        commandId: uuid(),
        name: "ReassignTaskWork",
        payload: {
          taskId: task.id,
          executorIdentity: HANDOFF_DELEGATE_LABELS[delegate],
        },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [
          {
            type: "task",
            id: task.id,
            version: Number((task as { version?: number }).version || 0),
          },
        ],
        issuedAt: new Date().toISOString(),
      } as unknown as CommandEnvelope);
      setToast(
        "委任を解除して、新しい作業単位で任せ直しました。外部AIでの実行停止は保証されません。",
        "success",
      );
    } catch (error) {
      setToast(
        `任せ直せませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="task-handoff">
      {" "}
      <div className="section-heading">
        <h4>AIへ任せる</h4>
        {waitingForStart ? (
          <span className="task-handoff-state">開始待ち</span>
        ) : workState === "in_progress" ? (
          <span className="task-handoff-state is-working">作業中</span>
        ) : null}
      </div>
      {waitingForStart ? (
        <p className="task-handoff-note">
          {String(task.executor_identity || "外部AI")}へ依頼文を渡すと開始できます。
          開始の報告を受けるまでは「開始待ち」です。
        </p>
      ) : null}
      <div className="task-handoff-fields">
        <label>
          任せる相手
          <select
            value={delegate}
            onChange={(event) => setDelegate(event.target.value as HandoffDelegate)}
          >
            {DELEGATE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {HANDOFF_DELEGATE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          期待する成果（任意）
          <textarea
            rows={2}
            value={expectedResult}
            onChange={(event) => setExpectedResult(event.target.value)}
            placeholder="例: 3条件の比較表と、採用した根拠"
          />
        </label>
        <label>
          追加指示（任意）
          <textarea
            rows={2}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="例: 既存の測定条件を変えずに進める"
          />
        </label>
      </div>
      <div className="task-handoff-preview" role="group" aria-label="Context Preview">
        <div className="task-handoff-preview-head">
          <strong>Context Preview</strong>
          <Button variant="ghost" compact onClick={() => void loadPreview()} disabled={busy}>
            再確認
          </Button>
        </div>
        <p>{previewSummary(preview)}</p>
        {preview?.preview?.included?.length ? (
          <ul className="task-handoff-preview-list">
            {preview.preview.included.slice(0, 8).map((entry, index) => (
              <li key={`${entry.ref?.type || "item"}:${entry.ref?.id || index}`}>
                <span>{`${entry.ref?.type || "item"}:${entry.ref?.id || ""}`}</span>
                {entry.includedReason ? <em>{entry.includedReason}</em> : null}
                {entry.freshness ? <em>{entry.freshness}</em> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {preview?.preview?.truncation?.truncated ? (
          <p className="task-handoff-warning">一部のContextは切り詰められています。</p>
        ) : null}
        {(preview?.preview?.warnings || []).slice(0, 2).map((warning) => (
          <p className="task-handoff-warning" key={warning.code || warning.message}>
            {warning.message || warning.code}
          </p>
        ))}
      </div>
      {staleNotice ? (
        <p className="task-handoff-warning" role="status">
          {staleNotice}
        </p>
      ) : null}
      <p className="task-handoff-note">
        準備しても外部AIは自動で起動しません。依頼文を渡したあと、開始の報告を受けるまで「開始待ち」です。
      </p>
      <div className="task-handoff-actions">
        <Button variant="primary" onClick={() => void prepareHandoff()} disabled={busy}>
          AIへの依頼を準備
        </Button>
        <Button
          variant="secondary"
          onClick={() => void copyRequest(confirmedRef)}
          disabled={busy || !confirmedRef}
        >
          依頼をコピー
        </Button>
        {waitingForStart || task.intended_executor === "ai_agent" ? (
          <Button variant="secondary" onClick={() => void releaseDelegation()} disabled={busy}>
            委任を解除
          </Button>
        ) : null}
        {/* 実行中でも、明示操作として新しい作業単位へ任せ直せる（安易なラベル差し替えはしない）。 */}
        {task.intended_executor === "ai_agent" && reassignable ? (
          <Button variant="secondary" onClick={() => void reassignWork()} disabled={busy}>
            新しい作業単位で任せ直す
          </Button>
        ) : null}
      </div>
    </div>
  );
}
