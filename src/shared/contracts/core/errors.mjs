const UPDATE_ACTION = "TaskenとMCP bridgeを同じ最新版へ更新して再試行してください。";
const RESTART_ACTION = "Taskenを再起動してdiscovery情報を再生成してから再試行してください。";

const CORE_ERROR_GUIDANCE = Object.freeze({
  CORE_UNAVAILABLE: { retryable: true, next_action: "Taskenを起動してから再試行してください。" },
  CORE_REQUEST_FAILED: {
    retryable: true,
    next_action: "Taskenの状態を確認して再試行してください。",
  },
  INTERNAL_ERROR: { retryable: true, next_action: "Taskenを再起動してから再試行してください。" },
  CAPABILITY_UNAVAILABLE: { retryable: false, next_action: UPDATE_ACTION },
  VERSION_MISMATCH: { retryable: false, next_action: UPDATE_ACTION },
  VALIDATION_FAILED: { retryable: false, next_action: "入力内容を修正して再試行してください。" },
  INVALID_JSON: { retryable: false, next_action: "JSONを修正して再試行してください。" },
  BODY_TOO_LARGE: { retryable: false, next_action: "requestを小さくして再試行してください。" },
  UNSUPPORTED_MEDIA_TYPE: {
    retryable: false,
    next_action: "Content-Typeにapplication/jsonを指定してください。",
  },
  METHOD_NOT_ALLOWED: {
    retryable: false,
    next_action: "endpointで許可されたHTTP methodを使用してください。",
  },
  NOT_FOUND: { retryable: false, next_action: "endpointまたは対象IDを確認してください。" },
  IDEMPOTENCY_CONFLICT: {
    retryable: false,
    next_action: "内容を変える場合は新しいidempotency_keyを使用してください。",
  },
  CONFLICT: {
    retryable: false,
    next_action:
      "tasken.get_task_contextで対象を再取得し、最新versionでProposalを作り直してください。",
  },
  STALE_VERSION: {
    retryable: false,
    next_action:
      "tasken.get_task_contextで対象を再取得し、最新versionでProposalを作り直してください。",
  },
  PROPOSAL_TOO_LARGE: {
    retryable: false,
    next_action: "Proposalを64KiB未満の小さな単位に分割して再送してください。",
  },
  UNAUTHORIZED: { retryable: false, next_action: RESTART_ACTION },
  INVALID_DISCOVERY: { retryable: false, next_action: RESTART_ACTION },
  DISCOVERY_OWNER_MISMATCH: { retryable: false, next_action: RESTART_ACTION },
  DISCOVERY_PERMISSION_INVALID: { retryable: false, next_action: RESTART_ACTION },
});

const DEFAULT_GUIDANCE = Object.freeze({
  retryable: false,
  next_action: "Taskenの状態と入力内容を確認してください。",
});

/** Public AI-facing recovery guidance. Explicit HTTP fields remain lossless. */
export function taskenCoreErrorGuidance(code, explicit = {}) {
  const mapped = CORE_ERROR_GUIDANCE[String(code || "")] || DEFAULT_GUIDANCE;
  return {
    retryable: typeof explicit.retryable === "boolean" ? explicit.retryable : mapped.retryable,
    next_action:
      typeof explicit.next_action === "string" && explicit.next_action
        ? explicit.next_action
        : mapped.next_action,
  };
}

export function taskenCorePublicError(code, message, extra = {}) {
  const guidance = taskenCoreErrorGuidance(code, extra);
  return {
    code: String(code),
    message: String(message),
    retryable: guidance.retryable,
    ...(guidance.next_action ? { next_action: guidance.next_action } : {}),
    ...(extra.status === undefined ? {} : { status: extra.status }),
    ...(extra.details === undefined ? {} : { details: extra.details }),
  };
}
