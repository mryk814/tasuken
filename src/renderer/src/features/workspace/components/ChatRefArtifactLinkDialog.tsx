import { useMemo, useState } from "react";
import { IconFileTypePdf, IconLink, IconMarkdown } from "@tabler/icons-react";

import type { BaseRecord, SaveEntities, WorkspaceData } from "../types";
import { str } from "../lib/format";
import {
  buildNoteExportArtifactOperation,
  listRecentNoteExports,
  rankChatRefsForNote,
  type NoteDocumentExport,
  type ChatRefRecord,
} from "../lib/noteExportArtifacts";

function exportLabel(entry: NoteDocumentExport): string {
  const format = entry.format === "pdf" ? "PDF" : "Markdown";
  const date = entry.exportedAt ? new Date(entry.exportedAt).toLocaleString("ja-JP") : "";
  return `${entry.noteTitle} · ${format}${date ? ` · ${date}` : ""}`;
}

export function ChatRefArtifactLinkDialog({
  data,
  initialChatRefId,
  initialExport,
  saveEntities,
  setToast,
  onLinked,
  close,
}: {
  data: WorkspaceData;
  initialChatRefId?: string;
  initialExport?: NoteDocumentExport;
  saveEntities: SaveEntities;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  onLinked?: (chatRefId: string) => void;
  close: () => void;
}) {
  const notes = data.notes as BaseRecord[];
  const resources = data.resources as unknown as ChatRefRecord[];
  const exports = useMemo(() => {
    const recent = listRecentNoteExports(notes);
    if (!initialExport) return recent;
    return [
      initialExport,
      ...recent.filter((entry) => (
        entry.noteId !== initialExport.noteId
        || entry.filePath.toLocaleLowerCase() !== initialExport.filePath.toLocaleLowerCase()
      )),
    ];
  }, [initialExport, notes]);
  const [selectedExportId, setSelectedExportId] = useState(initialExport?.id || exports[0]?.id || "");
  const selectedExport = exports.find((entry) => entry.id === selectedExportId) || exports[0] || null;
  const selectedNote = notes.find((note) => note.id === selectedExport?.noteId) || null;
  const rankedResources = useMemo(
    () => selectedNote
      ? rankChatRefsForNote(resources, selectedNote, data.artifacts)
      : resources,
    [data.artifacts, resources, selectedNote],
  );
  const [selectedChatRefId, setSelectedChatRefId] = useState(initialChatRefId || rankedResources[0]?.id || "");
  const [query, setQuery] = useState("");
  const visibleResources = rankedResources.filter((resource) => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return true;
    return `${str(resource.title)} ${str(resource.url)} ${str(resource.chat_group)}`
      .toLocaleLowerCase()
      .includes(normalized);
  });
  const selectedChatRef = rankedResources.find((resource) => resource.id === selectedChatRefId) || null;
  const fixedExport = Boolean(initialExport);
  const fixedChatRef = Boolean(initialChatRefId);

  async function linkArtifact() {
    if (!selectedExport || !selectedChatRef) {
      setToast("書き出しファイルとチャット参照を選択してください。", "warning");
      return;
    }
    const { operation, reused } = buildNoteExportArtifactOperation({
      exported: selectedExport,
      chatRef: selectedChatRef,
      artifacts: data.artifacts,
    });
    try {
      await saveEntities(
        [operation],
        reused ? "既存Artifactの書き出し情報を更新しました。" : "書き出しファイルをチャット参照へ紐づけました。",
      );
      onLinked?.(selectedChatRef.id);
      close();
    } catch (error) {
      setToast(`チャット参照へ紐づけられませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="modal-card chat-ref-artifact-link-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-ref-artifact-title">
        <header className="modal-card-header">
          <div>
            <h2 id="chat-ref-artifact-title">書き出しをChat Refへ紐づける</h2>
            <p>Noteは編集元、Artifactは書き出したファイルとして区別したまま関連付けます。</p>
          </div>
          <button type="button" className="text-button compact" onClick={close}>閉じる</button>
        </header>

        <div className="chat-ref-artifact-fields">
          <section>
            <h3>書き出しファイル</h3>
            {exports.length ? (
              <div className="chat-ref-artifact-options" role="radiogroup" aria-label="書き出しファイル">
                {(fixedExport ? exports.slice(0, 1) : exports).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={entry.id === selectedExport?.id}
                    className={entry.id === selectedExport?.id ? "is-selected" : ""}
                    onClick={() => setSelectedExportId(entry.id)}
                  >
                    {entry.format === "pdf" ? <IconFileTypePdf size={17} /> : <IconMarkdown size={17} />}
                    <span><strong>{exportLabel(entry)}</strong><small title={entry.filePath}>{entry.filePath}</small></span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state-inline">先にNoteをMarkdownまたはPDFで書き出してください。</p>
            )}
          </section>

          <section>
            <h3>Chat Ref</h3>
            {!fixedChatRef && (
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="タイトル・URL・グループで検索"
                aria-label="Chat Refを検索"
              />
            )}
            {rankedResources.length ? (
              <div className="chat-ref-artifact-options" role="radiogroup" aria-label="Chat Ref">
                {(fixedChatRef ? rankedResources.filter((entry) => entry.id === initialChatRefId) : visibleResources).map((resource) => (
                  <button
                    key={resource.id}
                    type="button"
                    role="radio"
                    aria-checked={resource.id === selectedChatRefId}
                    className={resource.id === selectedChatRefId ? "is-selected" : ""}
                    onClick={() => setSelectedChatRefId(resource.id)}
                  >
                    <IconLink size={17} />
                    <span><strong>{str(resource.title) || "無題のChat Ref"}</strong><small>{str(resource.chat_group) || str(resource.url)}</small></span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state-inline">紐づけられるChat Refがありません。先にChat RefsへURLを追加してください。</p>
            )}
          </section>
        </div>

        <footer className="modal-actions">
          <button type="button" className="secondary-button" onClick={close}>取消</button>
          <button
            type="button"
            className="primary-button"
            disabled={!selectedExport || !selectedChatRef}
            onClick={() => { void linkArtifact(); }}
          >
            Artifactとして紐づける
          </button>
        </footer>
      </section>
    </div>
  );
}
