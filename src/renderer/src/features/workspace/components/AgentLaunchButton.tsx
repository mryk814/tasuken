import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AI_ICON } from "../../../pages/semanticIcons";
import type { AgentLaunchClient, TaskAgentClientId } from "../../../../../shared/agentLaunch";
import { normalizeLocalRepositoryPath } from "../../../../../shared/repositoryContext.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import type { Task } from "../domain-model/types";
import { buildSaveTaskOperations } from "../domain-model/persistence";
import type { BaseRecord, SaveEntities, Theme } from "../types";
import {
  agentLaunchWorkspaceGroups,
  initialAgentLaunchDirectory,
  isRegisteredAgentLaunchDirectory,
} from "./AgentLaunchModel";
import { Button } from "./common";
import "./AgentLaunchButton.css";

const preferenceKey = "tasken.agentLaunch.local";
function previousChoice(): { clientId: TaskAgentClientId; cwd: string } {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
    return {
      clientId: value.clientId === "claude_code" ? "claude_code" : "codex",
      cwd: typeof value.cwd === "string" ? value.cwd : "",
    };
  } catch {
    return { clientId: "codex", cwd: "" };
  }
}

export function AgentLaunchButton({
  task,
  themes,
  repositoryContexts,
  saveEntities,
  setToast,
}: {
  task: Task;
  themes: Theme[];
  repositoryContexts: BaseRecord[];
  saveEntities: SaveEntities;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(previousChoice);
  const [clients, setClients] = useState<AgentLaunchClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const launchable =
    !["done", "cancelled"].includes(task.state) &&
    (!task.work_state || ["not_delegated", "ready_for_agent"].includes(task.work_state));
  const selected = clients.find((client) => client.id === choice.clientId);
  const workspaceGroups = agentLaunchWorkspaceGroups(task, themes, repositoryContexts);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const currentDialog = dialog.current;
    currentDialog?.showModal();
    let active = true;
    void workspaceApi
      .agentLaunchClients()
      .then((result) => {
        if (active) setClients(result);
      })
      .catch((failure) => {
        if (active) setError(String(failure instanceof Error ? failure.message : failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      currentDialog?.close();
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  async function chooseFolder() {
    try {
      const directory = await workspaceApi.chooseDirectory("AIの作業フォルダを選ぶ");
      if (!directory.canceled && directory.path) {
        const cwd = normalizeLocalRepositoryPath(directory.path) || directory.path;
        setChoice((current) => ({ ...current, cwd }));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function launch() {
    if (busyRef.current || !selected?.available || !choice.cwd || !launchable) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      let preparedVersion = Number((task as Task & { version?: number }).version);
      if (
        task.intended_executor !== "ai_agent" ||
        task.work_state !== "ready_for_agent" ||
        task.executor_identity !== selected.label ||
        !task.work_attempt_id
      ) {
        const saved = await saveEntities(
          buildSaveTaskOperations({
            ...task,
            intended_executor: "ai_agent",
            executor_identity: selected.label,
            work_state: "ready_for_agent",
            work_attempt_id: crypto.randomUUID(),
            work_started_at: null,
            work_reported_at: null,
            work_review_note: null,
            handoff_requested_at: new Date().toISOString(),
          }),
          "AIへの依頼を準備しました。",
          "main_ui",
          { copyAiRequest: false },
        );
        const savedTask = saved.find((entity) => entity.id === task.id);
        if (!savedTask) throw new Error("依頼を保存できませんでした。画面を更新してください。");
        preparedVersion = Number(savedTask.version);
      }
      await workspaceApi.launchAgent({
        taskId: task.id,
        expectedVersion: preparedVersion,
        ...choice,
      });
      try {
        localStorage.setItem(preferenceKey, JSON.stringify(choice));
      } catch {
        /* 起動結果は保持する */
      }
      setOpen(false);
      setToast(
        `${selected.label}を開きました。会話はCLIで続け、報告はTaskenで確認できます。`,
        "success",
      );
    } catch (failure) {
      setError(
        (failure instanceof Error ? failure.message : String(failure)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        compact
        variant="ghost"
        disabled={!launchable}
        title={launchable ? "Claude Code / Codexに渡す" : "進行中の会話はCLI側で続けてください"}
        onClick={(event) => {
          event.stopPropagation();
          setLoading(true);
          setError("");
          const previous = previousChoice();
          setChoice({
            ...previous,
            cwd: initialAgentLaunchDirectory(workspaceGroups, previous.cwd),
          });
          setOpen(true);
        }}
      >
        <AI_ICON size={16} aria-hidden="true" />
        AIに渡す
      </Button>
      {open
        ? createPortal(
            <dialog
              ref={dialog}
              className="agent-launch-dialog"
              aria-labelledby={headingId}
              onClick={(event) => event.stopPropagation()}
              onCancel={(event) => {
                event.preventDefault();
                if (!busyRef.current) setOpen(false);
              }}
            >
              <h2 id={headingId}>AIに渡す</h2>
              <p className="agent-launch-title">{task.title}</p>
              <label>
                任せるAI
                <select
                  value={choice.clientId}
                  disabled={loading || busy}
                  onChange={(event) =>
                    setChoice((current) => ({
                      ...current,
                      clientId: event.target.value as TaskAgentClientId,
                    }))
                  }
                >
                  <option value="codex">Codex</option>
                  <option value="claude_code">Claude Code</option>
                </select>
              </label>
              {loading ? (
                <p role="status">利用できるCLIを確認しています…</p>
              ) : selected && !selected.available ? (
                <p role="status">{selected.reason}</p>
              ) : null}
              <fieldset className="agent-launch-workspaces" disabled={busy}>
                <legend>作業先</legend>
                {workspaceGroups.length ? (
                  <div className="agent-launch-workspace-list">
                    {workspaceGroups.map((group) => (
                      <section key={group.id}>
                        <h3>
                          {group.label}
                          {group.related ? <span>このタスクの関連先</span> : null}
                        </h3>
                        {group.options.map((workspace) => (
                          <label
                            className={`agent-launch-workspace${choice.cwd === workspace.cwd && workspace.cwd ? " is-selected" : ""}`}
                            key={workspace.id}
                          >
                            <input
                              type="radio"
                              name={`${headingId}-workspace`}
                              checked={Boolean(workspace.cwd) && choice.cwd === workspace.cwd}
                              disabled={!workspace.cwd}
                              onChange={() =>
                                setChoice((current) => ({ ...current, cwd: workspace.cwd }))
                              }
                            />
                            <span>
                              <strong>{workspace.label}</strong>
                              {workspace.path ? <small>{workspace.path}</small> : null}
                              {workspace.unavailableReason ? (
                                <small>{workspace.unavailableReason}</small>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="agent-launch-note">登録済みの作業先がありません。</p>
                )}
              </fieldset>
              <div className="agent-launch-folder">
                <Button compact variant="ghost" disabled={busy} onClick={() => void chooseFolder()}>
                  別のフォルダを選ぶ
                </Button>
                {choice.cwd && !isRegisteredAgentLaunchDirectory(workspaceGroups, choice.cwd) ? (
                  <p title={choice.cwd}>{choice.cwd}</p>
                ) : !choice.cwd ? (
                  <p>作業先を選んでください</p>
                ) : null}
              </div>
              <p className="agent-launch-note">会話はCLI、報告はTaskenで受け取ります。</p>
              {error ? (
                <p className="agent-launch-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="agent-launch-actions">
                <Button disabled={busy} onClick={() => setOpen(false)}>
                  閉じる
                </Button>
                <Button
                  variant="primary"
                  disabled={loading || busy || !selected?.available || !choice.cwd || !launchable}
                  onClick={() => void launch()}
                >
                  {busy ? "起動しています…" : "AIを起動して渡す"}
                </Button>
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
