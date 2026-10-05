import { useCallback, useEffect, useState } from "react";

import {
  CAPTURE_ORGANIZER_PROVIDERS,
  CAPTURE_ORGANIZER_CHAT_MODELS,
  CAPTURE_ORGANIZER_MONTHLY_LIMIT_MAX,
  type CaptureOrganizerProvider,
  type CaptureOrganizerSettingsState,
  type ChatGptAccountState,
  type ChatGptModelOption,
} from "../../../../../shared/captureOrganizerSettings";
import { captureOrganizerApi } from "../../../services/captureOrganizerApi";
import { Button, IntegrationStatus } from "./common";

export function CaptureOrganizerSettings() {
  const [settings, setSettings] = useState<CaptureOrganizerSettingsState | null>(null);
  const [provider, setProvider] = useState<CaptureOrganizerProvider>("chatgpt");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [vocabulary, setVocabulary] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [account, setAccount] = useState<ChatGptAccountState | null>(null);
  const [models, setModels] = useState<ChatGptModelOption[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "loading" | "saving" | "testing" | "clearing" | "connecting" | "disconnecting" | null
  >("loading");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const applySettings = useCallback((value: CaptureOrganizerSettingsState) => {
    setSettings(value);
    setProvider(value.provider);
    setModel(value.model);
    setEndpoint(value.endpoint);
    setVocabulary(value.vocabulary);
    setMonthlyLimit(value.monthlyRequestLimit === null ? "" : String(value.monthlyRequestLimit));
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

  const loadModels = useCallback(async () => {
    setModelsError(null);
    try {
      setModels(await captureOrganizerApi.chatGptModels());
    } catch {
      setModels(null);
      setModelsError("モデル一覧を取得できませんでした。接続を確認して再読み込みしてください。");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void captureOrganizerApi
      .chatGptState()
      .then((value) => {
        if (cancelled) return;
        setAccount(value);
        if (value.status === "connected") void loadModels();
      })
      .catch(() => {
        if (!cancelled) setAccount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadModels]);

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

  const isChatGpt = provider === "chatgpt";
  const normalizedEndpoint = provider === "azure" ? endpoint.trim().replace(/\/$/, "") : "";
  const trimmedLimit = monthlyLimit.trim();
  const parsedLimit = trimmedLimit ? Number(trimmedLimit) : null;
  const limitValid =
    parsedLimit === null ||
    (Number.isInteger(parsedLimit) &&
      parsedLimit >= 1 &&
      parsedLimit <= CAPTURE_ORGANIZER_MONTHLY_LIMIT_MAX);
  const canReuseKey = Boolean(
    settings?.hasApiKey &&
    settings.provider === provider &&
    normalizedEndpoint === settings.endpoint.replace(/\/$/, ""),
  );
  const ready = isChatGpt
    ? model.trim().length > 0 && account?.status === "connected"
    : model.trim().length > 0 &&
      (apiKey.trim().length > 0 || canReuseKey) &&
      (provider !== "azure" || normalizedEndpoint.length > 0) &&
      limitValid;
  const changed =
    !settings ||
    settings.source !== "saved" ||
    provider !== settings.provider ||
    model.trim() !== settings.model ||
    normalizedEndpoint !== settings.endpoint.replace(/\/$/, "") ||
    vocabulary.trim() !== settings.vocabulary ||
    (!isChatGpt && parsedLimit !== settings.monthlyRequestLimit) ||
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
      vocabulary: vocabulary.trim(),
      ...(apiKey.trim() && !isChatGpt ? { apiKey: apiKey.trim() } : {}),
      monthlyRequestLimit: isChatGpt ? null : parsedLimit,
    };
  }

  async function connectChatGpt() {
    if (busy) return;
    setBusy("connecting");
    setFeedback(null);
    setAccount((current) => (current ? { ...current, status: "connecting" } : current));
    try {
      const value = await captureOrganizerApi.chatGptConnect();
      setAccount(value);
      setFeedback({
        message: "ChatGPTと接続しました。モデルを選んで保存してください。",
        error: false,
      });
      await loadModels();
    } catch (error) {
      setAccount(await captureOrganizerApi.chatGptState().catch(() => null));
      setFeedback({
        message:
          error instanceof Error && error.message
            ? error.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, "")
            : "ChatGPTに接続できませんでした。もう一度お試しください。",
        error: true,
      });
    } finally {
      setBusy(null);
    }
  }

  async function disconnectChatGpt() {
    if (busy) return;
    setBusy("disconnecting");
    setFeedback(null);
    try {
      setAccount(await captureOrganizerApi.chatGptDisconnect());
      setModels(null);
      setFeedback({ message: "ChatGPTとの接続を解除しました。", error: false });
    } catch {
      setFeedback({ message: "接続を解除できませんでした。再試行してください。", error: true });
    } finally {
      setBusy(null);
    }
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
        message: isChatGpt
          ? "設定を保存できませんでした。ChatGPTとの接続とモデルを確認して再試行してください。入力は保持しています。"
          : "設定を保存できませんでした。モデル・接続先・APIキー・月間上限を確認して再試行してください。入力は保持しています。",
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
          tone={
            busy === "loading"
              ? "loading"
              : settings?.source === "saved" &&
                  (settings.provider === "chatgpt"
                    ? account?.status === "connected"
                    : settings.hasApiKey)
                ? "normal"
                : settings?.source === "environment" && settings.hasApiKey
                  ? "normal"
                  : "neutral"
          }
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
                setMonthlyLimit("");
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
          {isChatGpt && (
            <div className="settings-detail-body" data-testid="chatgpt-account">
              <p className="field-help">
                ChatGPT Plus /
                Proの契約に含まれる利用枠で整理します。APIキーと従量課金は不要です。上限に達しても有料APIへ自動では切り替えません。
              </p>
              {account?.status === "connected" ? (
                <div className="settings-action-row">
                  <IntegrationStatus
                    label={`接続中：${account.email ?? "ChatGPT"}`}
                    tone="normal"
                  />
                  <Button disabled={Boolean(busy)} onClick={() => void disconnectChatGpt()}>
                    {busy === "disconnecting" ? "解除中…" : "接続を解除"}
                  </Button>
                </div>
              ) : (
                <>
                  {account?.status === "reauth_required" && (
                    <p className="form-error" role="alert">
                      ChatGPTとの接続が切れました。もう一度接続してください。
                    </p>
                  )}
                  {account && !account.secureStorageAvailable && (
                    <p className="form-error">
                      この環境では接続情報を安全に保存できません。OSの資格情報保護を利用できる環境で接続してください。
                    </p>
                  )}
                  <div className="settings-action-row">
                    <Button
                      variant="primary"
                      disabled={Boolean(busy) || !account || !account.secureStorageAvailable}
                      onClick={() => void connectChatGpt()}
                    >
                      {busy === "connecting" ? "ブラウザで許可を待っています…" : "ChatGPTで続ける"}
                    </Button>
                    {busy === "connecting" && (
                      <Button onClick={() => void captureOrganizerApi.chatGptCancel()}>
                        やめる
                      </Button>
                    )}
                  </div>
                  <p className="field-help">
                    ブラウザでChatGPTにログインして許可します。接続情報はこのDesktopで暗号化して保存し、同期・Export・外部AI連携には含めません。
                  </p>
                </>
              )}
            </div>
          )}
          <label>
            <span>{provider === "azure" ? "デプロイ名" : isChatGpt ? "モデル" : "モデルID"}</span>
            {isChatGpt ? (
              <select
                aria-label="入力整理のモデル"
                value={model}
                disabled={Boolean(busy) || account?.status !== "connected"}
                onChange={(event) => {
                  setModel(event.target.value);
                  setFeedback(null);
                }}
              >
                <option value="">
                  {account?.status === "connected" ? "モデルを選ぶ" : "接続後に選べます"}
                </option>
                {model && !(models ?? []).some((item) => item.slug === model) && (
                  <option value={model}>{model}</option>
                )}
                {(models ?? []).map((item) => (
                  <option value={item.slug} key={item.slug}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            ) : modelChoices ? (
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
          {isChatGpt && modelsError && (
            <div className="settings-action-row">
              <p className="form-error">{modelsError}</p>
              <Button disabled={Boolean(busy)} onClick={() => void loadModels()}>
                再読み込み
              </Button>
            </div>
          )}
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
          {!isChatGpt && (
            <>
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
              <label>
                <span>月間の送信上限（回）</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={CAPTURE_ORGANIZER_MONTHLY_LIMIT_MAX}
                  aria-label="入力整理の月間送信上限"
                  value={monthlyLimit}
                  placeholder="上限なし"
                  disabled={Boolean(busy)}
                  onChange={(event) => {
                    setMonthlyLimit(event.target.value);
                    setFeedback(null);
                  }}
                />
              </label>
              <p className={limitValid ? "field-help" : "form-error"}>
                {limitValid
                  ? `今月の送信：${settings.monthlyRequestCount}回。上限に達すると、その月はAPIへ送らずに止めます。`
                  : `1〜${CAPTURE_ORGANIZER_MONTHLY_LIMIT_MAX}の整数を入力するか、空欄で上限なしにしてください。`}
              </p>
            </>
          )}
          <label>
            <span>音声・固有語辞書</span>
            <textarea
              aria-label="入力整理の音声・固有語辞書"
              value={vocabulary}
              rows={4}
              maxLength={4000}
              disabled={Boolean(busy)}
              placeholder={"Tasken\n研究固有の用語\n人名や製品名"}
              onChange={(event) => {
                setVocabulary(event.target.value);
                setFeedback(null);
              }}
            />
          </label>
          <p className="field-help">
            音声認識で誤記されやすい語を1行に1語で指定します。入力整理の候補としてだけ使います。
          </p>
          {!isChatGpt && !settings.secureStorageAvailable && (
            <p className="form-error">
              この環境ではAPIキーを安全に保存できません。OSの資格情報保護を利用できる環境で設定してください。
            </p>
          )}
          <div className="settings-action-row">
            <Button
              variant="primary"
              disabled={
                Boolean(busy) ||
                !ready ||
                !changed ||
                (!isChatGpt && !settings.secureStorageAvailable)
              }
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
