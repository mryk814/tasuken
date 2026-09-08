import { useEffect, useRef, useState } from "react";
import type { RecordWorkLogCommand } from "../../../../../shared/workLog";
import { PERSONAL_DEFAULT_THEME_ID } from "../../../../../shared/themeRef.mjs";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import type { BaseRecord } from "../types";
import { Button } from "./common";
import "./WorkLogDialog.css";

export function WorkLogDialog({
  open,
  today,
  themes,
  tasks,
  close,
  saved,
}: {
  open: boolean;
  today: string;
  themes: BaseRecord[];
  tasks: Array<{ id: string; title: string }>;
  close(): void;
  saved(noteId: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<RecordWorkLogCommand | null>(null);
  const busy = useRef(false);
  const edited = useRef(false);
  const [body, setBody] = useState("");
  const [date, setDate] = useState(today);
  const [theme, setTheme] = useState("");
  const [task, setTask] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const record = useWorkspaceStore((state) => state.recordWorkLog);
  useEffect(() => {
    if (open && !edited.current) setDate(today);
  }, [open, today]);
  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    bodyInput.current?.focus({ preventScroll: true });
    return () => {
      dialog.current?.close();
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
  function changed() {
    edited.current = true;
    pending.current = null;
    setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !body.trim()) return;
    busy.current = true;
    setSaving(true);
    setError("");
    const command = pending.current ?? {
      schemaVersion: 1,
      commandName: "RecordWorkLog",
      commandId: crypto.randomUUID(),
      issuedAt: new Date().toISOString(),
      body,
      performedDate: date,
      themeId: theme || null,
      taskId: task || null,
    };
    pending.current = command;
    try {
      const receipt = await record(command);
      pending.current = null;
      edited.current = false;
      setBody("");
      setDate(today);
      setTheme("");
      setTask("");
      saved(receipt.noteId);
      close();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <dialog
      className="work-log-dialog"
      ref={dialog}
      aria-labelledby="work-log-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy.current) close();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="work-log-title">やったことを記録</h2>
        <p className="muted">自分が行ったことを、実施日とともに残します。</p>
        <fieldset disabled={saving}>
          <label>
            やったこと（必須）
            <textarea
              ref={bodyInput}
              value={body}
              required
              rows={7}
              placeholder="例：試料Aの測定を行った。結果の解釈はこれから。"
              onChange={(event) => {
                setBody(event.target.value);
                changed();
              }}
            />
          </label>
          <label>
            実施日
            <input
              type="date"
              value={date}
              required
              onChange={(event) => {
                setDate(event.target.value);
                changed();
              }}
            />
          </label>
          <label>
            Theme（任意）
            <select
              value={theme}
              onChange={(event) => {
                setTheme(event.target.value);
                changed();
              }}
            >
              <option value="">個人業務</option>
              {themes
                .filter((item) => item.id !== PERSONAL_DEFAULT_THEME_ID)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {String(item.name || item.title)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            関連するTask（任意）
            <select
              value={task}
              onChange={(event) => {
                setTask(event.target.value);
                changed();
              }}
            >
              <option value="">なし</option>
              {tasks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="work-log-error">
            {error}
          </p>
        )}
        <footer>
          <Button variant="secondary" disabled={saving} onClick={close}>
            閉じる
          </Button>
          <Button variant="primary" type="submit" disabled={saving || !body.trim()}>
            {saving ? "保存中…" : "記録を保存"}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
