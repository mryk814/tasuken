import { projectEntityForAi } from "../../../shared/aiMetadata.mjs";
import { buildNoteAiHistory, markdownHeadingAt } from "../../../shared/noteAiConversation.mjs";
import { markdownSignature } from "../../../shared/canonicalMarkdown.mjs";

export const NOTE_AI_CONTEXT_CONFIRMATION = "note-ai-context-confirmed/v1";
export const NOTE_AI_HISTORY_MAX_TURNS = 12;
export const NOTE_AI_HISTORY_MAX_TEXT = 24_000;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requireVisible(type, entity, theme, workspaceDefault) {
  if (!entity) throw new Error(`${type}が見つかりません。再読み込みしてください。`);
  const projection = projectEntityForAi(type, entity, {
    audience: "external_ai",
    theme,
    workspaceDefault,
  });
  if (!projection.included || !projection.header) {
    throw new Error(`${type}は外部AIへの公開範囲に含まれていません。AI Context設定を確認してください。`);
  }
  return projection.header;
}

function boundedHistory(note, proposals) {
  const entries = buildNoteAiHistory(note, proposals).slice(-NOTE_AI_HISTORY_MAX_TURNS);
  const result = [];
  let remaining = NOTE_AI_HISTORY_MAX_TEXT;
  for (const entry of entries) {
    for (const [role, value] of [["user", entry.prompt], ["assistant", entry.response]]) {
      if (!value || remaining <= 0) continue;
      const text = String(value).slice(0, Math.min(4_000, remaining));
      if (!text) continue;
      result.push({ role, text });
      remaining -= text.length;
    }
  }
  return result;
}

/** Renderer本文を捨て、Mainの正本とAI visibilityからprovider送信内容を再構成する。 */
export function authorizeNoteAiRequest(repository, requestValue) {
  const request = record(requestValue);
  const context = record(request.context);
  if (request.confirmationToken !== NOTE_AI_CONTEXT_CONFIRMATION) {
    throw new Error("外部AIへ送るContextの明示確認がありません。内容を確認して再送してください。");
  }
  const noteId = typeof request.noteId === "string" ? request.noteId.trim() : "";
  if (!noteId) throw new Error("Note IDがありません。再読み込みしてください。");
  const note = repository.get("note", noteId);
  if (!note) throw new Error("Noteが見つかりません。再読み込みしてください。");
  if (!Number.isInteger(request.baseRevision) || Number(note.version || 0) !== request.baseRevision) {
    throw new Error("Noteが更新済みです。送信内容を確認し直してください。");
  }
  const themeId = String(note.project_id || note.theme_id || "");
  const theme = themeId ? repository.get("theme", themeId) || repository.get("project", themeId) : null;
  const workspaceDefault = repository.getPreference("aiVisibilityDefault");
  const selection = record(request.selection);
  const body = String(note.body_markdown || "");
  if (typeof request.expectedBodySignature !== "string" || request.expectedBodySignature !== markdownSignature(body)) {
    throw new Error("Note本文が未保存または更新済みです。保存完了後にContextを確認し直してください。");
  }
  const needsNote = Boolean(context.includeTitle || context.includeBody || context.includeSelection || context.includeHeading || context.includeHistory);
  if (needsNote) requireVisible("note", note, theme, workspaceDefault);

  let authorizedSelection;
  if (request.scope === "selection") {
    const start = Number(selection.start);
    const end = Number(selection.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > body.length) {
      throw new Error("選択範囲が正本Noteと一致しません。選び直してください。");
    }
    authorizedSelection = { start, end, text: body.slice(start, end) };
  }

  let authorizedTheme;
  const requestedTheme = record(context.theme);
  if (requestedTheme.id) {
    if (!theme || requestedTheme.id !== themeId) throw new Error("ThemeがNoteの所属先と一致しません。");
    const header = requireVisible("theme", theme, theme, workspaceDefault);
    authorizedTheme = { id: header.id, title: header.title || "Theme", summary: header.summary || "説明なし" };
  }

  let authorizedResource;
  const requestedResource = record(context.resource);
  if (requestedResource.id) {
    const resource = repository.get("resource", String(requestedResource.id));
    if (!resource || String(resource.project_id || resource.theme_id || "") !== themeId) {
      throw new Error("ResourceがNoteと同じThemeにありません。");
    }
    const header = requireVisible("resource", resource, theme, workspaceDefault);
    authorizedResource = { id: header.id, title: header.title || "Resource", summary: header.summary || "説明なし" };
  }

  const anchor = authorizedSelection?.start ?? Math.max(0, Math.min(body.length, Number(request.anchorOffset) || body.length));
  const heading = context.includeHeading ? markdownHeadingAt(body, anchor) : "";
  return {
    noteId,
    baseRevision: Number(note.version || 0),
    expectedBodySignature: markdownSignature(body),
    confirmationToken: NOTE_AI_CONTEXT_CONFIRMATION,
    anchorOffset: anchor,
    scope: request.scope === "selection" ? "selection" : "document",
    title: String(note.title || ""),
    body,
    instruction: typeof request.instruction === "string" ? request.instruction : "",
    ...(authorizedSelection ? { selection: authorizedSelection } : { selection: undefined }),
    context: {
      includeTitle: context.includeTitle === true,
      includeBody: context.includeBody === true,
      includeSelection: context.includeSelection === true,
      includeHeading: context.includeHeading === true,
      includeHistory: context.includeHistory === true,
      ...(heading ? { heading } : {}),
      ...(authorizedTheme ? { theme: authorizedTheme } : {}),
      ...(authorizedResource ? { resource: authorizedResource } : {}),
    },
    history: context.includeHistory ? boundedHistory(note, repository.list("ai_proposal", true)) : [],
  };
}
