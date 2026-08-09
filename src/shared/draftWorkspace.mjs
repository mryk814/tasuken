const MAX_SOURCE_DRAFTS = 12;
const MAX_SNAPSHOTS = 20;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeDraftWorkspace(value) {
  const workspace = objectValue(value);
  const sources = Array.isArray(workspace.sources)
    ? workspace.sources
      .filter((source) => source && typeof source === "object" && stringValue(source.id) && stringValue(source.body))
      .map((source) => ({
        id: stringValue(source.id),
        body: stringValue(source.body),
        created_at: stringValue(source.created_at),
        ai_service: stringValue(source.ai_service),
        chat_url: stringValue(source.chat_url),
        instruction: stringValue(source.instruction),
      }))
      .slice(-MAX_SOURCE_DRAFTS)
    : [];
  const snapshots = Array.isArray(workspace.snapshots)
    ? workspace.snapshots
      .filter((snapshot) => snapshot && typeof snapshot === "object" && stringValue(snapshot.id))
      .map((snapshot) => ({
        id: stringValue(snapshot.id),
        label: stringValue(snapshot.label) || "スナップショット",
        body: stringValue(snapshot.body),
        created_at: stringValue(snapshot.created_at),
      }))
      .slice(-MAX_SNAPSHOTS)
    : [];
  const requestedActiveId = stringValue(workspace.active_source_id);
  return {
    version: 1,
    active_source_id: sources.some((source) => source.id === requestedActiveId)
      ? requestedActiveId
      : sources.at(-1)?.id || "",
    sources,
    snapshots,
    working_updated_at: stringValue(workspace.working_updated_at),
  };
}

export function addSourceDraft(workspaceValue, source) {
  const workspace = normalizeDraftWorkspace(workspaceValue);
  const nextSource = {
    id: stringValue(source.id),
    body: stringValue(source.body),
    created_at: stringValue(source.created_at),
    ai_service: stringValue(source.ai_service),
    chat_url: stringValue(source.chat_url),
    instruction: stringValue(source.instruction),
  };
  return {
    ...workspace,
    active_source_id: nextSource.id,
    sources: [...workspace.sources, nextSource].slice(-MAX_SOURCE_DRAFTS),
  };
}

export function addDraftSnapshot(workspaceValue, snapshot) {
  const workspace = normalizeDraftWorkspace(workspaceValue);
  return {
    ...workspace,
    snapshots: [...workspace.snapshots, {
      id: stringValue(snapshot.id),
      label: stringValue(snapshot.label) || "スナップショット",
      body: stringValue(snapshot.body),
      created_at: stringValue(snapshot.created_at),
    }].slice(-MAX_SNAPSHOTS),
  };
}

export function buildDraftRerequest({ title, workingBody, source, request }) {
  const instruction = stringValue(source?.instruction).trim();
  return [
    `# 再依頼: ${stringValue(title) || "Markdown文書"}`,
    "",
    instruction ? `## 元の指示\n\n${instruction}` : "",
    "## 現在のWorking Draft",
    "",
    stringValue(workingBody),
    "",
    "## 今回の依頼",
    "",
    stringValue(request).trim() || "内容を確認し、修正版のMarkdownだけを返してください。",
  ].filter((part) => part !== "").join("\n");
}
