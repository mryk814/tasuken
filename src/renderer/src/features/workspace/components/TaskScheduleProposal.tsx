import { useEffect, useRef, useState } from "react";
import "./TaskScheduleProposal.css";
import {
  buildTaskScheduleProposalCommand,
  taskScheduleFieldLabels,
  taskScheduleSnapshot,
  type TaskScheduleProposal as Proposal,
  type TaskScheduleProposalRequest,
} from "../../../../../shared/taskScheduleProposal";
import type { Entity } from "../../../../../shared/types/workspace";
import type { ExecuteCommand } from "../types";
import { workspaceApi } from "../../../services/workspaceApi";

function errorMessage(cause: unknown) {
  return (cause instanceof Error ? cause.message : String(cause)).replace(
    /^Error invoking remote method '[^']+': (?:ApplicationCommandError: |Error: )?/,
    "",
  );
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "未設定";
  if (value === "once_within_window") return "期間内に一度";
  if (value === "ongoing") return "期間を通して";
  return String(value);
}

export function TaskScheduleProposal({
  task,
  schedule,
  executeCommand,
  onEdit,
  initiallyOpen = false,
}: {
  task: Entity;
  schedule: Entity | null;
  executeCommand: ExecuteCommand;
  onEdit: (instruction: string) => void;
  initiallyOpen?: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"proposing" | "saving" | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<{
    proposal: Proposal;
    request: TaskScheduleProposalRequest;
    commandId: string;
    issuedAt: string | null;
  } | null>(null);
  const current = task ? taskScheduleSnapshot(task, schedule) : null;
  const stale = Boolean(
    preview && JSON.stringify(current) !== JSON.stringify(preview.request.current),
  );
  const changes = preview ? Object.entries(preview.proposal.patch) : [];
  useEffect(() => {
    if (preview) previewRef.current?.focus({ preventScroll: true });
  }, [preview]);
  useEffect(() => {
    if (error || message) instructionRef.current?.focus({ preventScroll: true });
  }, [error, message]);

  async function propose() {
    if (active.current || !current || !instruction.trim()) return;
    active.current = true;
    const run = ++generation.current;
    setBusy("proposing");
    setError("");
    setMessage("");
    setPreview(null);
    const request = {
      current,
      instruction,
      inputAt: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    try {
      const proposal = await workspaceApi.proposeTaskSchedule(request);
      if (run === generation.current)
        setPreview({
          proposal,
          request,
          commandId: crypto.randomUUID(),
          issuedAt: null,
        });
    } catch (cause) {
      if (run === generation.current)
        setError(`提案を取得できませんでした。${errorMessage(cause)}`);
    } finally {
      if (run === generation.current) {
        active.current = false;
        setBusy(null);
      }
    }
  }
  async function apply() {
    if (active.current || !preview || !task || stale || !changes.length) return;
    active.current = true;
    setBusy("saving");
    setError("");
    try {
      const issuedAt = preview.issuedAt ?? new Date().toISOString();
      if (!preview.issuedAt) setPreview({ ...preview, issuedAt });
      const command = buildTaskScheduleProposalCommand(
        task,
        schedule,
        preview.proposal,
        preview.request.current,
        preview.commandId,
        issuedAt,
      );
      await executeCommand(command);
      setPreview(null);
      setMessage("日程を更新しました。");
    } catch (cause) {
      setError(`保存できませんでした。${errorMessage(cause)}`);
    } finally {
      active.current = false;
      setBusy(null);
    }
  }
  return (
    <details
      className="drawer-subsection drawer-disclosure task-schedule-proposal"
      open={initiallyOpen}
    >
      <summary>
        <span className="drawer-disclosure-title">文章から日程を変更</span>
      </summary>
      <div className="drawer-disclosure-body">
        <label className="field">
          <span>日程変更の指示</span>
          <textarea
            ref={instructionRef}
            autoFocus={initiallyOpen}
            value={instruction}
            maxLength={12000}
            rows={3}
            disabled={busy !== null}
            placeholder="来週月曜の15時から30分に"
            onChange={(event) => {
              setInstruction(event.target.value);
              setPreview(null);
              setMessage("");
            }}
          />
        </label>
        <p className="field-help">このTaskの現在の予定と指示を、設定済みのAIへ送信します。</p>
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            disabled={busy !== null || !instruction.trim() || !current}
            onClick={() => void propose()}
          >
            {busy === "proposing" ? "提案を取得中…" : "変更案を確認"}
          </button>
          {busy === "proposing" && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                generation.current++;
                active.current = false;
                setBusy(null);
              }}
            >
              取消し
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy === "saving"}
            onClick={() => onEdit(instruction)}
          >
            通常の日程編集
          </button>
        </div>
        {error && (
          <p role="alert" className="field-help">
            {error} 指示は保持されています。
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {preview && (
          <section aria-label="日程の変更案" ref={previewRef} tabIndex={-1}>
            {preview.proposal.warnings.length > 0 && (
              <ul>
                {preview.proposal.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
            {changes.length ? (
              <table>
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>変更前</th>
                    <th>変更後</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(([key, value]) => (
                    <tr key={key}>
                      <th>
                        {taskScheduleFieldLabels[key as keyof typeof taskScheduleFieldLabels]}
                      </th>
                      <td>
                        {display(
                          preview.request.current[key as keyof typeof taskScheduleFieldLabels],
                        )}
                      </td>
                      <td>{value === null ? "解除" : display(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>
                適用できる変更はありません。指示を具体的にするか、通常の日程編集を使ってください。
              </p>
            )}
            {stale && (
              <p role="alert">
                Taskまたは日程が更新されています。現在の予定で変更案を作り直してください。
              </p>
            )}
            <div className="button-row">
              <button
                type="button"
                className="primary-button"
                disabled={busy !== null || stale || !changes.length}
                onClick={() => void apply()}
              >
                {busy === "saving" ? "保存中…" : "この日程を適用"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy === "saving"}
                onClick={() => {
                  setPreview(null);
                  setError("");
                }}
              >
                取消し
              </button>
            </div>
          </section>
        )}
      </div>
    </details>
  );
}
