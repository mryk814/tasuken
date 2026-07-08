import { useEffect, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { AppUpdateCheckResult } from "../../../../../shared/ipc/contracts";
import type { PageProps, SnapshotChange, SnapshotPreview, Theme } from "../types";
import { entityTitle } from "../lib/domain";
import { PageHeader } from "../components/common";

interface SettingsPageProps extends PageProps {
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  activeGroups: string[];
  setActiveGroups: (groups: string[]) => void;
  allThemes: Theme[];
}

export function SettingsPage({ data, domain, themeMode, setThemeMode, activeGroups, setActiveGroups, allThemes, setSnapshotPreview, snapshotPreview, setToast }: SettingsPageProps) {
  const [busy, setBusy] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateCheckResult | null>(null);
  const [artifactDirectory, setArtifactDirectory] = useState("");

  useEffect(() => {
    workspaceApi.getPreference("artifactDirectory")
      .then((value) => setArtifactDirectory(typeof value === "string" ? value : ""))
      .catch(() => {
        // 未設定として表示するだけでよい（設定操作時に改めてエラーを出す）。
      });
  }, []);

  async function chooseArtifactDirectory() {
    try {
      const result = await workspaceApi.chooseDirectory("Artifact保存先フォルダを選択");
      if (result.canceled || !result.path) return;
      await workspaceApi.setPreference("artifactDirectory", result.path);
      setArtifactDirectory(result.path);
      setToast(`Artifact保存先を設定しました。${result.path}`, "success");
    } catch (error) {
      setToast(`Artifact保存先を設定できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function openArtifactDirectory() {
    const result = await workspaceApi.openPath(artifactDirectory);
    if (!result.ok) setToast(`フォルダを開けませんでした。${result.error || ""}`, "danger");
  }

  async function exportSnapshot() {
    setBusy(true);
    try {
      const result = await workspaceApi.exportSnapshot();
      if (!result.canceled) setToast("作業台Snapshotを書き出しました。");
    } catch (error) {
      setToast(`Snapshotを書き出せませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function inspectSnapshot() {
    setBusy(true);
    try {
      const result = await workspaceApi.inspectSnapshot();
      if (!result.canceled && result.token) {
        const changes = (result.changes as SnapshotChange[] | undefined) || [];
        const preview: SnapshotPreview = {
          token: result.token,
          manifest: result.manifest,
          changes,
          decisions: Object.fromEntries(changes.map((change) => [change.key, change.action])),
        };
        setSnapshotPreview(preview);
      }
    } catch (error) {
      setToast(`Snapshotを読み込めませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function applySnapshot() {
    if (!snapshotPreview) return;
    setBusy(true);
    try {
      await workspaceApi.applySnapshot(snapshotPreview.token, snapshotPreview.decisions);
      await workspaceApi.reload();
    } catch (error) {
      setToast(`Snapshotを反映できませんでした。${error instanceof Error ? error.message : String(error)}`);
      setBusy(false);
    }
  }

  async function checkForUpdates() {
    setCheckingUpdate(true);
    try {
      const result = await workspaceApi.checkForUpdates();
      setUpdateInfo(result);
      if (result.status === "available") {
        setToast(`Tasken ${result.latestVersion} が公開されています。`);
      } else if (result.status === "current") {
        setToast("Taskenは最新です。");
      } else {
        setToast(`更新を確認できませんでした。${result.error || ""}`);
      }
    } catch (error) {
      setToast(`更新を確認できませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function openReleasePage() {
    await workspaceApi.openReleasePage(updateInfo?.releaseUrl);
  }

  const updateStatusLabel = updateInfo
    ? updateInfo.status === "available"
      ? `Tasken ${updateInfo.latestVersion} が公開されています。`
      : updateInfo.status === "current"
        ? `最新です。現在のバージョンは ${updateInfo.currentVersion} です。`
        : `確認できませんでした。${updateInfo.error || ""}`
    : "未確認";

  return (
    <div className="page">
      <PageHeader title="Settings" />
      <div className="settings-grid">
        <section className="panel settings-form">
          <h2>表示</h2>
          <label>カラーモード
            <select value={themeMode} onChange={(event) => setThemeMode(event.target.value === "dark" ? "dark" : "light")}>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </label>
          <h2>テーマグループ</h2>
          <p className="field-help">選択したグループに属するテーマだけを表示します。未選択なら全テーマを表示します。</p>
          {(() => {
            const groups = [...new Set(allThemes.map((t) => t.group).filter(Boolean))] as string[];
            const toggle = (group: string) => {
              setActiveGroups(activeGroups.includes(group) ? activeGroups.filter((g) => g !== group) : [...activeGroups, group]);
            };
            return groups.length > 0 ? (
              <div className="group-chip-list">
                {groups.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`theme-chip ${activeGroups.includes(g) ? "is-selected" : ""}`}
                    onClick={() => toggle(g)}
                  >
                    {g}
                  </button>
                ))}
                {activeGroups.length > 0 && (
                  <button type="button" className="text-button compact" onClick={() => setActiveGroups([])}>すべて表示に戻す</button>
                )}
              </div>
            ) : (
              <p className="field-help">テーマにグループが設定されていません。テーマ編集でグループを設定してください。</p>
            );
          })()}
        </section>
        <section className="panel settings-form">
          <h2>バックアップ</h2>
          <p className="field-help">端末間の移行や復元にはZIP形式のSnapshotを使います。</p>
          <button className="secondary-button" disabled={busy} onClick={exportSnapshot}>バックアップを書き出す</button>
          <button className="secondary-button" disabled={busy} onClick={inspectSnapshot}>バックアップを読み込む</button>
        </section>
        <section className="panel settings-form">
          <h2>Artifact保存先</h2>
          <p className="field-help">Chat参照・タスク・メモへドラッグしたファイルは、このフォルダ配下の年/月フォルダへコピーされます。</p>
          <dl className="settings-meta-list">
            <div>
              <dt>保存先</dt>
              <dd>{artifactDirectory || "未設定"}</dd>
            </div>
          </dl>
          <div className="settings-action-row">
            <button className="secondary-button" onClick={chooseArtifactDirectory}>保存先を選ぶ</button>
            {artifactDirectory && <button className="secondary-button" onClick={openArtifactDirectory}>フォルダを開く</button>}
          </div>
        </section>
        <section className="panel settings-form update-panel">
          <h2>更新</h2>
          <dl className="settings-meta-list">
            <div>
              <dt>現在</dt>
              <dd>{updateInfo?.currentVersion || "確認後に表示"}</dd>
            </div>
            <div>
              <dt>状態</dt>
              <dd>{updateStatusLabel}</dd>
            </div>
            {updateInfo?.publishedAt && (
              <div>
                <dt>公開日</dt>
                <dd>{new Date(updateInfo.publishedAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}</dd>
              </div>
            )}
          </dl>
          <div className="settings-action-row">
            <button className="secondary-button" disabled={checkingUpdate} onClick={checkForUpdates}>
              {checkingUpdate ? "確認中" : "更新を確認"}
            </button>
            <button className="primary-button" onClick={openReleasePage}>
              Releaseを開く
            </button>
          </div>
        </section>
      </div>
      {snapshotPreview && (
        <section className="panel snapshot-preview">
          <div className="section-heading"><h2>Snapshot差分</h2><span>{snapshotPreview.changes.length}件</span></div>
          {snapshotPreview.changes.map((change) => (
            <div className="import-candidate" key={change.key}>
              <div>
                <strong>{entityTitle(change.type, change.incoming)}</strong>
                <small>{change.type} / {change.category}</small>
              </div>
              <select value={snapshotPreview.decisions[change.key]} onChange={(event) => setSnapshotPreview({ ...snapshotPreview, decisions: { ...snapshotPreview.decisions, [change.key]: event.target.value } })}>
                {(change.actions || ["ignore"]).map((action) => (
                  <option key={action} value={action}>{action === "ignore" ? "無視" : action === "create" ? "新規作成" : action === "update" ? "既存を更新" : "両方残す"}</option>
                ))}
              </select>
            </div>
          ))}
          <div className="form-actions">
            <button className="secondary-button" onClick={() => setSnapshotPreview(null)}>取り消す</button>
            <button className="primary-button" disabled={busy} onClick={applySnapshot}>選択内容を反映</button>
          </div>
        </section>
      )}
    </div>
  );
}
