import { AiCreationMark } from "./AiCreationMark";
import { formatArtifactFileSize } from "./artifacts";
import type { OpenContentViewer, RemoveEntity, TaskDocument, WorkspaceData } from "../types";
import { str } from "../lib/format";

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
          <div className="task-document-item" key={document.id}>
            <div className="task-document-main">
              <strong>{document.title}</strong>
              <AiCreationMark entity={document} detail type="document" />
            </div>
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
        ))}
      </div>
    </section>
  );
}
