/**
 * Canonical Note ownership is project_id. theme_id is read only for legacy rows
 * that have not passed through the workspace migration yet.
 */
export function noteProjectId(note) {
  if (!note || typeof note !== "object") return null;
  const value = Object.prototype.hasOwnProperty.call(note, "project_id")
    ? note.project_id
    : note.theme_id;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
