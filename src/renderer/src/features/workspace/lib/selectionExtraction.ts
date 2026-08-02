import type { SaveOperation } from "../types";
import type { Note, Task } from "../domain-model/types";
import { buildSaveNoteOperations, buildSaveTaskOperations } from "../domain-model/persistence";
import { selectionExcerpt } from "../../../../../shared/selectionExtraction.mjs";

export {
  markdownHeadingBeforeOffset,
  selectionExcerpt,
  selectionTitleCandidate,
} from "../../../../../shared/selectionExtraction.mjs";

export type SelectionExtractionKind = "task" | "note";

export interface MarkdownTextSelection {
  text: string;
  heading?: string | null;
}

export interface SelectionExtractionSource {
  id: string;
  title: string;
  projectId?: string | null;
}

export interface SelectionExtractionDraft {
  kind: SelectionExtractionKind;
  title: string;
  selection: MarkdownTextSelection;
  source: SelectionExtractionSource;
}

export interface SelectionExtractionResult {
  entityType: SelectionExtractionKind;
  entity: Task | Note;
  operations: SaveOperation[];
}

export function buildSelectionExtractionOperations(
  draft: SelectionExtractionDraft,
  ids: { entityId: string; referenceId: string },
  now = new Date().toISOString(),
): SelectionExtractionResult {
  const title = draft.title.trim();
  const text = draft.selection.text.trim();
  if (!title) throw new Error("タイトルを入力してください。");
  if (!text) throw new Error("切り出す本文を選択してください。");

  const projectId = draft.source.projectId || null;
  const entity: Task | Note = draft.kind === "task"
    ? {
        id: ids.entityId,
        project_id: projectId,
        title,
        description: text,
        state: "todo",
        priority: "normal",
        created_at: now,
      }
    : {
        id: ids.entityId,
        project_id: projectId,
        title,
        body_markdown: text,
        note_type: "note",
        content_format: "markdown",
      };

  const entityOperations = draft.kind === "task"
    ? buildSaveTaskOperations(entity as Task, { now, reason: "extracted_from_note" })
    : buildSaveNoteOperations(entity as Note, { now, reason: "extracted_from_note" });

  return {
    entityType: draft.kind,
    entity,
    operations: [
      ...entityOperations,
      {
        action: "save",
        type: "reference",
        entity: {
          id: ids.referenceId,
          source_type: draft.kind,
          source_id: ids.entityId,
          target_type: "note",
          target_id: draft.source.id,
          relation_type: "derived_from",
          source_heading: draft.selection.heading || null,
          source_excerpt: selectionExcerpt(text),
          note: `「${draft.source.title}」の選択範囲から作成`,
        },
        options: { source: "manual", reason: "extracted_from_note" },
      },
    ],
  };
}
