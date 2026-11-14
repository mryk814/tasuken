/**
 * isErrorの結果の`error.code`をHTTP statusへ写す。personal-infrastructureのawai
 * (`/api/v1/<tool>`)と同じ対応にして、Muse・Grok Botが両方を同じ扱いで呼べるようにする。
 * Taskのtransport(taskHttpAdapter)の対応(FORBIDDEN・INVALID_TRANSITION・UNAVAILABLE・INTERNAL_ERROR)とも揃える。
 * 結果が`{error}`の形でないisErrorは、SDKの入力検証の失敗（-32602）だけを呼び方の誤りとして400にし、
 * それ以外（tool内部の想定外の例外）は500にする。サーバー側の不具合を「要求の誤り」に見せないため。
 *
 * HTTPの`/api/v1`の応答と、toolの呼び出しの計測（toolStats.mjs）が同じ分類を使うので、ここに置く。
 */
export function apiErrorStatus(value) {
  const code = value?.error?.code;
  if (typeof code !== "string") {
    const text = typeof value?.text === "string" ? value.text : "";
    return /-32602|Input validation error/i.test(text) ? 400 : 500;
  }
  const upper = code.toUpperCase();
  // INVALID_*を503にする規則より先に、入力の誤りの400を判定する。
  if (["VALIDATION_FAILED", "INVALID_JSON"].includes(upper)) return 400;
  if (["WRITE_NOT_ALLOWED", "FORBIDDEN", "NOT_RECORD_WRITER"].includes(upper)) return 403;
  // AIの作業の1日の上限（#751）。retryableだが、サーバーの一時的な失敗（503）とは分ける。
  if (upper === "DAILY_LIMIT") return 429;
  if (upper.includes("NOT_FOUND")) return 404;
  // DESKTOP_BEHIND・REPLICA_BEHINDはretryableだが、既定の503ではなく状態の食い違いの409にする。
  if (
    [
      "IDEMPOTENCY_CONFLICT",
      "CONFLICT",
      "STALE_VERSION",
      "INVALID_TRANSITION",
      "DESKTOP_BEHIND",
      "REPLICA_BEHIND",
    ].includes(upper)
  )
    return 409;
  if (["PROPOSAL_TOO_LARGE", "BODY_TOO_LARGE"].includes(upper)) return 413;
  if (
    [
      "CORE_UNAVAILABLE",
      "CAPABILITY_UNAVAILABLE",
      "VERSION_MISMATCH",
      "CORE_REQUEST_FAILED",
      "UNAUTHORIZED",
      "INVALID_RESPONSE",
      "INVALID_DISCOVERY",
      "DISCOVERY_OWNER_MISMATCH",
      "DISCOVERY_PERMISSION_INVALID",
      "UNAVAILABLE",
    ].includes(upper)
  )
    return 503;
  if (upper === "INTERNAL_ERROR") return 500;
  // 表に無いcodeでも、サーバー側の一時的な失敗を「要求の誤り」と読ませない（botが再送を諦めて失われる）。
  if (value.error.retryable === true) return 503;
  if (typeof value.error.status === "number" && value.error.status >= 500) return 500;
  return 422;
}

/** toolの結果から、structuredContent（なければtextをJSONとして読んだもの）を取り出す。 */
export function toolResultValue(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((part) => part.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
