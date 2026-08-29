import { projectEntityForAi } from "../../../shared/aiMetadata.mjs";
import { noteProjectId } from "../../../shared/themeRef.mjs";
import {
  publicArtifactMetadata,
  safeExternalUrl,
  taskContextLimits,
  TaskContextTextBudget,
} from "../../../shared/taskContext.mjs";
import {
  getArtifactMetadataRequestSchema,
  getConversationRequestSchema,
  getNoteRequestSchema,
  type GetArtifactMetadataRequest,
  type GetArtifactMetadataResponse,
  type GetConversationRequest,
  type GetConversationResponse,
  type GetNoteRequest,
  type GetNoteResponse,
} from "../../../shared/contracts/task/public.ts";
import type { AiAudience } from "../../../shared/aiMetadata.mjs";
import type { ContentDetailReadPort, ContentDetailRecord } from "../ports/contentDetailReadPort.ts";

const AUDIENCE = "coding_agent" as const;

const TASK_CONTEXT_GUIDANCE = {
  tool: "tasken.get_task_context",
  description: "関連Taskのbounded contextを再取得する。",
};
const SEARCH_GUIDANCE = [
  {
    tool: "tasken.search_items",
    description: "stable IDが不明な場合にAI公開対象を検索し直す。",
  },
];

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
    next_tools: SEARCH_GUIDANCE,
  };
}

function visibility(
  type: "note" | "resource" | "artifact",
  record: ContentDetailRecord,
  themes: ContentDetailRecord[],
  workspaceDefault: AiAudience[],
) {
  const themeId =
    type === "note" ? noteProjectId(record) : record.project_id || record.theme_id || null;
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
    const request = getNoteRequestSchema.parse(args);
    const noteId = request.note_id;
    const includeArchived = Boolean(request.include_archived);
    const themes = this.port.list("theme", true);
    const notes = this.port.list("note", includeArchived);
    const candidate = notes.find((record) => String(record.id) === noteId);
    const filtered = visibleRecord(
      "note",
      candidate,
      themes,
      this.port.workspaceAiVisibilityDefault(),
    );
    if (!filtered.record) return notFound("note_id", noteId, "Note");

    const maxTextLength = taskContextLimits(request).maxTextLength;
    const body = text(filtered.record.body_markdown);
    const budget = new TaskContextTextBudget(maxTextLength);
    return {
      note: {
        id: filtered.record.id,
        title: filtered.record.title,
        note_type: filtered.record.note_type || "note",
        project_id: noteProjectId(filtered.record),
        body_markdown: budget.take(body),
        version: Number(filtered.record.version || 0),
        created_at: filtered.record.created_at || null,
        updated_at: filtered.record.updated_at || null,
      },
      truncated: body.length > maxTextLength,
      limits: { max_text_length: maxTextLength },
      read_only: true,
      ai_audience: AUDIENCE,
      next_tools: [
        TASK_CONTEXT_GUIDANCE,
        {
          tool: "tasken.propose_note_edit",
          description:
            "書き換えが必要なら、Proposal toolが利用可能な場合だけ利用者レビュー用の編集案をqueueする。",
        },
      ],
    };
  }

  getConversation(args: GetConversationRequest): GetConversationResponse {
    const request = getConversationRequestSchema.parse(args);
    const conversationId = request.conversation_id;
    const includeArchived = Boolean(request.include_archived);
    const themes = this.port.list("theme", true);
    const resources = this.port.list("resource", includeArchived);
    const candidate = resources.find(
      (record) => String(record.id) === conversationId && record.resource_scope === "chat_ref",
    );
    const filtered = visibleRecord(
      "resource",
      candidate,
      themes,
      this.port.workspaceAiVisibilityDefault(),
    );
    if (!filtered.record) return notFound("conversation_id", conversationId, "Conversation");

    const maxTextLength = taskContextLimits(request).maxTextLength;
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
      next_tools: [
        TASK_CONTEXT_GUIDANCE,
        {
          tool: "tasken.propose_note",
          description:
            "会話から記録を残すなら、Proposal toolが利用可能な場合だけ利用者レビュー用Note案をqueueする。",
        },
      ],
    };
  }

  getArtifactMetadata(args: GetArtifactMetadataRequest): GetArtifactMetadataResponse {
    const request = getArtifactMetadataRequestSchema.parse(args);
    const artifactId = request.artifact_id;
    const includeArchived = Boolean(request.include_archived);
    const themes = this.port.list("theme", true);
    const artifacts = this.port.list("artifact", includeArchived);
    const candidate = artifacts.find((record) => String(record.id) === artifactId);
    const filtered = visibleRecord(
      "artifact",
      candidate,
      themes,
      this.port.workspaceAiVisibilityDefault(),
    );
    if (!filtered.record) return notFound("artifact_id", artifactId, "Artifact");

    const budget = new TaskContextTextBudget(taskContextLimits(request).maxTextLength);
    return {
      artifact: publicArtifactMetadata(filtered.record, budget),
      external_file_content_included: false,
      read_only: true,
      ai_audience: AUDIENCE,
      next_tools: [
        TASK_CONTEXT_GUIDANCE,
        ...(filtered.record.origin_note_id
          ? [
              {
                tool: "tasken.get_note",
                description: `origin Note ${filtered.record.origin_note_id} の本文を読む。`,
              },
            ]
          : []),
      ],
    };
  }
}
