/**
 * Activity canonical refs use stable root identities rather than absolute paths.
 * The path map is a Main/MCP-internal value; projections must use
 * publicActivityRootStatus instead.
 */

function text(value) {
  return value == null ? "" : String(value).trim();
}
export const ACTIVITY_SYNC_ROOT_ID = "sync";
export const ACTIVITY_ARTIFACT_ROOT_ID = "artifact-directory";

export function buildActivityRootRegistry({ artifactDirectory = "", themes = [] } = {}) {
  const roots = {};
  const common = text(artifactDirectory);
  if (common) {
    // Keep the aliases used by existing AI/source contracts addressable while
    // the canonical identity remains the stable storage_root_id in the event.
    roots[ACTIVITY_SYNC_ROOT_ID] = common;
    roots[ACTIVITY_ARTIFACT_ROOT_ID] = common;
    roots["tasken-sync"] = common;
  }
  for (const theme of Array.isArray(themes) ? themes : []) {
    const id = text(theme?.id);
    if (!id) continue;
    const root = text(theme?.storage_root) || common;
    if (!root) continue;
    roots[id] = root;
    roots[`theme:${id}`] = root;
  }
  return roots;
}

export function publicActivityRootStatus(registry = {}, exists = () => true) {
  return Object.fromEntries(Object.entries(registry).map(([id, root]) => {
    let available = false;
    try {
      available = Boolean(exists(root));
    } catch {
      available = false;
    }
    return [id, { status: available ? "ok" : "broken" }];
  }));
}
