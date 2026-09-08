import { useEffect, useRef, useState } from "react";
import type {
  DailyContextAutoConfig,
  DailyContextAutoStatus,
} from "../../../../../shared/dailyContextAuto";
import { workspaceApi } from "../../../services/workspaceApi";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import type { PageProps } from "../types";
import { Button, ThemePickerSelect } from "./common";

export function DailyContextAutoSettings({
  today,
  themes,
}: {
  today: string;
  themes: PageProps["themes"];
}) {
  const [status, setStatus] = useState<DailyContextAutoStatus | null>(null);
  const [draft, setDraft] = useState<DailyContextAutoConfig | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const getStatus = useWorkspaceStore((state) => state.getDailyContextAutoStatus);
  const configure = useWorkspaceStore((state) => state.configureDailyContextAuto);
  const retry = useWorkspaceStore((state) => state.retryDailyContextAuto);
  useEffect(() => {
    let disposed = false;
    let reading = false;
    async function refresh() {
      if (reading || busy.current) return;
      reading = true;
      try {
        const next = await getStatus();
        if (!disposed && !busy.current) {
          setStatus(next);
          setDraft(
            (current) => current ?? { ...next.config, fromDate: next.config.fromDate || today },
          );
        }
      } catch (failure) {
        if (!disposed) setError(String(failure));
      } finally {
        reading = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [today, getStatus]);
  async function run(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (failure) {
      setError(
        (failure instanceof Error ? failure.message : String(failure)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  function change(value: Partial<DailyContextAutoConfig>) {
    setDraft((current) => current && { ...current, ...value });
    setMessage("");
  }
  const freshness = status?.freshness;
  return (
    <details className="daily-context-auto">
      <summary>
        自動公開の設定・更新状況{status ? `（${status.config.enabled ? "有効" : "停止中"}）` : ""}
      </summary>
      <p>有効にすると、Desktopが起動している間、受信済みの記録を日ごとに更新します。</p>
      {draft ? (
        <fieldset disabled={working}>
          <label className="daily-context-checkbox">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => change({ enabled: event.target.checked })}
            />
            日別Markdownを自動公開する
          </label>
          <div className="daily-context-destination">
            <span>{draft.root || "自動公開先は未設定です"}</span>
            <Button
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  const selected = await workspaceApi.chooseDirectory(
                    "自動公開するMarkdownの保存先（OneDrive内など）",
                  );
                  if (!selected.canceled && selected.path) change({ root: selected.path });
                })
              }
            >
              自動公開先を選ぶ
            </Button>
          </div>
          <label>
            初回に公開する開始日
            <input
              type="date"
              max={today}
              value={draft.fromDate}
              onChange={(event) => change({ fromDate: event.target.value })}
            />
          </label>
          <span className="muted">タイムゾーン: {draft.timezone}</span>
          <label>
            自動公開するTheme（記録当時の所属）
            <ThemePickerSelect
              themes={themes}
              value={draft.themeId ?? "all"}
              allowAll
              allLabel="全Theme・未設定"
              ariaLabel="自動公開するTheme"
              onChange={(value) => change({ themeId: value === "all" ? null : value })}
            />
          </label>
          <label className="daily-context-checkbox">
            <input
              type="checkbox"
              checked={draft.includeFullText}
              onChange={(event) => change({ includeFullText: event.target.checked })}
            />
            公開対象Note・Capture・作業記録の本文も自動公開する
          </label>
          <p className="muted">
            現在M365への公開を許可した記録が対象です。本文公開は初期状態では無効です。
            開始日は初回の範囲です。公開済みの古い日も、非公開化などを反映するため更新します。
            手動で公開した内容も次の自動更新でこの設定に揃います。
          </p>
          <p className="muted">
            停止しても公開済みファイルは残ります。保存先を変えると、以前の保存先のTasken管理ファイルを撤去します。
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              void run(async () => {
                const next = await configure(draft);
                setStatus(next);
                setDraft(next.config);
                setMessage(
                  next.config.enabled
                    ? "設定を保存しました。順次、自動公開します。"
                    : "自動公開を停止しました。公開済みファイルは残っています。",
                );
              })
            }
          >
            {working ? "処理中…" : "自動公開の設定を保存"}
          </Button>
        </fieldset>
      ) : (
        <p>設定を読み込んでいます…</p>
      )}
      {freshness && (
        <div className="daily-context-auto-status">
          <p>
            確認時点: {freshness.observedAt} ／ 未処理:{" "}
            {freshness.pendingCount === null ? "確認中" : `${freshness.pendingCount}日`}
          </p>
          <p>
            日付範囲の確認済み: {freshness.publishedThrough ?? "未確認"} ／ 最後の日別更新:{" "}
            {freshness.lastLocalWrittenAt ?? "まだありません"}
          </p>
          <details>
            <summary>基準revision・端末からの受信情報</summary>
            <p>公開の基準revision: {freshness.sourceRevision ?? "まだありません"}</p>
            {freshness.deviceObservations.length === 0 ? (
              <p>端末の受信・接続情報はありません。</p>
            ) : (
              <ul>
                {freshness.deviceObservations.map((device) => (
                  <li key={`${device.kind}:${device.deviceId}`}>
                    {device.kind === "android_connection"
                      ? "Androidの最終接続（受信完了を意味しません）"
                      : "共有フォルダーからの最終受信"}
                    : {device.deviceId} — {device.observedAt}
                  </li>
                ))}
              </ul>
            )}
          </details>
          <p className="muted">
            Android内の未送信データ、OneDriveの同期完了、外部AIへの反映は確認できません。表示は確認時点までの情報です。
          </p>
        </div>
      )}
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
      {status?.error && status.config.enabled && (
        <Button
          variant="secondary"
          disabled={working}
          onClick={() =>
            void run(async () => {
              setStatus(await retry());
            })
          }
        >
          自動公開を再試行
        </Button>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
