import { useMemo, useState } from "react";
import { IconCopy, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps } from "../types";
import type { CaptureEntry } from "../domain-model/types";
import { buildMicroMemoView } from "../domain-model/selectors";
import { buildSaveCaptureEntryOperations } from "../domain-model/persistence";
import { formatDate, uuid } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";

export function MicroMemoPage({ domain, saveEntities, removeEntity, setToast, openDrawer }: PageProps) {
  const memos = useMemo(() => buildMicroMemoView(domain).entries, [domain]);
  const [text, setText] = useState("");

  async function addMemo() {
    const body = text.trim();
    if (!body) {
      setToast("メモ本文を入力してください。");
      return;
    }
    const entry: CaptureEntry = {
      id: uuid(),
      text: body,
      title: null,
      kind: "micro_memo",
      captured_at: new Date().toISOString(),
      state: "untriaged",
    };
    await saveEntities(buildSaveCaptureEntryOperations(entry), "付箋メモを追加しました。");
    setText("");
  }

  function copyMemos() {
    const body = memos.map((memo) => `- ${formatDate(memo.captured_at)} ${memo.text}`).join("\n");
    workspaceApi.copyText(body).then(() => setToast("付箋メモをコピーしました。"));
  }

  return (
    <div className="page micro-memo-page">
      <PageHeader title="付箋メモ" subtitle="Inbox整理に乗せる前の走り書きを一時的に置きます。">
        <button className="secondary-button" onClick={copyMemos} disabled={!memos.length}><IconCopy size={16} />コピー</button>
      </PageHeader>
      <section className="panel micro-memo-input">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="タイトルなしで残すメモ"
          aria-label="付箋メモ本文"
        />
        <button className="primary-button" onClick={addMemo}><IconPlus size={16} />追加</button>
      </section>
      <section className="micro-memo-grid">
        {memos.map((memo) => (
          <article className="panel micro-memo-card" key={memo.id}>
            <p>{memo.text}</p>
            <div>
              <time>{formatDate(memo.captured_at)}</time>
              <div className="inline-actions">
                <button
                  className="row-action-button"
                  onClick={() => openDrawer({ type: "capture_entry", mode: "edit", entity: memo as unknown as Record<string, unknown> })}
                  aria-label="付箋メモを編集"
                  title="編集"
                >
                  <IconPencil size={15} />
                </button>
                <button
                  className="row-action-button danger"
                  onClick={() => removeEntity("capture_entry", memo as unknown as Record<string, unknown>)}
                  aria-label="付箋メモを削除"
                  title="削除"
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
          </article>
        ))}
        {!memos.length && <EmptyState title="付箋メモはありません" action="メモを追加" onAction={addMemo} />}
      </section>
    </div>
  );
}
