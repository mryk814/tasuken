import { logMain } from "./log";

export type MediaCaptureIpcAction = "prepare" | "list" | "commit" | "cancel" | "record";

const ACTION_FALLBACK: Record<MediaCaptureIpcAction, string> = {
  prepare: "音声を取り込めませんでした。ファイルを確認して、もう一度選択してください。",
  list: "保存待ち音声を確認できませんでした。画面を再読み込みしてください。",
  commit: "音声を保存できませんでした。保存先を確認して、保存待ち音声から再試行してください。",
  cancel: "保存待ち音声を破棄できませんでした。画面を再読み込みして、もう一度試してください。",
  record: "録音データを保存できませんでした。録音を停止し、保存待ち音声を確認してください。",
};

const SAFE_MESSAGES: Array<[RegExp, string]> = [
  [/対応していない音声形式/, "対応していない音声形式です。MP3、WAV、WebM、Ogg/Opus、M4A/MP4を選択してください。"],
  [/空の音声ファイル/, "空の音声ファイルは取り込めません。録音元を確認してください。"],
  [/Themeが見つかりません/, "音声CaptureのThemeが見つかりません。Themeを選び直してください。"],
  [/Artifact保存先が未設定/, "Artifact保存先が未設定です。Settingsで同期ストレージを選択してから、もう一度保存してください。"],
  [/duration|音声の長さ/, "音声の長さを取得できませんでした。対応形式を確認して、もう一度選択してください。"],
  [/session.*不正|session IDが不正/, "音声Capture sessionが不正です。保存待ち音声を読み直してください。"],
  [/差し替え|symlink|junction|安全でない/, "音声ファイルを安全に確認できませんでした。元ファイルを確認して、もう一度選択してください。"],
  [/保存処理を開始した/, "保存処理を開始した音声Captureは破棄できません。再起動後の復旧を待ってください。"],
  [/finalize|復旧待ち|identity|hash|競合file|managed保存先/, "音声の保存を安全に完了できませんでした。原音は保持されています。保存待ち音声から再試行してください。"],
  [/録音中では|一時停止中では|録音chunk|録音サイズ|録音データ|録音形式|録音時間|録音session/, "録音を続けられませんでした。録音を停止し、保存待ち音声を確認してください。"],
];

/**
 * Node/fsのmessageやabsolute pathをRendererへ渡さない。
 * ここで原因が消えるので、Main側のログにだけ生の理由を残す。
 */
export function projectMediaCaptureIpcError(action: MediaCaptureIpcAction, error: unknown): Error {
  logMain("error", `media-capture:${action}`, "Rendererへは安全な文言を返す", error);
  const message = error instanceof Error ? error.message : "";
  for (const [pattern, safeMessage] of SAFE_MESSAGES) {
    if (pattern.test(message)) return new Error(safeMessage);
  }
  return new Error(ACTION_FALLBACK[action]);
}
