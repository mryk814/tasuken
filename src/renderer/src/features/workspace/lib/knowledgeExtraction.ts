import { str } from "./format";

export const KNOWLEDGE_DIRECT_BODY_LIMIT = 20000;

export type KnowledgeDraftBodyMode = "source" | "empty";
export type KnowledgeSourceNote = {
  id: string;
  title?: unknown;
  body_markdown?: unknown;
  theme_id?: string | null;
  project_id?: string | null;
};

export function isLongKnowledgeSource(body: unknown, limit = KNOWLEDGE_DIRECT_BODY_LIMIT): boolean {
  return str(body).length > limit;
}

export function buildKnowledgeNodeDraftFromNote(
  note: KnowledgeSourceNote,
  options: { bodyMode?: KnowledgeDraftBodyMode } = {},
) {
  const bodyMode = options.bodyMode || "source";
  return {
    node_type: "claim",
    title: str(note.title) || "無題",
    body: bodyMode === "empty" ? "" : str(note.body_markdown),
    theme_id: note.theme_id || note.project_id || null,
    source_type: "note",
    source_id: note.id,
    source_note_id: note.id,
    confidence: "medium",
    status: "active",
  };
}
