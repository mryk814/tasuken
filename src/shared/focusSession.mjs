export const FOCUS_SESSION_ROLE = "focus_session";

export function focusSessionProperties(record) {
  const value = record?.properties_json;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function isFocusSession(record) {
  return focusSessionProperties(record).document_role === FOCUS_SESSION_ROLE;
}

export function isActiveFocusSession(record) {
  const properties = focusSessionProperties(record);
  return properties.document_role === FOCUS_SESSION_ROLE && properties.session_state === "active";
}

export function isPausedFocusSession(record) {
  return isActiveFocusSession(record) && Boolean(focusSessionProperties(record).paused_at);
}

function timestamp(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
}

function pausedMs(properties) {
  const value = Number(properties.paused_ms);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 開始から`now`までの作業時間（ミリ秒）。一時停止していた時間と、
 * 停止中なら停止した時点から`now`までを除く。終了済みなら`ended_at`で止める。
 */
export function focusSessionElapsedMs(record, now) {
  const properties = focusSessionProperties(record);
  const started = timestamp(properties.started_at) ?? timestamp(record?.created_at);
  if (started === null) return 0;
  const end = timestamp(properties.ended_at) ?? now;
  const pausedAt = timestamp(properties.paused_at);
  const currentPause = pausedAt !== null ? Math.max(0, end - pausedAt) : 0;
  return Math.max(0, end - started - pausedMs(properties) - currentPause);
}

/** 一時停止する。すでに停止中なら同じpropertiesを返す。 */
export function pauseFocusSessionProperties(properties, at) {
  if (properties.paused_at) return properties;
  return { ...properties, paused_at: at };
}

/** 再開する。停止していた時間を`paused_ms`へ足し、`paused_at`を消す。 */
export function resumeFocusSessionProperties(properties, at) {
  const pausedAt = timestamp(properties.paused_at);
  const resumed = timestamp(at);
  if (pausedAt === null || resumed === null) return { ...properties, paused_at: null };
  return {
    ...properties,
    paused_at: null,
    paused_ms: pausedMs(properties) + Math.max(0, resumed - pausedAt),
  };
}

export function focusSessionTaskId(record) {
  return isFocusSession(record) ? String(focusSessionProperties(record).task_id || "") : "";
}

export function findActiveFocusSession(records) {
  return (
    records
      .filter(isActiveFocusSession)
      .sort(
        (left, right) =>
          String(right.updated_at || right.created_at || "").localeCompare(
            String(left.updated_at || left.created_at || ""),
          ) || String(left.id || "").localeCompare(String(right.id || "")),
      )[0] || null
  );
}

export function focusSessionDraftKey(sessionId) {
  return `tasken:focus-session:draft:${sessionId}`;
}

export function focusDocumentDraftKey(noteId) {
  return `tasken:focus-session:document-draft:${noteId}`;
}
