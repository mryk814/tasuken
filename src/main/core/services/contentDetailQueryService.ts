import { projectEntityForAi } from "../../../shared/aiMetadata.mjs";
import {
  publicArtifactMetadata,
  safeExternalUrl,
  taskContextLimits,
  TaskContextTextBudget,
} from "../../../shared/taskContext.mjs";
import type {
  GetArtifactMetadataRequest,
  GetArtifactMetadataResponse,
  GetConversationRequest,
  GetConversationResponse,
  GetNoteRequest,
  GetNoteResponse,
} from "../../../shared/contracts/task/contentDetailQueries.ts";
import type { AiAudience } from "../../../shared/aiMetadata.mjs";
import type { ContentDetailReadPort, ContentDetailRecord } from "../ports/contentDetailReadPort.ts";

const AUDIENCE = "coding_agent" as const;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function truncate(value: unknown, limit: number) {
  const raw = text(value);
  return raw.length <= limit ? raw : `${raw.slice(0, limit)}...`;
}

function notFound(codeField: string, id: string, label: string) {
  return {
    error: {
      code: "not_found" as const,
      message: `${label}が見つかりません。IDまたはAI公開範囲を確認してください。`,
      [codeField]: id,
    },
    read_only: true as const,
    ai_audience: AUDIENCE,
  };
}

function visibility(
  type: "note" | "resource" | "artifact",
  record: ContentDetailRecord,
  themes: ContentDetailRecord[],
  workspaceDefault: AiAudience[],
) {
  const themeId = record.project_id || record.theme_id || null;
  const theme = themes.find((candidate) => String(candidate.id) === String(themeId)) || null;
  return projectEntityForAi(type, record, {
    audience: AUDIENCE,
    theme,
    workspaceDefault,
  });
}

function visibleRecord(
  type: "note" | "resource" | "artifact",
  record: ContentDetailRecord | undefined,
  themes: ContentDetailRecord[],
  workspaceDefault: AiAudience[],
): { record: ContentDetailRecord | null } {
  if (!record) return { record: null };
  const result = visibility(type, record, themes, workspaceDefault);
  return result.included
    ? { record: { ...record, ai: result.header } as ContentDetailRecord }
    : { record: null };
}

/**
 * Pure Core projection for the stable-locator content detail tools.
 * The source is deliberately a narrow read port; no MCP, Electron, or SQLite
 * dependency is allowed here.
 */
export class ContentDetailQueryService {
  constructor(private readonly port: ContentDetailReadPort) {}

  getNote(args: GetNoteRequest): GetNoteResponse {
    const noteId = text(args.note_id).trim();
    const includeArchived = Boolean(args.include_archived);
    const themes = this.port.list("theme", true);
    const notes = this.port.list("note", includeArchived);
    const candidate = notes.find((record) => String(record.id) === noteId);
    const filtered = visibleRecord("note", candidate, themes, this.port.workspaceAiVisibilityDefault());
    if (!filtered.record) return notFound("note_id", noteId, "Note");

    const maxTextLength = taskContextLimits(args).maxTextLength;
    const body = text(filtered.record.body_markdown);
    const budget = new TaskContextTextBudget(maxTextLength);
    return {
      note: {
        id: filtered.record.id,
        title: filtered.record.title,
        note_type: filtered.record.note_type || "note",
        project_id: filtered.record.project_id || filtered.record.theme_id || null,
        body_markdown: budget.take(body),
        version: Number(filtered.record.version || 0),
        created_at: filtered.record.created_at || null,
        updated_at: filtered.record.updated_at || null,
      },
      truncated: body.length > maxTextLength,
      limits: { max_text_length: maxTextLength },
      read_only: true,
      ai_audience: AUDIENCE,
    };
  }

  getConversation(args: GetConversationRequest): GetConversationResponse {
    const conversationId = text(args.conversation_id).trim();
    const includeArchived = Boolean(args.include_archived);
    const themes = this.port.list("theme", true);
    const resources = this.port.list("resource", includeArchived);
    const candidate = resources.find((record) => String(record.id) === conversationId && record.resource_scope === "chat_ref");
    const filtered = visibleRecord("resource", candidate, themes, this.port.workspaceAiVisibilityDefault());
    if (!filtered.record) return notFound("conversation_id", conversationId, "Conversation");

    const maxTextLength = taskContextLimits(args).maxTextLength;
    const body = text(filtered.record.body_markdown);
    const budget = new TaskContextTextBudget(maxTextLength);
    return {
      conversation: {
        id: filtered.record.id,
        title: filtered.record.title,
        description: truncate(filtered.record.description, 2_000),
        source_url: safeExternalUrl(filtered.record.url),
        body_markdown: budget.take(body),
        // Preserve the legacy 0 -> null behavior for old Chat Ref rows.
        message_count: filtered.record.message_count || null,
        source_format: filtered.record.source_format || null,
        version: Number(filtered.record.version || 0),
        created_at: filtered.record.created_at || null,
        updated_at: filtered.record.updated_at || null,
      },
      truncated: body.length > maxTextLength,
      limits: { max_text_length: maxTextLength },
      read_only: true,
      ai_audience: AUDIENCE,
    };
  }

  getArtifactMetadata(args: GetArtifactMetadataRequest): GetArtifactMetadataResponse {
    const artifactId = text(args.artifact_id).trim();
    const includeArchived = Boolean(args.include_archived);
    const themes = this.port.list("theme", true);
    const artifacts = this.port.list("artifact", includeArchived);
    const candidate = artifacts.find((record) => String(record.id) === artifactId);
    const filtered = visibleRecord("artifact", candidate, themes, this.port.workspaceAiVisibilityDefault());
    if (!filtered.record) return notFound("artifact_id", artifactId, "Artifact");

    const budget = new TaskContextTextBudget(taskContextLimits(args).maxTextLength);
    return {
      artifact: publicArtifactMetadata(filtered.record, budget),
      external_file_content_included: false,
      read_only: true,
      ai_audience: AUDIENCE,
    };
  }
}
