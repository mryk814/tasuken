import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps } from "../types";
import { compareDate, formatDate } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

export function WaitingPage({ themes, items, openDrawer, setToast }: PageProps) {
  const waiting = items.filter((item) => item.kind === "waiting" || item.status === "waiting").sort(compareDate);

  function copy() {
    workspaceApi
      .copyText(waiting.map((item) => `${item.title}\t${item.planned_end || "—"}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "—"}`).join("\n"))
      .then(() => setToast("Waiting一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Waiting" subtitle="誰を、何を、いつまで待っているかを確認します。">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "waiting", status: "waiting" } })}>待ちを追加</button>
      </PageHeader>
      <section className="panel list-page">
        {waiting.map((item) => (
          <button className="waiting-row" key={item.id} onClick={() => openDrawer({ type: "item", entity: item })}>
            <div>
              <StatusBadge value="waiting" label="待ち" />
              <strong>{item.title}</strong>
              <span>{themes.find((theme) => theme.id === item.theme_id)?.name || "—"}</span>
            </div>
            <div>
              <time>{formatDate(item.planned_end)}</time>
            </div>
          </button>
        ))}
        {!waiting.length && <EmptyState title="待ちはありません" action="追加する" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "waiting", status: "waiting" } })} />}
      </section>
    </div>
  );
}
