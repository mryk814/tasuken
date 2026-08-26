import { useCallback, useEffect, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { mobileGatewayApi } from "../../../services/mobileGatewayApi";
import type {
  AppUpdateCheckResult,
  AutomaticSnapshotBackupStatus,
  McpBridgeInfo,
  RootShortcutState,
  SharedSyncStatus,
} from "../../../../../shared/ipc/contracts";
import type {
  MobileGatewayDiagnostics,
  MobileGatewayPairingTicket,
} from "../../../../../shared/mobileGatewayIpc";
import { copyMcpBridgeConfig } from "../../../../../shared/ipc/contracts";
import type { CalendarConnectionStatus } from "../../../../../shared/calendar";
import type { PageProps, SnapshotChange, SnapshotPreview, Theme } from "../types";
import { AI_AUDIENCES, DEFAULT_AI_VISIBILITY } from "../../../../../shared/aiMetadata.mjs";
import type { AiAudience } from "../../../../../shared/aiMetadata.mjs";
import { AI_AUDIENCE_LABELS } from "../domain-model/labels";
import { entityTitle } from "../lib/domain";
import { Button, IntegrationStatus, PageHeader } from "../components/common";
import {
  DEFAULT_ROOT_SHORTCUT,
  DIRECT_SHORTCUT_DEFINITIONS,
  formatShortcutLabel,
} from "../../../../../shared/taskenRoot";

interface SettingsPageProps extends PageProps {
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  activeGroups: string[];
  setActiveGroups: (groups: string[]) => void;
  allThemes: Theme[];
}

type SettingsSectionId =
  "general" | "appearance" | "storage" | "integrations" | "mobile" | "ai-mcp" | "advanced";

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: "general", label: "General", description: "基本の使い方" },
  { id: "appearance", label: "Appearance", description: "表示と編集" },
  { id: "storage", label: "Storage & Files", description: "保存と同期" },
  { id: "integrations", label: "Integrations", description: "外部サービス" },
  { id: "mobile", label: "Mobile", description: "Android接続" },
  { id: "ai-mcp", label: "Context & MCP", description: "文脈と外部Agent連携" },
  { id: "advanced", label: "Advanced", description: "更新と復元" },
];

function settingsSectionFromHash(hash: string): SettingsSectionId {
  const value = hash.replace(/^#/, "");
  const section = value.match(/^settings(?:[/?](?:section=)?([^/?]+))?$/)?.[1] || "general";
  return SETTINGS_SECTIONS.some((entry) => entry.id === section)
    ? (section as SettingsSectionId)
    : "general";
}

function settingsHash(section: SettingsSectionId): string {
  return section === "general" ? "settings" : `settings/${section}`;
}

function backupTime(value: string): string {
  return value
    ? new Date(value).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })
    : "未実行";
}

export function SettingsPage({
  data,
  domain,
  themeMode,
  setThemeMode,
  activeGroups,
  setActiveGroups,
  allThemes,
  setSnapshotPreview,
  snapshotPreview,
  setToast,
}: SettingsPageProps) {
  const [busy, setBusy] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateCheckResult | null>(null);
  const [artifactDirectory, setArtifactDirectory] = useState("");
  const [syncStatus, setSyncStatus] = useState<SharedSyncStatus | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [mcpInfo, setMcpInfo] = useState<McpBridgeInfo | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<CalendarConnectionStatus | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  // AI公開範囲のworkspace既定（#294）。Theme・項目が未設定のときだけ使う。
  const [aiVisibilityDefault, setAiVisibilityDefault] = useState<AiAudience[]>([
    ...DEFAULT_AI_VISIBILITY,
  ]);
  const [aiVisibilityBusy, setAiVisibilityBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() =>
    settingsSectionFromHash(window.location.hash),
  );
  const [rootShortcut, setRootShortcut] = useState(DEFAULT_ROOT_SHORTCUT);
  const [rootShortcutState, setRootShortcutState] = useState<RootShortcutState | null>(null);
  const [rootShortcutBusy, setRootShortcutBusy] = useState(false);
  const [automaticBackupStatus, setAutomaticBackupStatus] =
    useState<AutomaticSnapshotBackupStatus | null>(null);
  const [automaticBackupEnabled, setAutomaticBackupEnabled] = useState(true);
  const [automaticBackupDirectory, setAutomaticBackupDirectory] = useState("");
  const [automaticBackupGenerations, setAutomaticBackupGenerations] = useState(5);
  const [automaticBackupBusy, setAutomaticBackupBusy] = useState(false);
  const [automaticBackupState, setAutomaticBackupState] = useState<"loading" | "error" | "success">(
    "loading",
  );
  const [automaticBackupError, setAutomaticBackupError] = useState("");
  const [automaticBackupReloadToken, setAutomaticBackupReloadToken] = useState(0);
  const [mobileGateway, setMobileGateway] = useState<MobileGatewayDiagnostics | null>(null);
  const [mobileGatewayState, setMobileGatewayState] = useState<"loading" | "error" | "success">(
    "loading",
  );
  const [mobileGatewayError, setMobileGatewayError] = useState("");
  const [mobilePairing, setMobilePairing] = useState<MobileGatewayPairingTicket | null>(null);

  const reloadMcpInfo = useCallback(
    async (showSuccess = true) => {
      setMcpBusy(true);
      try {
        setMcpInfo(await workspaceApi.getMcpBridgeInfo());
        if (showSuccess) setToast("MCP Bridgeの状態を更新しました。", "success");
      } catch (error) {
        setToast(
          `MCP Bridgeの情報を取得できませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setMcpBusy(false);
      }
    },
    [setToast],
  );

  useEffect(() => {
    const onHash = () => setActiveSection(settingsSectionFromHash(window.location.hash));
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function selectSection(section: SettingsSectionId) {
    const nextHash = settingsHash(section);
    if (window.location.hash.slice(1) !== nextHash) window.location.hash = nextHash;
    setActiveSection(section);
  }

  useEffect(() => {
    workspaceApi
      .getPreference("aiVisibilityDefault")
      .then((value) => {
        if (Array.isArray(value)) setAiVisibilityDefault(value as AiAudience[]);
      })
      .catch(() => {
        // 取得できないときは契約の既定を表示し、変更操作時に改めてエラーを出す。
      });
  }, []);

  useEffect(() => {
    workspaceApi
      .getTaskenRootShortcut()
      .then((state) => {
        setRootShortcut(state.shortcut);
        setRootShortcutState(state);
      })
      .catch(() =>
        setRootShortcutState({
          shortcut: DEFAULT_ROOT_SHORTCUT,
          registered: false,
          error: "現在の登録状態を確認できません。",
        }),
      );
  }, []);

  useEffect(() => {
    setAutomaticBackupState("loading");
    setAutomaticBackupError("");
    workspaceApi
      .automaticSnapshotStatus()
      .then((status) => {
        acceptAutomaticBackupStatus(status);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setAutomaticBackupState("error");
        setAutomaticBackupError(`自動バックアップの状態を確認できませんでした。${message}`);
        setToast(`自動バックアップの状態を確認できませんでした。${message}`, "danger");
      });
  }, [automaticBackupReloadToken, setToast]);

  async function loadMobileGateway(): Promise<void> {
    setMobileGatewayState("loading");
    setMobileGatewayError("");
    try {
      const diagnostics = await mobileGatewayApi.diagnostics();
      setMobileGateway(diagnostics);
      setMobileGatewayState("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMobileGatewayState("error");
      setMobileGatewayError(`Mobile Gatewayの状態を確認できませんでした。${message}`);
    }
  }

  useEffect(() => {
    void loadMobileGateway();
  }, []);

  async function issueMobilePairing(): Promise<void> {
    try {
      const ticket = await mobileGatewayApi.issuePairing();
      setMobilePairing(ticket);
      await loadMobileGateway();
    } catch (error) {
      setToast(
        `ペアリングコードを発行できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  async function cancelMobilePairing(): Promise<void> {
    await mobileGatewayApi.cancelPairing();
    setMobilePairing(null);
    await loadMobileGateway();
  }

  async function copyMobilePairingCode(): Promise<void> {
    if (!mobilePairing) return;
    await workspaceApi.copyText(mobilePairing.code);
    setToast("ペアリングコードをコピーしました。", "success");
  }

  async function revokeMobileDevice(deviceId: string, label: string): Promise<void> {
    if (
      !window.confirm(`${label} のTasken接続を失効します。再接続には新しいペアリングが必要です。`)
    )
      return;
    await mobileGatewayApi.revokeDevice(deviceId);
    setToast(`${label} の接続を失効しました。`, "success");
    await loadMobileGateway();
  }

  function acceptAutomaticBackupStatus(status: AutomaticSnapshotBackupStatus) {
    setAutomaticBackupStatus(status);
    setAutomaticBackupEnabled(status.enabled);
    setAutomaticBackupDirectory(status.directory);
    setAutomaticBackupGenerations(status.generations);
    setAutomaticBackupState("success");
    setAutomaticBackupError("");
  }

  async function saveRootShortcut() {
    setRootShortcutBusy(true);
    try {
      const state = await workspaceApi.setTaskenRootShortcut(rootShortcut);
      setRootShortcutState(state);
      if (state.registered) {
        setRootShortcut(state.shortcut);
        setToast("Tasken Rootのショートカットを変更しました。", "success");
      } else {
        setToast(
          `ショートカットを登録できませんでした。${state.error || "別の組み合わせを指定してください。"}`,
          "danger",
        );
      }
    } catch (error) {
      setToast(
        `ショートカットを変更できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setRootShortcutBusy(false);
    }
  }

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
      setToast(
        `AI公開範囲の既定を変更できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setAiVisibilityBusy(false);
    }
  }

  useEffect(() => {
    workspaceApi
      .calendarStatus()
      .then(setCalendarStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    workspaceApi
      .getPreference("artifactDirectory")
      .then((value) => setArtifactDirectory(typeof value === "string" ? value : ""))
      .catch(() => {
        // 未設定として表示するだけでよい（設定操作時に改めてエラーを出す）。
      });
  }, []);

  useEffect(() => {
    void reloadMcpInfo(false);
  }, [reloadMcpInfo]);

  useEffect(() => {
    let canceled = false;
    const refresh = () =>
      workspaceApi
        .sharedSyncStatus()
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
      setToast(
        `Artifact保存先を設定できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
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
      setToast(
        `同期フォルダを設定できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setSyncBusy(false);
    }
  }

  async function runSharedSync() {
    setSyncBusy(true);
    try {
      const status = await workspaceApi.runSharedSync();
      setSyncStatus(status);
      setToast(
        status.conflictCount ? "同期しました。確認が必要な競合があります。" : "同期しました。",
        status.conflictCount ? "warning" : "success",
      );
    } catch (error) {
      setToast(
        `同期できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
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
      setToast(
        `同期を停止できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
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
      setToast(
        `競合を解決できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
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
      setToast(
        `Snapshotを書き出せませんでした。${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function chooseAutomaticBackupDirectory() {
    try {
      const result = await workspaceApi.chooseDirectory("自動バックアップの保存先を選択");
      if (!result.canceled && result.path) setAutomaticBackupDirectory(result.path);
    } catch (error) {
      setToast(
        `保存先を選べませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  async function saveAutomaticBackupSettings(showSuccess = true) {
    const status = await workspaceApi.configureAutomaticSnapshot({
      enabled: automaticBackupEnabled,
      directory: automaticBackupDirectory,
      generations: automaticBackupGenerations,
    });
    acceptAutomaticBackupStatus(status);
    if (showSuccess) setToast("自動バックアップの設定を保存しました。", "success");
    return status;
  }

  async function saveAutomaticBackup() {
    setAutomaticBackupBusy(true);
    try {
      await saveAutomaticBackupSettings();
    } catch (error) {
      setToast(
        `自動バックアップの設定を保存できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setAutomaticBackupBusy(false);
    }
  }

  async function runAutomaticBackup() {
    setAutomaticBackupBusy(true);
    try {
      await saveAutomaticBackupSettings(false);
      const status = await workspaceApi.runAutomaticSnapshot();
      acceptAutomaticBackupStatus(status);
      if (status.lastError) {
        setToast(`バックアップを作成できませんでした。${status.lastError}`, "danger");
      } else if (status.skippedReason) {
        setToast(status.skippedReason, "info");
      } else {
        setToast("バックアップを作成しました。", "success");
      }
    } catch (error) {
      setToast(
        `バックアップを作成できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setAutomaticBackupBusy(false);
    }
  }

  async function openAutomaticBackupDirectory() {
    const result = await workspaceApi.openPath(automaticBackupDirectory);
    if (!result.ok)
      setToast(
        `バックアップ先を開けませんでした。${result.error || "保存先を確認してください。"}`,
        "danger",
      );
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
      setToast(
        `Snapshotを読み込めませんでした。${error instanceof Error ? error.message : String(error)}`,
      );
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
      setToast(
        `Snapshotを反映できませんでした。${error instanceof Error ? error.message : String(error)}`,
      );
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
      setToast(
        `更新を確認できませんでした。${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function openReleasePage() {
    await workspaceApi.openReleasePage(updateInfo?.releaseUrl);
  }

  async function copyMcpConfig() {
    if (!mcpInfo) return;
    await copyMcpBridgeConfig((text) => workspaceApi.copyText(text), mcpInfo);
    setToast("MCPクライアント設定をコピーしました。", "success");
  }

  async function connectCalendar() {
    setCalendarBusy(true);
    try {
      const status = await workspaceApi.calendarConnect({ provider: "microsoft" });
      setCalendarStatus(status);
      setToast("カレンダーを接続しました。", "success");
    } catch (error) {
      setToast(
        `カレンダーの接続に失敗しました。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
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
      setToast(
        `カレンダーの切断に失敗しました。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
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

  const storageStatus =
    syncStatus?.state === "error" || Boolean(syncStatus?.lastError)
      ? { label: "エラー", tone: "error" as const }
      : syncStatus?.state === "conflict"
        ? { label: "要確認", tone: "attention" as const }
        : artifactDirectory || syncStatus?.directory
          ? { label: "正常", tone: "normal" as const }
          : syncStatus
            ? { label: "未設定", tone: "neutral" as const }
            : { label: "確認中", tone: "loading" as const };
  const calendarSummary = calendarStatus
    ? calendarStatus.connected
      ? { label: "接続済み", tone: "normal" as const, detail: calendarStatus.accountName }
      : { label: "未接続", tone: "neutral" as const }
    : { label: "確認中", tone: "loading" as const };
  const mcpSummary = mcpInfo
    ? mcpInfo.coreStatus === "unavailable"
      ? { label: "Core接続エラー", tone: "error" as const }
      : mcpInfo.pendingProposalCount > 0
        ? { label: `要確認 · ${mcpInfo.pendingProposalCount}件`, tone: "attention" as const }
        : { label: "設定をコピーできます", tone: "neutral" as const }
    : { label: "確認中", tone: "loading" as const };
  const automaticBackupSummary =
    automaticBackupState === "loading"
      ? { label: "確認中", tone: "loading" as const }
      : automaticBackupState === "error"
        ? { label: "取得失敗", tone: "error" as const }
        : automaticBackupStatus?.lastError
          ? { label: "エラー", tone: "error" as const }
          : automaticBackupStatus && !automaticBackupStatus.enabled
            ? { label: "停止中", tone: "neutral" as const }
            : automaticBackupStatus?.lastSuccessAt
              ? { label: `${automaticBackupStatus.backupCount}世代`, tone: "normal" as const }
              : automaticBackupStatus
                ? { label: "準備完了", tone: "normal" as const }
                : { label: "準備中", tone: "loading" as const };
  const activeSectionDefinition =
    SETTINGS_SECTIONS.find((entry) => entry.id === activeSection) || SETTINGS_SECTIONS[0];

  return (
    <div className="page">
      <PageHeader route="settings" />
      <section className="panel settings-summary" aria-labelledby="settings-summary-title">
        <h2 id="settings-summary-title">現在の状態</h2>
        <div className="settings-summary-list">
          <button
            type="button"
            className="settings-summary-item"
            onClick={() => selectSection("storage")}
          >
            <span>Storage</span>
            <strong>
              <IntegrationStatus label={storageStatus.label} tone={storageStatus.tone} />
            </strong>
          </button>
          <button
            type="button"
            className="settings-summary-item"
            onClick={() => selectSection("integrations")}
          >
            <span>Calendar</span>
            <strong>
              <IntegrationStatus
                label={calendarSummary.label}
                tone={calendarSummary.tone}
                detail={calendarSummary.detail}
              />
            </strong>
          </button>
          <button
            type="button"
            className="settings-summary-item"
            onClick={() => selectSection("mobile")}
          >
            <span>Mobile Gateway</span>
            <strong>
              <IntegrationStatus
                label={
                  mobileGateway?.status === "ready"
                    ? "稼働中"
                    : mobileGatewayState === "loading"
                      ? "確認中"
                      : "停止"
                }
                tone={
                  mobileGateway?.status === "ready"
                    ? "normal"
                    : mobileGatewayState === "loading"
                      ? "loading"
                      : "attention"
                }
              />
            </strong>
          </button>
          <button
            type="button"
            className="settings-summary-item"
            onClick={() => selectSection("ai-mcp")}
          >
            <span>MCP Bridge</span>
            <strong>
              <IntegrationStatus label={mcpSummary.label} tone={mcpSummary.tone} />
            </strong>
          </button>
          <button
            type="button"
            className="settings-summary-item"
            onClick={() => selectSection("advanced")}
          >
            <span>Backups</span>
            <strong>
              <IntegrationStatus
                label={automaticBackupSummary.label}
                tone={automaticBackupSummary.tone}
              />
            </strong>
          </button>
        </div>
      </section>
      <div className="settings-layout">
        <nav className="panel settings-category-nav" aria-label="Settings category">
          <h2>Settings</h2>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeSection === section.id ? "is-active" : ""}
              aria-current={activeSection === section.id ? "page" : undefined}
              onClick={() => selectSection(section.id)}
            >
              <strong>{section.label}</strong>
              <small>{section.description}</small>
            </button>
          ))}
        </nav>
        <div className="settings-category-content">
          <div className="settings-category-heading">
            <h2>{activeSectionDefinition.label}</h2>
            <p>{activeSectionDefinition.description}</p>
          </div>
          <div className="settings-grid">
            <section className="panel settings-form" hidden={activeSection !== "general"}>
              <h2>Themeの表示範囲</h2>
              <p className="field-help">
                Sidebarで表示するTheme groupを選びます。未選択ならすべて表示します。
              </p>
              {(() => {
                const groups = [
                  ...new Set(allThemes.map((t) => t.group).filter(Boolean)),
                ] as string[];
                const toggle = (group: string) => {
                  setActiveGroups(
                    activeGroups.includes(group)
                      ? activeGroups.filter((g) => g !== group)
                      : [...activeGroups, group],
                  );
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
                      <button
                        type="button"
                        className="text-button compact"
                        onClick={() => setActiveGroups([])}
                      >
                        すべて表示に戻す
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="field-help">Themeにgroupが設定されていません。</p>
                );
              })()}
            </section>
            <section className="panel settings-form" hidden={activeSection !== "general"}>
              <div className="settings-section-heading">
                <h2>Tasken Root</h2>
                <IntegrationStatus
                  label={
                    rootShortcutState?.registered
                      ? "利用可能"
                      : rootShortcutState
                        ? "競合"
                        : "確認中"
                  }
                  tone={
                    rootShortcutState?.registered
                      ? "normal"
                      : rootShortcutState
                        ? "attention"
                        : "loading"
                  }
                />
              </div>
              <p className="field-help">Taskenが前面にないときも、仕事とActionを横断検索します。</p>
              <label>
                Global shortcut
                <input
                  value={rootShortcut}
                  onChange={(event) => setRootShortcut(event.target.value)}
                  spellCheck={false}
                />
              </label>
              {rootShortcutState?.error ? (
                <p className="field-help">{rootShortcutState.error}</p>
              ) : null}
              <Button
                variant="secondary"
                disabled={rootShortcutBusy || !rootShortcut.trim()}
                onClick={() => void saveRootShortcut()}
              >
                ショートカットを保存
              </Button>
              <details className="settings-detail">
                <summary>Direct shortcutとの役割</summary>
                <div className="settings-detail-body">
                  <p className="field-help">
                    RootはEntityを探して操作する共通入口です。毎日繰り返す記録だけはDirect
                    shortcutを維持します。
                  </p>
                  <dl className="settings-meta-list">
                    {DIRECT_SHORTCUT_DEFINITIONS.map((definition) => (
                      <div key={definition.id}>
                        <dt>{definition.label}</dt>
                        <dd className="mono-value shortcut-label">
                          {formatShortcutLabel(
                            definition.accelerator,
                            typeof navigator === "undefined" ? "" : navigator.platform,
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </details>
            </section>
            <section className="panel settings-form" hidden={activeSection !== "appearance"}>
              <h2>表示</h2>
              <label>
                カラーモード
                <select
                  value={themeMode}
                  onChange={(event) =>
                    setThemeMode(event.target.value === "dark" ? "dark" : "light")
                  }
                >
                  <option value="light">ライト</option>
                  <option value="dark">ダーク</option>
                </select>
              </label>
            </section>
            <section
              className="panel settings-form automatic-backup-panel"
              hidden={activeSection !== "advanced"}
            >
              <div className="settings-section-heading">
                <h2>自動バックアップ</h2>
                <IntegrationStatus
                  label={automaticBackupSummary.label}
                  tone={automaticBackupSummary.tone}
                />
              </div>
              <p className="field-help">
                起動時にSnapshotを作り、古いものから自動で入れ替えます。空の作業台は保存しません。
              </p>
              <label className="toggle">
                自動で作成
                <input
                  type="checkbox"
                  checked={automaticBackupEnabled}
                  disabled={automaticBackupBusy}
                  onChange={(event) => setAutomaticBackupEnabled(event.target.checked)}
                />
              </label>
              <label>
                保存先
                <input
                  value={automaticBackupDirectory}
                  readOnly
                  placeholder="Taskenデータ内の Backups"
                  title={automaticBackupDirectory}
                />
              </label>
              <label>
                保持する世代数
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={automaticBackupGenerations}
                  disabled={automaticBackupBusy}
                  onChange={(event) =>
                    setAutomaticBackupGenerations(
                      Math.max(1, Math.min(20, Number(event.target.value) || 1)),
                    )
                  }
                />
              </label>
              <dl className="settings-meta-list">
                <div>
                  <dt>最終成功</dt>
                  <dd>{backupTime(automaticBackupStatus?.lastSuccessAt || "")}</dd>
                </div>
                <div>
                  <dt>保存済み</dt>
                  <dd>
                    {automaticBackupStatus ? `${automaticBackupStatus.backupCount}世代` : "確認中"}
                  </dd>
                </div>
              </dl>
              {automaticBackupError ? (
                <div className="form-error">
                  <span>{automaticBackupError} 保存先を確認して、もう一度読み込んでください。</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setAutomaticBackupReloadToken((value) => value + 1)}
                  >
                    もう一度確認
                  </button>
                </div>
              ) : null}
              {automaticBackupStatus?.lastError ? (
                <p className="form-error">{automaticBackupStatus.lastError}</p>
              ) : null}
              <div className="settings-action-row">
                <Button
                  variant="secondary"
                  disabled={automaticBackupBusy}
                  onClick={chooseAutomaticBackupDirectory}
                >
                  保存先を選ぶ
                </Button>
                <Button
                  variant="secondary"
                  disabled={automaticBackupBusy || !automaticBackupDirectory}
                  onClick={saveAutomaticBackup}
                >
                  {automaticBackupBusy ? "処理中" : "設定を保存"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={automaticBackupBusy || !automaticBackupDirectory}
                  onClick={runAutomaticBackup}
                >
                  今すぐ作成
                </Button>
                {automaticBackupDirectory ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={openAutomaticBackupDirectory}
                  >
                    フォルダを開く
                  </button>
                ) : null}
              </div>
            </section>
            <section className="panel settings-form" hidden={activeSection !== "advanced"}>
              <h2>手動の移行・復元</h2>
              <p className="field-help">
                別端末への移行や任意時点への復元にはZIP形式のSnapshotを使います。
              </p>
              <div className="settings-action-row">
                <Button variant="secondary" disabled={busy} onClick={exportSnapshot}>
                  バックアップを書き出す
                </Button>
                <Button variant="secondary" disabled={busy} onClick={inspectSnapshot}>
                  バックアップを読み込む
                </Button>
              </div>
            </section>
            <section
              className="panel settings-form sync-settings-panel"
              hidden={activeSection !== "storage"}
            >
              <div className="settings-section-heading">
                <h2>端末間同期</h2>
                <IntegrationStatus
                  label={syncStatus?.state === "syncing" ? "同期中" : storageStatus.label}
                  tone={syncStatus?.state === "syncing" ? "loading" : storageStatus.tone}
                />
              </div>
              <p className="field-help">
                各端末のSQLiteはローカルに保ち、変更とNote内のMarkdown画像を交換します。
              </p>
              <details className="settings-detail">
                <summary>同期の詳細</summary>
                <div className="settings-detail-body">
                  <p className="field-help">
                    選択したOneDriveまたは共有フォルダを使います。画像は各端末にもキャッシュするため、同期後はオフラインでも表示できます。
                  </p>
                </div>
              </details>
              <dl className="settings-meta-list">
                <div>
                  <dt>同期先</dt>
                  <dd title={syncStatus?.directory}>{syncStatus?.directory || "未設定"}</dd>
                </div>
                <div>
                  <dt>最終同期</dt>
                  <dd>
                    {syncStatus?.lastSyncedAt
                      ? new Date(syncStatus.lastSyncedAt).toLocaleString("ja-JP", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "未同期"}
                  </dd>
                </div>
                <div>
                  <dt>端末</dt>
                  <dd className="mono-value">
                    {syncStatus?.deviceId ? syncStatus.deviceId.slice(0, 8) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Markdown画像</dt>
                  <dd>
                    {syncStatus ? `${syncStatus.markdownImageCount}件` : "—"}
                    {syncStatus &&
                    (syncStatus.lastMarkdownImagesPublished ||
                      syncStatus.lastMarkdownImagesReceived)
                      ? `（送信 ${syncStatus.lastMarkdownImagesPublished}・受信 ${syncStatus.lastMarkdownImagesReceived}）`
                      : ""}
                  </dd>
                </div>
              </dl>
              {syncStatus?.lastError && (
                <p className="form-error">同期エラー: {syncStatus.lastError}</p>
              )}
              <div className="settings-action-row">
                <Button variant="secondary" disabled={syncBusy} onClick={chooseSyncDirectory}>
                  {syncStatus?.directory ? "同期先を変更" : "同期先を選ぶ"}
                </Button>
                {syncStatus?.enabled && (
                  <>
                    <Button variant="primary" disabled={syncBusy} onClick={runSharedSync}>
                      {syncBusy ? "同期中" : "今すぐ同期"}
                    </Button>
                    <button className="text-button" disabled={syncBusy} onClick={disableSharedSync}>
                      停止
                    </button>
                  </>
                )}
              </div>
            </section>
            <section className="panel settings-form" hidden={activeSection !== "storage"}>
              {/* 保存先の設定は同期ルート一つに集約し、配下はTaskenが自動生成する（#306）。 */}
              <h2>同期ストレージ</h2>
              <p className="field-help">
                Tasken共通の同期ルートを使います。用途ごとの保存先設定は増やしません。
              </p>
              <details className="settings-detail">
                <summary>保存ルールを見る</summary>
                <div className="settings-detail-body">
                  <p className="field-help">
                    OneDrive等のTasken同期ルート配下に <code>Inbox/</code> と{" "}
                    <code>Themes/識別子/</code>、その中の <code>Notes|Artifacts|Exports/</code>{" "}
                    を必要時だけ自動生成します。Theme専用ルート、PDF等の明示Export、linked
                    Artifactはそれぞれ既存の導線で扱います。
                  </p>
                </div>
              </details>
              <dl className="settings-meta-list">
                <div>
                  <dt>同期ルート</dt>
                  <dd>{artifactDirectory || "未設定"}</dd>
                </div>
              </dl>
              <div className="settings-action-row">
                <Button variant="secondary" onClick={chooseArtifactDirectory}>
                  保存先を選ぶ
                </Button>
                {artifactDirectory && (
                  <Button variant="secondary" onClick={openArtifactDirectory}>
                    フォルダを開く
                  </Button>
                )}
              </div>
            </section>
            <section className="panel settings-form" hidden={activeSection !== "mobile"}>
              <div className="settings-section-heading">
                <h2>Android Companion</h2>
                <IntegrationStatus
                  label={
                    mobileGateway?.status === "ready"
                      ? "稼働中"
                      : mobileGatewayState === "loading"
                        ? "確認中"
                        : "停止"
                  }
                  tone={
                    mobileGateway?.status === "ready"
                      ? "normal"
                      : mobileGatewayState === "loading"
                        ? "loading"
                        : "attention"
                  }
                />
              </div>
              {mobileGatewayState === "error" ? (
                <p className="form-error">{mobileGatewayError}</p>
              ) : null}
              <dl className="settings-meta-list">
                <div>
                  <dt>Local endpoint</dt>
                  <dd className="mono-value">{mobileGateway?.localOrigin || "確認中"}</dd>
                </div>
                <div>
                  <dt>起動</dt>
                  <dd>
                    {mobileGateway?.startedAt ? backupTime(mobileGateway.startedAt) : "停止中"}
                  </dd>
                </div>
                <div>
                  <dt>最終リクエスト</dt>
                  <dd>
                    {mobileGateway?.latestRequest
                      ? `${mobileGateway.latestRequest.status} · ${mobileGateway.latestRequest.method} ${mobileGateway.latestRequest.path}`
                      : "未受信"}
                  </dd>
                </div>
              </dl>
              <div className="settings-action-row">
                <Button
                  variant="primary"
                  disabled={mobileGateway?.status !== "ready"}
                  onClick={issueMobilePairing}
                >
                  Androidを追加
                </Button>
                <Button variant="secondary" onClick={loadMobileGateway}>
                  状態を更新
                </Button>
              </div>
              {mobilePairing ? (
                <div className="settings-detail-body" aria-live="polite">
                  <strong>Pairing code</strong>
                  <p className="mono-value">{mobilePairing.code}</p>
                  <p className="field-help">
                    {backupTime(mobilePairing.expiresAt)}まで・1回のみ有効です。
                  </p>
                  <div className="settings-action-row">
                    <Button variant="secondary" onClick={copyMobilePairingCode}>
                      コードをコピー
                    </Button>
                    <button type="button" className="text-button" onClick={cancelMobilePairing}>
                      取り消す
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
            <section className="panel settings-form" hidden={activeSection !== "mobile"}>
              <h2>接続済み端末</h2>
              {mobileGateway?.devices.length ? (
                <div className="settings-list">
                  {mobileGateway.devices.map((device) => (
                    <div className="settings-list-row" key={device.id}>
                      <div>
                        <strong>{device.label}</strong>
                        <p className="field-help">
                          {device.revokedAt
                            ? `失効 ${backupTime(device.revokedAt)}`
                            : device.lastSeenAt
                              ? `最終接続 ${backupTime(device.lastSeenAt)}`
                              : "未接続"}
                        </p>
                      </div>
                      {!device.revokedAt ? (
                        <Button
                          variant="danger"
                          onClick={() => revokeMobileDevice(device.id, device.label)}
                        >
                          失効
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="field-help">接続済みのAndroid端末はありません。</p>
              )}
            </section>

            <section
              className="panel settings-form mcp-settings-panel"
              hidden={activeSection !== "ai-mcp"}
            >
              <div className="settings-section-heading">
                <h2>MCP Bridge</h2>
                <IntegrationStatus label={mcpSummary.label} tone={mcpSummary.tone} />
              </div>
              <p className="field-help">
                外部AIはTaskenを読み取り、追加・編集はPending
                Proposalとして送ります。正式データはTaskenで採用するまで変わりません。
              </p>
              <dl className="settings-meta-list">
                <div>
                  <dt>起動</dt>
                  <dd
                    className="mono-value"
                    title={mcpInfo ? `${mcpInfo.command} ${mcpInfo.args.join(" ")}` : ""}
                  >
                    {mcpInfo ? `${mcpInfo.command} ${mcpInfo.args.join(" ")}` : "読込中"}
                  </dd>
                </div>
                <div>
                  <dt>Pending Proposal</dt>
                  <dd>{mcpInfo?.pendingProposalCount || 0}件</dd>
                </div>
                <div>
                  <dt>Core</dt>
                  <dd>
                    {mcpInfo?.coreStatus === "available"
                      ? "接続済み"
                      : mcpInfo?.coreStatus === "unavailable"
                        ? "接続エラー"
                        : "未確認"}
                  </dd>
                </div>
                {mcpInfo?.coreApiVersion && (
                  <div>
                    <dt>API / Capabilities</dt>
                    <dd>
                      {mcpInfo.coreApiVersion} / {mcpInfo.coreCapabilityCount || 0}
                    </dd>
                  </div>
                )}
                {mcpInfo?.latestProposalId && (
                  <div>
                    <dt>Latest Proposal</dt>
                    <dd className="mono-value" title={mcpInfo.latestProposalId}>
                      {mcpInfo.latestProposalId}
                      {mcpInfo.latestProposalAt ? ` · ${backupTime(mcpInfo.latestProposalAt)}` : ""}
                    </dd>
                  </div>
                )}
              </dl>
              {mcpInfo?.coreNextAction && (
                <p className="alert-note warning">
                  {mcpInfo.coreErrorCode}: {mcpInfo.coreErrorMessage} {mcpInfo.coreNextAction}
                </p>
              )}
              <div className="settings-action-row">
                <Button variant="secondary" disabled={!mcpInfo} onClick={copyMcpConfig}>
                  接続設定をコピー
                </Button>
                <Button variant="secondary" disabled={mcpBusy} onClick={() => void reloadMcpInfo()}>
                  {mcpBusy ? "確認中" : "状態を再確認"}
                </Button>
              </div>
            </section>
            <section
              className="panel settings-form ai-visibility-settings-panel"
              hidden={activeSection !== "ai-mcp"}
            >
              <div className="settings-section-heading">
                <h2>AI公開範囲の既定</h2>
              </div>
              <details className="settings-detail">
                <summary>公開範囲を編集</summary>
                <div className="settings-detail-body">
                  <p className="field-help">
                    Theme・各項目で個別に決めていないときに使う既定です。項目側の設定が常に優先されます。
                  </p>
                  <fieldset className="ai-context-visibility">
                    <legend>渡してよい相手</legend>
                    {AI_AUDIENCES.map((audience) => (
                      <label key={audience}>
                        <input
                          type="checkbox"
                          checked={aiVisibilityDefault.includes(audience)}
                          disabled={aiVisibilityBusy}
                          onChange={(event) =>
                            updateAiVisibilityDefault(audience, event.target.checked)
                          }
                        />
                        {AI_AUDIENCE_LABELS[audience]}
                      </label>
                    ))}
                  </fieldset>
                </div>
              </details>
            </section>
            <section
              className="panel settings-form calendar-settings-panel"
              hidden={activeSection !== "integrations"}
            >
              <div className="settings-section-heading">
                <h2>カレンダー連携</h2>
                <IntegrationStatus
                  label={calendarSummary.label}
                  tone={calendarSummary.tone}
                  detail={calendarSummary.detail}
                />
              </div>
              <p className="field-help">
                Outlook / Microsoft
                365のカレンダーを読み取り専用で表示します。メールや連絡先にはアクセスしません。
              </p>
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
                          ? new Date(calendarStatus.lastFetchedAt).toLocaleString("ja-JP", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "未取得"}
                      </dd>
                    </div>
                  </dl>
                  <div className="settings-danger-zone">
                    <h3>Danger Zone</h3>
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
            <section
              className="panel settings-form update-panel"
              hidden={activeSection !== "advanced"}
            >
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
                    <dd>
                      {new Date(updateInfo.publishedAt).toLocaleString("ja-JP", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </dd>
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
        </div>
      </div>
      {syncStatus && syncStatus.conflicts.length > 0 && activeSection === "storage" && (
        <section className="panel sync-conflict-panel">
          <div className="section-heading">
            <h2>同期の競合</h2>
            <span>{syncStatus.conflicts.length}件</span>
          </div>
          <p className="field-help">
            同じデータが両端末で変更されています。残す内容を選んでください。
          </p>
          {syncStatus.conflicts.map((conflict) => (
            <div className="sync-conflict-row" key={conflict.id}>
              <div className="sync-conflict-title">
                <strong>{entityTitle(conflict.entityType, conflict.local)}</strong>
                <small>
                  {conflict.entityType} / 相手端末 {conflict.incomingDeviceId.slice(0, 8)}
                </small>
              </div>
              <div className="sync-conflict-choice">
                <div>
                  <span>この端末</span>
                  <strong>{entityTitle(conflict.entityType, conflict.local)}</strong>
                  <small>
                    {conflict.local.updated_at
                      ? new Date(String(conflict.local.updated_at)).toLocaleString("ja-JP")
                      : "更新時刻なし"}
                  </small>
                  <Button
                    variant="secondary"
                    disabled={syncBusy}
                    onClick={() => resolveSyncConflict(conflict.id, "local")}
                  >
                    こちらを残す
                  </Button>
                </div>
                <div>
                  <span>相手端末</span>
                  <strong>{entityTitle(conflict.entityType, conflict.incoming)}</strong>
                  <small>
                    {conflict.incoming.updated_at
                      ? new Date(String(conflict.incoming.updated_at)).toLocaleString("ja-JP")
                      : "更新時刻なし"}
                  </small>
                  <Button
                    variant="secondary"
                    disabled={syncBusy}
                    onClick={() => resolveSyncConflict(conflict.id, "incoming")}
                  >
                    こちらを残す
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
      {snapshotPreview && activeSection === "advanced" && (
        <section className="panel snapshot-preview">
          <div className="section-heading">
            <h2>Snapshot差分</h2>
            <span>{snapshotPreview.changes.length}件</span>
          </div>
          {snapshotPreview.changes.map((change) => (
            <div className="import-candidate" key={change.key}>
              <div>
                <strong>{entityTitle(change.type, change.incoming)}</strong>
                <small>
                  {change.type} / {change.category}
                </small>
              </div>
              <select
                value={snapshotPreview.decisions[change.key]}
                onChange={(event) =>
                  setSnapshotPreview({
                    ...snapshotPreview,
                    decisions: { ...snapshotPreview.decisions, [change.key]: event.target.value },
                  })
                }
              >
                {(change.actions || ["ignore"]).map((action) => (
                  <option key={action} value={action}>
                    {action === "ignore"
                      ? "無視"
                      : action === "create"
                        ? "新規作成"
                        : action === "update"
                          ? "既存を更新"
                          : "両方残す"}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setSnapshotPreview(null)}>
              取り消す
            </Button>
            <Button variant="primary" disabled={busy} onClick={applySnapshot}>
              選択内容を反映
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
