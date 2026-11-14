import { useEffect, useRef, useState } from "react";
import type {
  WorkspaceBackupEntry,
  WorkspaceRestorePreview,
} from "../../../../../shared/ipc/contracts";
import { workspaceApi } from "../../../services/workspaceApi";
import { Button } from "./common";
import "./RestoreBackupDialog.css";

function dateTime(value: string): string {
  return value
    ? new Date(value).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" })
    : "日時不明";
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${Math.round(bytes / (1024 * 1024)).toLocaleString("ja-JP")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("ja-JP")} KB`;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

/**
 * 控えを選び、何が起きるかを見てから戻す。
 * 戻すと今のデータが置き換わるので、選んだ控えと今の件数を並べ、進む順（今を控える→置き換える→
 * 起動し直す）を図で見せる。
 */
export function RestoreBackupDialog({ open, close }: { open: boolean; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [backups, setBackups] = useState<WorkspaceBackupEntry[] | null>(null);
  const [preview, setPreview] = useState<WorkspaceRestorePreview | null>(null);
  // 選んだ印は押した時に付ける（中身の確認は少し遅れて出る）。
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState<"" | "inspect" | "restore">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return undefined;
    }
    setBackups(null);
    setPreview(null);
    setSelected("");
    setError("");
    setBusy("");
    dialog.current?.showModal();
    let canceled = false;
    workspaceApi
      .listBackups()
      .then((list) => {
        if (!canceled) setBackups(list.backups);
      })
      .catch((failure) => {
        if (canceled) return;
        setBackups([]);
        setError(errorText(failure));
      });
    return () => {
      canceled = true;
      dialog.current?.close();
    };
  }, [open]);

  async function select(token: string) {
    setSelected(token);
    setPreview(null);
    setBusy("inspect");
    setError("");
    try {
      setPreview(await workspaceApi.previewBackup(token));
    } catch (failure) {
      setSelected("");
      setError(errorText(failure));
    } finally {
      setBusy("");
    }
  }

  async function chooseFile() {
    setBusy("inspect");
    setError("");
    try {
      const choice = await workspaceApi.chooseBackupFile();
      if (!choice.canceled) {
        setPreview(choice.preview);
        setSelected(choice.preview.token);
      }
    } catch (failure) {
      setPreview(null);
      setSelected("");
      setError(errorText(failure));
    } finally {
      setBusy("");
    }
  }

  async function restore() {
    if (!preview) return;
    setBusy("restore");
    setError("");
    try {
      // 成功するとTaskenが終了して起動し直すので、この先は戻らない。
      await workspaceApi.restoreBackup(preview.token);
    } catch (failure) {
      setError(errorText(failure));
      setBusy("");
    }
  }

  const listed = backups?.some((entry) => entry.token === preview?.token) ?? false;
  return (
    <dialog
      className="restore-backup-dialog"
      ref={dialog}
      aria-labelledby="restore-backup-title"
      onCancel={(event) => {
        event.preventDefault();
        if (busy !== "restore") close();
      }}
    >
      <h2 id="restore-backup-title">控えから戻す</h2>
      <fieldset className="restore-backup-list" disabled={busy !== ""}>
        <legend>戻す控え</legend>
        {backups === null ? <p className="field-help">控えを確認中</p> : null}
        {backups?.length === 0 ? <p className="field-help">保存先に控えがありません。</p> : null}
        {backups?.map((entry) => (
          <label key={entry.token} className="restore-backup-option">
            <input
              type="radio"
              name="restore-backup"
              checked={selected === entry.token}
              onChange={() => void select(entry.token)}
            />
            <span className="restore-backup-option-time">{dateTime(entry.createdAt)}</span>
            {entry.kind === "before-restore" ? (
              <span className="restore-backup-tag">戻す前の控え</span>
            ) : null}
            <span className="restore-backup-option-size">{fileSize(entry.sizeBytes)}</span>
          </label>
        ))}
        {preview && !listed ? (
          <label className="restore-backup-option">
            <input type="radio" name="restore-backup" checked readOnly />
            <span className="restore-backup-option-time">{dateTime(preview.createdAt)}</span>
            <span className="restore-backup-option-path" title={preview.filePath}>
              {preview.filePath}
            </span>
          </label>
        ) : null}
        <button type="button" className="text-button" onClick={() => void chooseFile()}>
          ほかの場所の控えを選ぶ
        </button>
      </fieldset>

      {preview ? (
        <section className="restore-backup-preview" aria-label="戻すと起きること">
          <dl className="restore-backup-compare">
            <div>
              <dt>今</dt>
              <dd>{preview.currentEntityCount.toLocaleString("ja-JP")} 件</dd>
            </div>
            <div className="restore-backup-compare-arrow" aria-hidden="true">
              →
            </div>
            <div>
              <dt>戻した後</dt>
              <dd>{preview.entityCount.toLocaleString("ja-JP")} 件</dd>
              <dd className="restore-backup-compare-note">{dateTime(preview.createdAt)} の状態</dd>
            </div>
          </dl>
          <ol className="restore-backup-steps">
            <li>今のデータを控える</li>
            <li>控えに置き換える</li>
            <li>Taskenを起動し直す</li>
          </ol>
          {!preview.sameWorkspace ? (
            <p className="restore-backup-caution">別の作業台（別の端末など）の控えです。</p>
          ) : null}
          {!preview.attachmentsInBackup ? (
            <p className="restore-backup-caution">
              この控えには画像と写真が入っていません。記録だけを戻します。
            </p>
          ) : null}
          {preview.syncEnabled ? (
            <p className="restore-backup-caution">端末間同期が止まります。</p>
          ) : null}
        </section>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      <footer>
        <Button variant="secondary" disabled={busy === "restore"} onClick={close}>
          やめる
        </Button>
        <Button variant="danger" disabled={!preview || busy !== ""} onClick={() => void restore()}>
          {busy === "restore" ? "今のデータを控えています" : "戻して起動し直す"}
        </Button>
      </footer>
    </dialog>
  );
}
