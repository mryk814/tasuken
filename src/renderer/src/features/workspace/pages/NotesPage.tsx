import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, NoteComment, PageProps } from "../types";
import { NOTE_TYPE_LABELS } from "../lib/domain";
import { str } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

type Combined = BaseRecord & { recordType: "note" | "resource" };

export function NotesPage({ themes, domain, openDrawer, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const records: Combined[] = [
    ...domain.notes.map((note) => ({ ...note, recordType: "note" as const } as Combined)),
    ...domain.resources.map((r) => ({ ...r, recordType: "resource" as const } as Combined)),
  ].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const visible = records.filter((record) =>
    `${str(record.title)} ${str(record.body_markdown || record.description)} ${str(record.url || record.source_url)}`
      .toLowerCase()
      .includes(query.toLowerCase()));

  function copy() {
    workspaceApi
      .copyText(visible.map((record) => `${str(record.title)}\t${record.recordType === "resource" ? "リソース" : str(record.note_type)}\t${themes.find((theme) => theme.id === (record.project_id || record.theme_id))?.name || "—"}\t${str(record.url || record.source_url)}`).join("\n"))
      .then(() => setToast("Notes一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Notes & Resources" subtitle="作業ログや素材はここへ入れ、判断に使う部品だけKnowledge化します">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: {} })}>リソースを追加</button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "note", mode: "edit", entity: { note_type: "artifact", content_format: "markdown" } })}>Markdown文書</button>
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
                  <StatusBadge value="neutral" label={record.recordType === "resource" ? "リソース" : (NOTE_TYPE_LABELS[str(record.note_type)] || str(record.note_type))} />
                  <strong className="note-row-title">{str(record.title)}</strong>
                  {record.recordType === "note" && comments && comments.length > 0 && <span className="comment-count" aria-label={`${comments.length}件のコメント`}>{comments.length}</span>}
                </span>
                <span className="note-row-body">{str(record.body_markdown || record.description || record.url) || "本文なし"}</span>
              </button>
              {record.recordType === "note" && (
                <button
                  className="secondary-button compact note-row-open"
                  onClick={() => openDrawer({
                    type: "knowledge_node",
                    mode: "edit",
                    entity: {
                      node_type: "claim",
                      title: record.title,
                      body: record.body_markdown,
                      theme_id: record.theme_id || null,
                      source_type: "note",
                      source_id: record.id,
                      confidence: "medium",
                      status: "active",
                    },
                  })}
                >
                  Knowledge化
                </button>
              )}
              {url && <a className="secondary-button compact note-row-open" href={url} target="_blank" rel="noreferrer">開く</a>}
            </div>
          );
        })}
        {!visible.length && <EmptyState title="一致するメモはありません" action="メモを書く" onAction={() => openDrawer({ type: "note", mode: "edit", entity: {} })} />}
      </section>
    </div>
  );
}
