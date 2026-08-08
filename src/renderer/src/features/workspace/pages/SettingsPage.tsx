import { useEffect, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { AppUpdateCheckResult, McpBridgeInfo, SharedSyncStatus } from "../../../../../shared/ipc/contracts";
import type { AiProviderConfig } from "../../../../../shared/ai";
import type { CalendarConnectionStatus } from "../../../../../shared/calendar";
import type { PageProps, SnapshotChange, SnapshotPreview, Theme } from "../types";
import { AI_AUDIENCES, DEFAULT_AI_VISIBILITY } from "../../../../../shared/aiMetadata.mjs";
import type { AiAudience } from "../../../../../shared/aiMetadata.mjs";
import { AI_AUDIENCE_LABELS } from "../domain-model/labels";
import { entityTitle } from "../lib/domain";
import { Button, PageHeader } from "../components/common";

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
  const [mcpInfo, setMcpInfo] = useState<McpBridgeInfo | null>(null);
  const [aiConfig, setAiConfig] = useState<AiProviderConfig | null>(null);
  const [aiModel, setAiModel] = useState("gpt-5.6");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<CalendarConnectionStatus | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  // AI公開範囲のworkspace既定（#294）。Theme・項目が未設定のときだけ使う。
  const [aiVisibilityDefault, setAiVisibilityDefault] = useState<AiAudience[]>([...DEFAULT_AI_VISIBILITY]);
  const [aiVisibilityBusy, setAiVisibilityBusy] = useState(false);

  useEffect(() => {
    workspaceApi.getPreference("aiVisibilityDefault")
      .then((value) => {
        if (Array.isArray(value)) setAiVisibilityDefault(value as AiAudience[]);
      })
      .catch(() => {
        // 取得できないときは契約の既定を表示し、変更操作時に改めてエラーを出す。
      });
  }, []);

  async function updateAiVisibilityDefault(audience: AiAudience, allowed: boolean) {
    const next = allowed
      ? AI_AUDIENCES.filter((entry) => entry === audience || aiVisibilityDefault.includes(entry))
      : aiVisibilityDefault.filter((entry) => entry !== audience);
    const previous = aiVisibilityDefault;
    setAiVisibilityDefault(next);
    setAiVisibilityBusy(true);
    try {
      await workspaceApi.setPreference("aiVisibilityDefault", next);
      setToast("AI公開範囲の既定を変更しました。", "success");
    } catch (error) {
      setAiVisibilityDefault(previous);
      setToast(`AI公開範囲の既定を変更できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setAiVisibilityBusy(false);
    }
  }

  useEffect(() => {
    workspaceApi.calendarStatus()
      .then(setCalendarStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    workspaceApi.getPreference("artifactDirectory")
      .then((value) => setArtifactDirectory(typeof value === "string" ? value : ""))
      .catch(() => {
        // 未設定として表示するだけでよい（設定操作時に改めてエラーを出す）。
      });
  }, []);

  useEffect(() => {
    workspaceApi.getMcpBridgeInfo()
      .then(setMcpInfo)
      .catch((error) => {
        setToast(`MCP Bridgeの情報を取得できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
      });
  }, [setToast]);

  useEffect(() => {
    workspaceApi.getAiConfig()
      .then((config) => {
        setAiConfig(config);
        setAiModel(config.model);
      })
      .catch((error) => {
        setToast(`AI設定を取得できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
      });
  }, [setToast]);

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

  async function copyMcpConfig() {
    if (!mcpInfo) return;
    await workspaceApi.copyText(mcpInfo.configJson);
    setToast("MCPクライアント設定をコピーしました。", "success");
  }

  async function openMcpInbox() {
    if (!mcpInfo) return;
    const result = await workspaceApi.openPath(mcpInfo.inboxPath);
    if (!result.ok) setToast(`MCP Inboxを開けませんでした。${result.error || ""}`, "danger");
  }

  async function saveAiSettings(clearApiKey = false) {
    setAiBusy(true);
    try {
      const config = await workspaceApi.saveAiConfig({
        provider: "openai",
        model: aiModel,
        apiKey: aiApiKey || undefined,
        clearApiKey,
      });
      setAiConfig(config);
      setAiModel(config.model);
      setAiApiKey("");
      setToast(clearApiKey ? "OpenAI APIキーを削除しました。" : "AI設定を安全に保存しました。", "success");
    } catch (error) {
      setToast(`AI設定を保存できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setAiBusy(false);
    }
  }

  async function connectCalendar() {
    setCalendarBusy(true);
    try {
      const status = await workspaceApi.calendarConnect({ provider: "microsoft" });
      setCalendarStatus(status);
      setToast("カレンダーを接続しました。", "success");
    } catch (error) {
      setToast(`カレンダーの接続に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function disconnectCalendar() {
    setCalendarBusy(true);
    try {
      const status = await workspaceApi.calendarDisconnect({ provider: "microsoft" });
      setCalendarStatus(status);
      setToast("カレンダーの接続を解除しました。", "info");
    } catch (error) {
      setToast(`カレンダーの切断に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setCalendarBusy(false);
    }
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
      <PageHeader route="settings" />
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
          <Button variant="secondary" disabled={busy} onClick={exportSnapshot}>バックアップを書き出す</Button>
          <Button variant="secondary" disabled={busy} onClick={inspectSnapshot}>バックアップを読み込む</Button>
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
          <p className="field-help">各端末のSQLiteはローカルに保ち、選択したOneDriveまたは共有フォルダで変更とNote内のMarkdown画像を交換します。画像は各端末にもキャッシュするため、同期後はオフラインでも表示できます。</p>
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
            <div>
              <dt>Markdown画像</dt>
              <dd>
                {syncStatus ? `${syncStatus.markdownImageCount}件` : "—"}
                {syncStatus && (syncStatus.lastMarkdownImagesPublished || syncStatus.lastMarkdownImagesReceived)
                  ? `（送信 ${syncStatus.lastMarkdownImagesPublished}・受信 ${syncStatus.lastMarkdownImagesReceived}）`
                  : ""}
              </dd>
            </div>
          </dl>
          {syncStatus?.lastError && <p className="form-error">同期エラー: {syncStatus.lastError}</p>}
          <div className="settings-action-row">
            <Button variant="secondary" disabled={syncBusy} onClick={chooseSyncDirectory}>
              {syncStatus?.directory ? "同期先を変更" : "同期先を選ぶ"}
            </Button>
            {syncStatus?.enabled && (
              <>
                <Button variant="primary" disabled={syncBusy} onClick={runSharedSync}>
                  {syncBusy ? "同期中" : "今すぐ同期"}
                </Button>
                <button className="text-button" disabled={syncBusy} onClick={disableSharedSync}>停止</button>
              </>
            )}
          </div>
        </section>
        <section className="panel settings-form">
          {/* 保存先の設定は同期ルート一つに集約し、配下はTaskenが自動生成する（#306）。 */}
          <h2>同期ストレージ</h2>
          <p className="field-help">
            OneDrive等のTasken同期ルートを一度だけ設定します。配下の <code>Inbox/</code> と <code>Themes/識別子/</code>、その中の <code>Notes|Artifacts|Exports/</code> はTaskenが必要になった時点で自動生成します。用途ごとの保存先設定は増やしません。Themeだけは編集画面で専用ルートを指定でき、その場合も標準サブフォルダは自動生成します。PDF等の明示的な書き出しは都度選択（初期位置は Exports）、linked Artifact は移動しません。
          </p>
          <dl className="settings-meta-list">
            <div>
              <dt>同期ルート</dt>
              <dd>{artifactDirectory || "未設定"}</dd>
            </div>
          </dl>
          <div className="settings-action-row">
            <Button variant="secondary" onClick={chooseArtifactDirectory}>保存先を選ぶ</Button>
            {artifactDirectory && <Button variant="secondary" onClick={openArtifactDirectory}>フォルダを開く</Button>}
          </div>
        </section>
        <section className="panel settings-form mcp-settings-panel">
          <div className="settings-section-heading">
            <h2>MCP Bridge</h2>
            <span className="sync-state sync-state-idle">利用可能</span>
          </div>
          <p className="field-help">外部AIはTaskenを読み取り、追加・編集はPending Proposalとして送ります。正式データはTaskenで採用するまで変わりません。</p>
          <dl className="settings-meta-list">
            <div>
              <dt>起動</dt>
              <dd className="mono-value" title={mcpInfo ? `${mcpInfo.command} ${mcpInfo.args.join(" ")}` : ""}>
                {mcpInfo ? `${mcpInfo.command} ${mcpInfo.args.join(" ")}` : "読込中"}
              </dd>
            </div>
            <div>
              <dt>受信待ち</dt>
              <dd>{mcpInfo?.pendingFileCount || 0}件</dd>
            </div>
          </dl>
          <div className="settings-action-row">
            <Button variant="primary" disabled={!mcpInfo} onClick={copyMcpConfig}>接続設定をコピー</Button>
            <Button variant="secondary" disabled={!mcpInfo} onClick={openMcpInbox}>Inboxを開く</Button>
          </div>
        </section>
        <section className="panel settings-form ai-visibility-settings-panel">
          <div className="settings-section-heading">
            <h2>AI公開範囲の既定</h2>
          </div>
          <p className="field-help">Theme・各項目で個別に決めていないときに使う既定です。項目側の設定が常に優先されます。</p>
          <fieldset className="ai-context-visibility">
            <legend>渡してよい相手</legend>
            {AI_AUDIENCES.map((audience) => (
              <label key={audience}>
                <input
                  type="checkbox"
                  checked={aiVisibilityDefault.includes(audience)}
                  disabled={aiVisibilityBusy}
                  onChange={(event) => updateAiVisibilityDefault(audience, event.target.checked)}
                />
                {AI_AUDIENCE_LABELS[audience]}
              </label>
            ))}
          </fieldset>
        </section>
        <section className="panel settings-form calendar-settings-panel">
          <div className="settings-section-heading">
            <h2>カレンダー連携</h2>
            <span className={`sync-state ${calendarStatus?.connected ? "sync-state-idle" : "sync-state-off"}`}>
              {calendarStatus?.connected ? "接続済み" : "未接続"}
            </span>
          </div>
          <p className="field-help">Outlook / Microsoft 365のカレンダーを読み取り専用で表示します。メールや連絡先にはアクセスしません。</p>
          {calendarStatus?.connected ? (
            <>
              <dl className="settings-meta-list">
                <div>
                  <dt>アカウント</dt>
                  <dd>{calendarStatus.accountName}</dd>
                </div>
                <div>
                  <dt>最終取得</dt>
                  <dd>
                    {calendarStatus.lastFetchedAt
                      ? new Date(calendarStatus.lastFetchedAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })
                      : "未取得"}
                  </dd>
                </div>
              </dl>
              <div className="settings-action-row">
                <Button variant="danger" disabled={calendarBusy} onClick={disconnectCalendar}>
                  {calendarBusy ? "処理中" : "接続を解除"}
                </Button>
              </div>
            </>
          ) : (
            <div className="settings-action-row">
              <Button variant="primary" disabled={calendarBusy} onClick={connectCalendar}>
                {calendarBusy ? "接続中…" : "Microsoftアカウントで接続"}
              </Button>
            </div>
          )}
        </section>
        <section className="panel settings-form ai-provider-settings-panel">
          <div className="settings-section-heading">
            <h2>AI Provider</h2>
            <span className={`sync-state ${aiConfig?.hasApiKey ? "sync-state-idle" : "sync-state-off"}`}>
              {aiConfig?.hasApiKey ? "設定済み" : "未設定"}
            </span>
          </div>
          <p className="field-help">OpenAIへの送信は明示操作時だけです。返答はNoteを直接変更せず、Pending Proposalとして差分確認します。</p>
          <label>Provider
            <select value="openai" disabled><option value="openai">OpenAI</option></select>
          </label>
          <label>Model
            <input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder="gpt-5.6" />
          </label>
          <label>API key
            <input
              type="password"
              autoComplete="off"
              value={aiApiKey}
              onChange={(event) => setAiApiKey(event.target.value)}
              placeholder={aiConfig?.hasApiKey ? "保存済み（変更時だけ入力）" : "sk-..."}
            />
          </label>
          <div className="settings-action-row">
            <Button variant="primary" disabled={aiBusy || !aiModel.trim()} onClick={() => saveAiSettings(false)}>
              {aiBusy ? "保存中" : "設定を保存"}
            </Button>
            {aiConfig?.hasApiKey && (
              <Button variant="danger" disabled={aiBusy} onClick={() => saveAiSettings(true)}>APIキーを削除</Button>
            )}
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
            <Button variant="secondary" disabled={checkingUpdate} onClick={checkForUpdates}>
              {checkingUpdate ? "確認中" : "更新を確認"}
            </Button>
            <Button variant="primary" onClick={openReleasePage}>
              Releaseを開く
            </Button>
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
                  <Button variant="secondary" disabled={syncBusy} onClick={() => resolveSyncConflict(conflict.id, "local")}>こちらを残す</Button>
                </div>
                <div>
                  <span>相手端末</span>
                  <strong>{entityTitle(conflict.entityType, conflict.incoming)}</strong>
                  <small>{conflict.incoming.updated_at ? new Date(String(conflict.incoming.updated_at)).toLocaleString("ja-JP") : "更新時刻なし"}</small>
                  <Button variant="secondary" disabled={syncBusy} onClick={() => resolveSyncConflict(conflict.id, "incoming")}>こちらを残す</Button>
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
            <Button variant="secondary" onClick={() => setSnapshotPreview(null)}>取り消す</Button>
            <Button variant="primary" disabled={busy} onClick={applySnapshot}>選択内容を反映</Button>
          </div>
        </section>
      )}
    </div>
  );
}
