const FALLBACK = "画面録画を開始できませんでした。録画対象を選び直してください。";

/**
 * 画面録画の失敗は音声Captureとは原因も次の操作も違う。
 * mediaCaptureIpcErrorを流用すると「録音データを保存できませんでした」のような
 * 別機能の文言が出るため、専用の対応表を持つ。
 */
const SAFE_MESSAGES: Array<[RegExp, string]> = [
  [/選択期限|使用済み/, "録画対象の選択期限が切れました。対象を選び直して、すぐに開始してください。"],
  [/明示操作/, "画面録画は開始ボタンから始めてください。対象を選び直して、もう一度開始してください。"],
  [/要求元|frameが一致|originが一致|Main frame/, "画面録画の要求元を確認できませんでした。画面を再読み込みして、もう一度選択してください。"],
  [/audio要求/, "音声の設定が選択内容と一致しません。音声設定を選び直してください。"],
  [/システム音声/, "この環境ではシステム音声付きの画面録画を利用できません。音声をOffかマイクにしてください。"],
  [/マイク/, "利用できるマイクがありません。接続を確認してから、もう一度開始してください。"],
  [/source kind|source ID|source thumbnail|source一覧|source token/, "録画対象の一覧を取得できませんでした。画面を再読み込みして、もう一度選択してください。"],
  [/閉じられました/, "録画対象が閉じられました。対象を選び直してください。"],
  [/引数/, "画面録画の要求が不正です。画面を再読み込みしてください。"],
];

/** Node/fsのmessageやabsolute pathをRendererへ渡さない。 */
export function projectScreenRecordingIpcError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  for (const [pattern, safeMessage] of SAFE_MESSAGES) {
    if (pattern.test(message)) return new Error(safeMessage);
  }
  return new Error(FALLBACK);
}
