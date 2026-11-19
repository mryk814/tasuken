import { AiCreationMark } from "./AiCreationMark";
import { formatArtifactFileSize } from "./artifacts";
import type { DocumentLibraryEntry } from "../lib/documentLibrary";
import type { OpenContentViewer, RemoveEntity, TaskDocument, WorkspaceData } from "../types";
import { str } from "../lib/format";

function DocumentItem({
  document,
  openContentViewer,
  removeEntity,
  taskTitle,
  taskMissing = false,
  onOpenTask,
}: {
  document: TaskDocument;
  openContentViewer?: OpenContentViewer;
  removeEntity: RemoveEntity;
  taskTitle?: string | null;
  taskMissing?: boolean;
  onOpenTask?: () => void;
}) {
  return (
    <div className="task-document-item">
      <div className="task-document-main">
        <strong>{document.title}</strong>
        <AiCreationMark entity={document} detail type="document" />
      </div>
      {taskTitle ? (
        <button
          type="button"
          className="text-button compact task-document-task"
          onClick={onOpenTask}
        >
          タスク：{taskTitle}
        </button>
      ) : taskMissing ? (
        <span className="task-document-task-missing">タスク：削除済み</span>
      ) : null}
      <span className="task-document-meta">
        {str(document.filename)}
        {typeof document.file_size === "number" && document.file_size > 0
          ? ` · ${formatArtifactFileSize(document.file_size)}`
          : ""}
      </span>
      <div className="task-document-actions">
        <button
          type="button"
          className="text-button compact"
          onClick={() => openContentViewer?.({ type: "document", documentId: document.id })}
        >
          開く
        </button>
        <button
          type="button"
          className="text-button compact"
          onClick={() => void removeEntity("document", document)}
        >
          削除
        </button>
      </div>
    </div>
  );
}

/**
 * Task配下のDocument（HTML文書、#789）の一覧。Noteと同列のコンテンツとして
 * タスク詳細に並べる。追加はAIの直接作成だけ（編集UIは無い。改訂は再作成、
 * 削除は本人がここから）。表示はWeb Artifactと共通の隔離Previewを使う。
 */
export function DocumentSection({
  taskId,
  data,
  openContentViewer,
  removeEntity,
}: {
  taskId: string;
  data: WorkspaceData;
  openContentViewer?: OpenContentViewer;
  removeEntity: RemoveEntity;
}) {
  const documents = (data.documents || [])
    .filter((entry) => entry.task_id === taskId)
    .sort((a, b) =>
      str(b.created_at || b.updated_at).localeCompare(str(a.created_at || a.updated_at)),
    );
  if (!documents.length) return null;
  return (
    <section className="task-document-section">
      <div className="section-heading">
        <h3>文書</h3>
      </div>
      <div className="task-document-list">
        {documents.map((document: TaskDocument) => (
          <DocumentItem
            key={document.id}
            document={document}
            openContentViewer={openContentViewer}
            removeEntity={removeEntity}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * ノートの場所（NotesPage）に出す、タスク横断の文書一覧（#799）。
 * MCPで作らせた文書をタスクを開かずに見つけられるよう、一覧の冒頭に区分して並べる。
 * 各行に属するタスクを出し、タスク名からそのタスクを開ける。
 */
export function DocumentLibrarySection({
  entries,
  openContentViewer,
  removeEntity,
  onOpenTask,
}: {
  entries: DocumentLibraryEntry[];
  openContentViewer?: OpenContentViewer;
  removeEntity: RemoveEntity;
  onOpenTask?: (taskId: string) => void;
}) {
  if (!entries.length) return null;
  return (
    <section className="task-document-section task-document-section--in-notes" aria-label="文書">
      <div className="section-heading">
        <h3>文書</h3>
      </div>
      <div className="task-document-list">
        {entries.map((entry) => {
          const taskId = entry.document.task_id;
          return (
            <DocumentItem
              key={entry.document.id}
              document={entry.document}
              openContentViewer={openContentViewer}
              removeEntity={removeEntity}
              taskTitle={entry.taskTitle}
              taskMissing={entry.taskMissing}
              onOpenTask={taskId && onOpenTask ? () => onOpenTask(taskId) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
