import { useCallback, useEffect, useState } from "react";

import {
  CAPTURE_ORGANIZER_PROVIDERS,
  CAPTURE_ORGANIZER_CHAT_MODELS,
  type CaptureOrganizerProvider,
  type CaptureOrganizerSettingsState,
} from "../../../../../shared/captureOrganizerSettings";
import { captureOrganizerApi } from "../../../services/captureOrganizerApi";
import { Button, IntegrationStatus } from "./common";

export function CaptureOrganizerSettings() {
  const [settings, setSettings] = useState<CaptureOrganizerSettingsState | null>(null);
  const [provider, setProvider] = useState<CaptureOrganizerProvider>("openai");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"loading" | "saving" | "testing" | "clearing" | null>("loading");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const applySettings = useCallback((value: CaptureOrganizerSettingsState) => {
    setSettings(value);
    setProvider(value.provider);
    setModel(value.model);
    setEndpoint(value.endpoint);
    setApiKey("");
    setConfirmClear(false);
  }, []);

  async function load() {
    setBusy("loading");
    setFeedback(null);
    try {
      applySettings(await captureOrganizerApi.getSettings());
    } catch {
      setFeedback({ message: "設定を読み込めませんでした。再読み込みしてください。", error: true });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void captureOrganizerApi
      .getSettings()
      .then((value) => {
        if (!cancelled) applySettings(value);
      })
      .catch(() => {
        if (!cancelled)
          setFeedback({
            message: "設定を読み込めませんでした。再読み込みしてください。",
            error: true,
          });
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [applySettings]);

  const normalizedEndpoint = provider === "azure" ? endpoint.trim().replace(/\/$/, "") : "";
  const canReuseKey = Boolean(
    settings?.hasApiKey &&
    settings.provider === provider &&
    normalizedEndpoint === settings.endpoint.replace(/\/$/, ""),
  );
  const ready =
    model.trim().length > 0 &&
    (apiKey.trim().length > 0 || canReuseKey) &&
    (provider !== "azure" || normalizedEndpoint.length > 0);
  const changed =
    !settings ||
    settings.source !== "saved" ||
    provider !== settings.provider ||
    model.trim() !== settings.model ||
    normalizedEndpoint !== settings.endpoint.replace(/\/$/, "") ||
    apiKey.length > 0;
  const modelChoices =
    provider === "opencode-zen" || provider === "opencode-go"
      ? CAPTURE_ORGANIZER_CHAT_MODELS[provider]
      : null;

  function input() {
    return {
      provider,
      model: model.trim(),
      endpoint: normalizedEndpoint,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
  }

  async function save() {
    if (busy || !ready) return;
    setBusy("saving");
    setFeedback(null);
    try {
      applySettings(await captureOrganizerApi.saveSettings(input()));
      setFeedback({ message: "保存しました。次の入力整理から反映されます。", error: false });
    } catch {
      setFeedback({
        message:
          "設定を保存できませんでした。モデル・接続先・APIキーを確認して再試行してください。入力は保持しています。",
        error: true,
      });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (busy || !ready) return;
    setBusy("testing");
    setFeedback(null);
    try {
      const result = await captureOrganizerApi.testConnection(input());
      setFeedback({
        message:
          result.ok && changed ? `${result.message} 設定はまだ保存していません。` : result.message,
        error: !result.ok,
      });
    } catch {
      setFeedback({
        message:
          "接続を確認できませんでした。モデル・接続先・APIキーとネットワークを確認してください。入力は保持しています。",
        error: true,
      });
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy("clearing");
    setFeedback(null);
    try {
      const value = await captureOrganizerApi.clearSettings();
      applySettings(value);
      setFeedback({
        message:
          value.source === "environment"
            ? "保存設定を削除し、環境変数の設定に戻しました。"
            : "保存設定とAPIキーを削除しました。",
        error: false,
      });
    } catch {
      setFeedback({ message: "設定を削除できませんでした。再試行してください。", error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="panel settings-form"
      aria-labelledby="capture-organizer-settings-title"
      data-testid="capture-organizer-settings"
    >
      <div className="settings-section-heading">
        <h2 id="capture-organizer-settings-title">入力のAI整理</h2>
        <IntegrationStatus
          label={
            busy === "loading"
              ? "読み込み中"
              : settings?.source === "saved"
                ? "保存設定を使用"
                : settings?.source === "environment"
                  ? "環境変数を使用"
                  : "未設定"
          }
          tone={busy === "loading" ? "loading" : settings?.hasApiKey ? "normal" : "neutral"}
        />
      </div>
      <p className="field-help">
        DesktopとAndroidで共通です。入力した文章からTask名・Theme・日付・チェック項目の整理案を作ります。
      </p>
      {settings?.configurationError && (
        <p className="form-error" role="alert">
          {settings.configurationError}
        </p>
      )}
      {!settings ? (
        <>{busy !== "loading" && <Button onClick={() => void load()}>再読み込み</Button>}</>
      ) : (
        <>
          <label>
            <span>プロバイダー</span>
            <select
              aria-label="入力整理のプロバイダー"
              value={provider}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setProvider(event.target.value as CaptureOrganizerProvider);
                setModel("");
                setEndpoint("");
                setApiKey("");
                setFeedback(null);
                setConfirmClear(false);
              }}
            >
              {CAPTURE_ORGANIZER_PROVIDERS.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{provider === "azure" ? "デプロイ名" : "モデルID"}</span>
            {modelChoices ? (
              <select
                aria-label="入力整理のモデル"
                value={model}
                disabled={Boolean(busy)}
                onChange={(event) => {
                  setModel(event.target.value);
                  setFeedback(null);
                }}
              >
                <option value="">モデルを選ぶ</option>
                {model && !modelChoices.some((id) => id === model) && (
                  <option value={model}>{model}（対応モデルを選んでください）</option>
                )}
                {modelChoices.map((id) => (
                  <option value={id} key={id}>
                    {id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="入力整理のモデル"
                value={model}
                disabled={Boolean(busy)}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setModel(event.target.value);
                  setFeedback(null);
                }}
              />
            )}
          </label>
          {provider === "azure" && (
            <label>
              <span>Azure接続先</span>
              <input
                type="url"
                aria-label="Azure接続先"
                placeholder="https://RESOURCE.openai.azure.com"
                value={endpoint}
                disabled={Boolean(busy)}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setEndpoint(event.target.value);
                  setApiKey("");
                  setFeedback(null);
                }}
              />
            </label>
          )}
          <label>
            <span>APIキー</span>
            <input
              type="password"
              aria-label="入力整理のAPIキー"
              value={apiKey}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={canReuseKey ? "設定済み・変更するときだけ入力" : "APIキーを入力"}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setApiKey(event.target.value);
                setFeedback(null);
              }}
            />
          </label>
          <p className="field-help">
            キーはこのDesktopで暗号化して保存します。接続確認はテスト用の短文を送信します（API利用料が発生する場合があります）。
          </p>
          {!settings.secureStorageAvailable && (
            <p className="form-error">
              この環境ではAPIキーを安全に保存できません。OSの資格情報保護を利用できる環境で設定してください。
            </p>
          )}
          <div className="settings-action-row">
            <Button
              variant="primary"
              disabled={Boolean(busy) || !ready || !changed || !settings.secureStorageAvailable}
              onClick={() => void save()}
            >
              {busy === "saving" ? "保存中…" : "設定を保存"}
            </Button>
            <Button disabled={Boolean(busy) || !ready} onClick={() => void test()}>
              {busy === "testing" ? "接続を確認中…" : "接続を確認"}
            </Button>
          </div>
          {(settings.source === "saved" || settings.configurationError) &&
            (confirmClear ? (
              <div className="settings-detail-body">
                <p className="field-help">
                  保存設定とAPIキーを削除します。環境変数に設定がある場合はそちらへ戻ります。
                </p>
                <div className="settings-action-row">
                  <Button variant="danger" disabled={Boolean(busy)} onClick={() => void clear()}>
                    削除する
                  </Button>
                  <Button disabled={Boolean(busy)} onClick={() => setConfirmClear(false)}>
                    戻る
                  </Button>
                </div>
              </div>
            ) : (
              <button
                className="text-button"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setConfirmClear(true)}
              >
                保存設定を削除
              </button>
            ))}
        </>
      )}
      {feedback && (
        <p
          role={feedback.error ? "alert" : "status"}
          className={feedback.error ? "form-error" : "field-help"}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
}
