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

export function focusSessionTaskId(record) {
  return isFocusSession(record) ? String(focusSessionProperties(record).task_id || "") : "";
}

export function findActiveFocusSession(records) {
  return records
    .filter(isActiveFocusSession)
    .sort((left, right) => (
      String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || ""))
      || String(left.id || "").localeCompare(String(right.id || ""))
    ))[0] || null;
}

export function focusSessionDraftKey(sessionId) {
  return `tasken:focus-session:draft:${sessionId}`;
}

export function focusDocumentDraftKey(noteId) {
  return `tasken:focus-session:document-draft:${noteId}`;
}
