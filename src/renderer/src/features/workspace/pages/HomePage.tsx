import type { BaseRecord, PageProps } from "../types";
import { formatDate } from "../lib/format";
import { EmptyState, Metric, PageHeader, SimpleRows, StatusBadge } from "../components/common";
import { buildWorkspaceDomain } from "../domain-model/compat/legacyAdapter";

export function HomePage({ data, activeTheme, notes, openDrawer, navigate }: PageProps) {
  if (!activeTheme) {
    return <EmptyState title="テーマがありません" action="テーマを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />;
  }
  const v2 = buildWorkspaceDomain(data);
  const schedulesMap = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const themeTasks = v2.tasks.filter((t) => t.project_id === activeTheme.id);
  const themeWaitings = v2.waitings.filter((w) => w.project_id === activeTheme.id);
  const themePlanNodes = v2.plan_nodes.filter((p) => p.project_id === activeTheme.id);
  const openTasks = themeTasks.filter((t) => t.state !== "done" && t.state !== "cancelled");
  const activeWaitings = themeWaitings.filter((w) => w.state === "waiting");
  const milestones = themePlanNodes
    .filter((p) => p.type === "milestone" && p.state !== "done" && p.state !== "cancelled")
    .sort((a, b) => (schedulesMap.get(`plan_node:${a.id}`)?.end_date || "9999").localeCompare(schedulesMap.get(`plan_node:${b.id}`)?.end_date || "9999"));
  const updates = (data.status_updates || [])
    .filter((entry) => entry.theme_id === activeTheme.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = updates[0];
  const themeNotes = notes.filter((note) => note.theme_id === activeTheme.id);
  return (
    <div className="page">
      <PageHeader title={activeTheme.name} subtitle={activeTheme.description}>
        <StatusBadge value={activeTheme.status} label={activeTheme.status} />
        <button className="secondary-button" onClick={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: activeTheme.id } })}>現在地を記録</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "task", mode: "edit", entity: { project_id: activeTheme.id } })}>タスクを追加</button>
      </PageHeader>
      <div className="metric-grid home-metrics">
        <Metric label="未完了" value={openTasks.length} tone="primary" />
        <Metric label="待ち" value={activeWaitings.length} />
        <Metric label="マイルストーン" value={milestones.length} />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading"><h2>現在地</h2><span>{latest ? formatDate(latest.date) : "未記録"}</span></div>
          {latest ? (
            <div className="status-summary">
              <StatusBadge value={latest.status} label={latest.status} />
              <strong>{latest.summary}</strong>
              {latest.risks && <p>{latest.risks}</p>}
              {latest.next_actions && <p><b>次:</b> {latest.next_actions}</p>}
            </div>
          ) : (
            <EmptyState title="現在地がまだありません" action="記録する" onAction={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: activeTheme.id } })} />
          )}
        </section>
        <section className="panel">
          <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("timeline")}>Timelineへ</button></div>
          <SimpleRows records={milestones as unknown as BaseRecord[]} onOpen={(node) => openDrawer({ type: "plan_node", entity: node })} meta={(node) => formatDate(schedulesMap.get(`plan_node:${node.id}`)?.end_date)} />
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading"><h2>次のタスク</h2><button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button></div>
          <SimpleRows
            records={openTasks.sort((a, b) => (schedulesMap.get(`task:${a.id}`)?.end_date || "9999").localeCompare(schedulesMap.get(`task:${b.id}`)?.end_date || "9999")).slice(0, 7) as unknown as BaseRecord[]}
            onOpen={(task) => openDrawer({ type: "task", entity: task })}
            meta={(task) => formatDate(schedulesMap.get(`task:${task.id}`)?.end_date)}
          />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>最近のメモ</h2><span>{themeNotes.length}件</span></div>
          <SimpleRows records={themeNotes.slice(0, 5)} onOpen={(note) => openDrawer({ type: "note", entity: note })} meta={(note) => String(note.note_type ?? "")} />
        </section>
      </div>
    </div>
  );
}
