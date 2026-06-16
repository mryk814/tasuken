import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { themeColor } from "../lib/domain";
import { addDays, compareDate, formatDate } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";

export function MilestonePage({ data, themes, items, openDrawer, setToast }: PageProps) {
  const [range, setRange] = useState("90");
  const today = todayIso();
  const limit = addDays(today, Number(range));
  const allThemes = data.themes || [];
  const records = items
    .filter((item) => {
      const date = item.planned_end;
      return Boolean(item.kind === "milestone" && date && date >= today && date <= limit);
    })
    .sort(compareDate);

  function copy() {
    workspaceApi
      .copyText(records.map((item) => `${item.planned_end}\t${allThemes.find((theme) => theme.id === item.theme_id)?.name || "—"}\t${item.title}`).join("\n"))
      .then(() => setToast("マイルストーンをコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="マイルストーン" subtitle="重要な節目だけをTheme横断で確認します。">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "milestone" } })}>マイルストーンを追加</button>
      </PageHeader>
      <div className="filter-bar panel">
        <div className="segmented">{[["30", "30日"], ["90", "90日"], ["180", "半期"], ["365", "年度"]].map(([id, label]) => <button key={id} className={range === id ? "is-active" : ""} onClick={() => setRange(id)}>{label}</button>)}</div>
        <span>{records.length}件</span>
      </div>
      <section className="panel milestone-map">
        {records.map((item) => {
          const theme = allThemes.find((entry) => entry.id === item.theme_id);
          const themeIndex = Math.max(0, allThemes.findIndex((entry) => entry.id === item.theme_id));
          return (
            <button
              key={item.id}
              className="milestone-row"
              style={{ "--chip-color": `var(--color-${themeColor(theme, themeIndex)})` } as React.CSSProperties}
              onClick={() => openDrawer({ type: "item", entity: item })}
            >
              <time>{formatDate(item.planned_end)}</time>
              <strong><span className="chip-dot" />{theme?.name || "Themeなし"}</strong>
              <span>{item.title}</span>
            </button>
          );
        })}
        {!records.length && <EmptyState title="この期間のマイルストーンはありません" action="追加する" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "milestone" } })} />}
      </section>
    </div>
  );
}
