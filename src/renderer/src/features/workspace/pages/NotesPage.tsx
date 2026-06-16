import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, NoteComment, PageProps } from "../types";
import { NOTE_TYPE_LABELS } from "../lib/domain";
import { str } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

type Combined = BaseRecord & { recordType: "note" | "link" };

export function NotesPage({ themes, notes, links, openDrawer, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const records: Combined[] = [
    ...notes.map((note) => ({ ...note, recordType: "note" as const })),
    ...links
      .filter((link) => !notes.some((note) => note.source_url && note.source_url === link.url))
      .map((link) => ({ ...link, recordType: "link" as const })),
  ].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const visible = records.filter((record) =>
    `${str(record.title)} ${str(record.body_markdown || record.description)} ${str(record.url || record.source_url)}`
      .toLowerCase()
      .includes(query.toLowerCase()));

  function copy() {
    workspaceApi
      .copyText(visible.map((record) => `${str(record.title)}\t${record.recordType === "link" ? "link" : str(record.note_type)}\t${themes.find((theme) => theme.id === record.theme_id)?.name || "—"}\t${str(record.url || record.source_url)}`).join("\n"))
      .then(() => setToast("Notes一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Notes">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "note", mode: "edit", entity: {} })}>メモを書く</button>
      </PageHeader>
      <div className="filter-bar panel">
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、本文、URLを検索" />
        <span>{visible.length}件</span>
      </div>
      <section className="panel list-page">
        {visible.map((record) => {
          const comments = record.comments as NoteComment[] | undefined;
          const url = str(record.source_url || record.url);
          return (
            <div className="note-row" key={`${record.recordType}-${record.id}`}>
              <button className="note-row-main" onClick={() => openDrawer({ type: record.recordType, entity: record })}>
                <span className="note-row-head">
                  <StatusBadge value="neutral" label={record.recordType === "link" ? "リンク" : (NOTE_TYPE_LABELS[str(record.note_type)] || str(record.note_type))} />
                  <strong className="note-row-title">{str(record.title)}</strong>
                  {record.recordType === "note" && comments && comments.length > 0 && <span className="comment-count" aria-label={`${comments.length}件のコメント`}>{comments.length}</span>}
                </span>
                <span className="note-row-body">{str(record.body_markdown || record.description || record.url) || "本文なし"}</span>
              </button>
              {url && <a className="secondary-button compact note-row-open" href={url} target="_blank" rel="noreferrer">開く</a>}
            </div>
          );
        })}
        {!visible.length && <EmptyState title="一致するメモはありません" action="メモを書く" onAction={() => openDrawer({ type: "note", mode: "edit", entity: {} })} />}
      </section>
    </div>
  );
}
