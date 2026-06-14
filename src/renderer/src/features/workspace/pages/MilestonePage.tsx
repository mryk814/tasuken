import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { SCHEDULE_LABELS } from "../lib/domain";
import { addDays, compareDate, formatDate } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

export function MilestonePage({ themes, items, openDrawer, setToast }: PageProps) {
  const [range, setRange] = useState("90");
  const today = todayIso();
  const limit = addDays(today, Number(range));
  const records = items
    .filter((item) => {
      const date = item.due_date || item.planned_end;
      return Boolean((item.kind === "milestone" || (item.priority === "high" && date)) && date && date >= today && date <= limit);
    })
    .sort(compareDate);

  function copy() {
    workspaceApi
      .copyText(records.map((item) => `${item.due_date || item.planned_end}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "—"}\t${item.title}`).join("\n"))
      .then(() => setToast("マイルストーンをコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Milestone Map" subtitle="重要な節目だけをTheme横断で確認します。">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "milestone", schedule_status: "fixed", schedule_confidence: "fixed" } })}>マイルストーンを追加</button>
      </PageHeader>
      <div className="filter-bar panel">
        <div className="segmented">{[["30", "30日"], ["90", "90日"], ["180", "半期"], ["365", "年度"]].map(([id, label]) => <button key={id} className={range === id ? "is-active" : ""} onClick={() => setRange(id)}>{label}</button>)}</div>
        <span>{records.length}件</span>
      </div>
      <section className="panel milestone-map">
        {records.map((item) => (
          <button key={item.id} className="milestone-row" onClick={() => openDrawer({ type: "item", entity: item })}>
            <time>{formatDate(item.due_date || item.planned_end)}</time>
            <strong>{themes.find((theme) => theme.id === item.theme_id)?.name || "Themeなし"}</strong>
            <span>{item.title}</span>
            <StatusBadge value={item.schedule_status} label={SCHEDULE_LABELS[item.schedule_status ?? ""]} />
          </button>
        ))}
        {!records.length && <EmptyState title="この期間のマイルストーンはありません" action="追加する" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "milestone" } })} />}
      </section>
    </div>
  );
}
