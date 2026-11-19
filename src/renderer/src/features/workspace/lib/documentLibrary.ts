import type { BaseRecord, TaskDocument } from "../types";
import { str } from "./format";

export interface DocumentLibraryEntry {
  document: TaskDocument;
  /** 属するタスクのタイトル。タスクが引けないときは null。 */
  taskTitle: string | null;
  /** task_id はあるのにタスクが見つからない（削除済み等）とき true。 */
  taskMissing: boolean;
}

export interface DocumentLibraryFilter {
  /** 検索文字列（NotesPage の検索欄と同じ入力）。前後の空白と大小は無視する。 */
  query?: string;
  /**
   * NotesPage の Theme 絞り込みと同じ意味。
   * "all" は全て、"" は Theme 未設定のみ、それ以外は theme_id の一致。
   */
  themeId?: string;
}

/**
 * ノートの場所（NotesPage）にタスク横断で文書を並べるための一覧を作る（#799）。
 * 文書の Entity は WorkspaceData に全件入っているので、ここは並びと絞り込みだけを持つ。
 * 絞り込みは NotesPage の Note 一覧と同じ入力（検索・Theme）に揃え、並びは
 * タスク詳細の文書セクションと同じ「新しい順」にする。
 */
export function buildDocumentLibraryEntries(
  documents: readonly TaskDocument[] | undefined,
  tasks: readonly BaseRecord[] | undefined,
  filter: DocumentLibraryFilter = {},
): DocumentLibraryEntry[] {
  const taskById = new Map((tasks || []).map((task) => [task.id, task]));
  const query = (filter.query || "").trim().toLocaleLowerCase();
  const themeId = filter.themeId;
  return (documents || [])
    .map((document) => {
      const task = document.task_id ? taskById.get(document.task_id) : undefined;
      return {
        document,
        taskTitle: task ? str(task.title) || null : null,
        taskMissing: Boolean(document.task_id) && !task,
      };
    })
    .filter((entry) => {
      if (themeId === "") {
        if (str(entry.document.theme_id)) return false;
      } else if (themeId !== undefined && themeId !== "all") {
        if (str(entry.document.theme_id) !== themeId) return false;
      }
      if (query) {
        const haystack =
          `${entry.document.title} ${str(entry.document.filename)} ${entry.taskTitle || ""}`.toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const byCreated = str(b.document.created_at || b.document.updated_at).localeCompare(
        str(a.document.created_at || a.document.updated_at),
      );
      return byCreated !== 0 ? byCreated : a.document.id.localeCompare(b.document.id);
    });
}
