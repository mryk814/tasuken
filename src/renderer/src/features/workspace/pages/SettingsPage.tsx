import { useEffect, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { AppUpdateCheckResult, SharedSyncStatus } from "../../../../../shared/ipc/contracts";
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
  const [syncStatus, setSyncStatus] = useState<SharedSyncStatus | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    workspaceApi.getPreference("artifactDirectory")
      .then((value) => setArtifactDirectory(typeof value === "string" ? value : ""))
      .catch(() => {
        // 未設定として表示するだけでよい（設定操作時に改めてエラーを出す）。
      });
  }, []);

  useEffect(() => {
    let canceled = false;
    const refresh = () => workspaceApi.sharedSyncStatus()
      .then((status) => {
        if (!canceled) setSyncStatus(status);
      })
      .catch(() => {
        // 状態取得の失敗は同期パネル内の手動操作時に具体的に表示する。
      });
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
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

  async function chooseSyncDirectory() {
    setSyncBusy(true);
    try {
      const result = await workspaceApi.chooseDirectory("Tasken同期フォルダを選択");
      if (result.canceled || !result.path) return;
      const status = await workspaceApi.configureSharedSync(result.path);
      setSyncStatus(status);
      setToast("端末間同期を開始しました。", "success");
    } catch (error) {
      setToast(`同期フォルダを設定できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setSyncBusy(false);
    }
  }

  async function runSharedSync() {
    setSyncBusy(true);
    try {
      const status = await workspaceApi.runSharedSync();
      setSyncStatus(status);
      setToast(status.conflictCount ? "同期しました。確認が必要な競合があります。" : "同期しました。", status.conflictCount ? "warning" : "success");
    } catch (error) {
      setToast(`同期できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
      setSyncStatus(await workspaceApi.sharedSyncStatus().catch(() => syncStatus));
    } finally {
      setSyncBusy(false);
    }
  }

  async function disableSharedSync() {
    setSyncBusy(true);
    try {
      const status = await workspaceApi.disableSharedSync();
      setSyncStatus(status);
      setToast("端末間同期を停止しました。データと同期フォルダは残っています。", "info");
    } catch (error) {
      setToast(`同期を停止できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setSyncBusy(false);
    }
  }

  async function resolveSyncConflict(conflictId: string, choice: "local" | "incoming") {
    setSyncBusy(true);
    try {
      const result = await workspaceApi.resolveSharedSyncConflict(conflictId, choice);
      setSyncStatus(result.status);
      setToast("競合を解決しました。選んだ内容を他端末へ同期します。", "success");
    } catch (error) {
      setToast(`競合を解決できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setSyncBusy(false);
    }
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
        <section className="panel settings-form sync-settings-panel">
          <div className="settings-section-heading">
            <h2>端末間同期</h2>
            <span className={`sync-state sync-state-${syncStatus?.state || "off"}`}>
              {syncStatus?.state === "syncing"
                ? "同期中"
                : syncStatus?.state === "conflict"
                  ? "要確認"
                  : syncStatus?.state === "error"
                    ? "エラー"
                    : syncStatus?.enabled ? "有効" : "停止"}
            </span>
          </div>
          <p className="field-help">各端末のSQLiteはローカルに保ち、選択したOneDriveまたは共有フォルダで変更だけを交換します。</p>
          <dl className="settings-meta-list">
            <div>
              <dt>同期先</dt>
              <dd title={syncStatus?.directory}>{syncStatus?.directory || "未設定"}</dd>
            </div>
            <div>
              <dt>最終同期</dt>
              <dd>{syncStatus?.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "未同期"}</dd>
            </div>
            <div>
              <dt>端末</dt>
              <dd className="mono-value">{syncStatus?.deviceId ? syncStatus.deviceId.slice(0, 8) : "—"}</dd>
            </div>
          </dl>
          {syncStatus?.lastError && <p className="form-error">同期エラー: {syncStatus.lastError}</p>}
          <div className="settings-action-row">
            <button className="secondary-button" disabled={syncBusy} onClick={chooseSyncDirectory}>
              {syncStatus?.directory ? "同期先を変更" : "同期先を選ぶ"}
            </button>
            {syncStatus?.enabled && (
              <>
                <button className="primary-button" disabled={syncBusy} onClick={runSharedSync}>
                  {syncBusy ? "同期中" : "今すぐ同期"}
                </button>
                <button className="text-button" disabled={syncBusy} onClick={disableSharedSync}>停止</button>
              </>
            )}
          </div>
        </section>
        <section className="panel settings-form">
          <h2>Artifact保存先</h2>
          <p className="field-help">
            managed Artifact と Note Markdown 書き出しの共通ルートです。Theme 未設定は <code>Inbox/</code>（Note は <code>Inbox/Notes/</code>）、Theme ありで保存ルート未設定は <code>Themes/識別子/Artifacts|Notes|Exports/</code> です。Theme 編集の保存ルートがあればそれを優先します。PDF は都度選択（初期位置は Exports）。linked Artifact は対象外です。
          </p>
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
      {syncStatus && syncStatus.conflicts.length > 0 && (
        <section className="panel sync-conflict-panel">
          <div className="section-heading">
            <h2>同期の競合</h2>
            <span>{syncStatus.conflicts.length}件</span>
          </div>
          <p className="field-help">同じデータが両端末で変更されています。残す内容を選んでください。</p>
          {syncStatus.conflicts.map((conflict) => (
            <div className="sync-conflict-row" key={conflict.id}>
              <div className="sync-conflict-title">
                <strong>{entityTitle(conflict.entityType, conflict.local)}</strong>
                <small>{conflict.entityType} / 相手端末 {conflict.incomingDeviceId.slice(0, 8)}</small>
              </div>
              <div className="sync-conflict-choice">
                <div>
                  <span>この端末</span>
                  <strong>{entityTitle(conflict.entityType, conflict.local)}</strong>
                  <small>{conflict.local.updated_at ? new Date(String(conflict.local.updated_at)).toLocaleString("ja-JP") : "更新時刻なし"}</small>
                  <button className="secondary-button" disabled={syncBusy} onClick={() => resolveSyncConflict(conflict.id, "local")}>こちらを残す</button>
                </div>
                <div>
                  <span>相手端末</span>
                  <strong>{entityTitle(conflict.entityType, conflict.incoming)}</strong>
                  <small>{conflict.incoming.updated_at ? new Date(String(conflict.incoming.updated_at)).toLocaleString("ja-JP") : "更新時刻なし"}</small>
                  <button className="secondary-button" disabled={syncBusy} onClick={() => resolveSyncConflict(conflict.id, "incoming")}>こちらを残す</button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
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
