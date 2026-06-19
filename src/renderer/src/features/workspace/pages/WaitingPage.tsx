import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps } from "../types";
import { formatDate } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";
import { legacyWorkspaceToV2 } from "../../workspace-v2/domain/legacyAdapter";
import { buildWaitingView } from "../../workspace-v2/domain/selectors";

export function WaitingPage({ data, themes, items, openDrawer, setToast }: PageProps) {
  const legacyItemsById = new Map(items.map((item) => [item.id, item]));
  const waiting = buildWaitingView(legacyWorkspaceToV2(data)).waitings;

  function copy() {
    workspaceApi
      .copyText(waiting.map(({ waiting: entry, schedule }) => `${entry.title}\t${schedule?.end_date || "—"}\t${themes.find((theme) => theme.id === entry.project_id)?.name || "—"}`).join("\n"))
      .then(() => setToast("Waiting一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Waiting" subtitle="誰を、何を、いつまで待っているかを確認します。">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "waiting", status: "waiting" } })}>待ちを追加</button>
      </PageHeader>
      <section className="panel list-page">
        {waiting.map(({ waiting: entry, schedule }) => {
          const legacyItem = entry.legacy_item_id ? legacyItemsById.get(entry.legacy_item_id) : null;
          return (
            <button className="waiting-row" key={entry.id} onClick={() => legacyItem && openDrawer({ type: "item", entity: legacyItem })}>
              <div>
                <StatusBadge value="waiting" label="待ち" />
                <strong>{entry.title}</strong>
                <span>{themes.find((theme) => theme.id === entry.project_id)?.name || "—"}</span>
              </div>
              <div>
                <time>{formatDate(schedule?.end_date)}</time>
              </div>
            </button>
          );
        })}
        {!waiting.length && <EmptyState title="待ちはありません" action="追加する" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "waiting", status: "waiting" } })} />}
      </section>
    </div>
  );
}
