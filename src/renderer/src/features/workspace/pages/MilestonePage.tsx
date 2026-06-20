import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { themeColor } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";
import { buildWorkspaceDomain } from "../domain-model/compat/legacyAdapter";

export function MilestonePage({ data, themes, openDrawer, setToast }: PageProps) {
  const [range, setRange] = useState("90");
  const today = todayIso();
  const limit = addDays(today, Number(range));
  const v2 = buildWorkspaceDomain(data);
  const schedulesMap = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const records = v2.plan_nodes
    .filter((node) => {
      if (node.type !== "milestone") return false;
      const schedule = schedulesMap.get(`plan_node:${node.id}`);
      const date = schedule?.end_date || schedule?.start_date;
      return Boolean(date && date >= today && date <= limit);
    })
    .sort((a, b) => {
      const aDate = schedulesMap.get(`plan_node:${a.id}`)?.end_date || "9999";
      const bDate = schedulesMap.get(`plan_node:${b.id}`)?.end_date || "9999";
      return aDate.localeCompare(bDate);
    });

  function copy() {
    workspaceApi
      .copyText(records.map((node) => {
        const date = schedulesMap.get(`plan_node:${node.id}`)?.end_date || "";
        return `${date}\t${themes.find((t) => t.id === node.project_id)?.name || "—"}\t${node.title}`;
      }).join("\n"))
      .then(() => setToast("マイルストーンをコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="マイルストーン" subtitle="重要な節目だけをTheme横断で確認します。">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "plan_node", mode: "edit", entity: { node_type: "milestone", node_state: "planned" } })}>マイルストーンを追加</button>
      </PageHeader>
      <div className="filter-bar panel">
        <div className="segmented">{[["30", "30日"], ["90", "90日"], ["180", "半期"], ["365", "年度"]].map(([id, label]) => <button key={id} className={range === id ? "is-active" : ""} onClick={() => setRange(id)}>{label}</button>)}</div>
        <span>{records.length}件</span>
      </div>
      <section className="panel milestone-map">
        {records.map((node) => {
          const theme = themes.find((entry) => entry.id === node.project_id);
          const themeIndex = Math.max(0, themes.findIndex((entry) => entry.id === node.project_id));
          const schedule = schedulesMap.get(`plan_node:${node.id}`);
          return (
            <button
              key={node.id}
              className="milestone-row"
              style={{ "--chip-color": `var(--color-${themeColor(theme, themeIndex)})` } as React.CSSProperties}
              onClick={() => openDrawer({ type: "plan_node", entity: { ...node, _schedule: schedule } as Record<string, unknown> })}
            >
              <time>{formatDate(schedule?.end_date)}</time>
              <strong><span className="chip-dot" />{theme?.name || "Themeなし"}</strong>
              <span>{node.title}</span>
            </button>
          );
        })}
        {!records.length && <EmptyState title="この期間のマイルストーンはありません" action="追加する" onAction={() => openDrawer({ type: "plan_node", mode: "edit", entity: { node_type: "milestone", node_state: "planned" } })} />}
      </section>
    </div>
  );
}
