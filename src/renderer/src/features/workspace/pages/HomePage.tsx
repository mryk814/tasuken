import type { Item, PageProps } from "../types";
import { compareDate, formatDate } from "../lib/format";
import { EmptyState, Metric, PageHeader, SimpleRows, StatusBadge } from "../components/common";

export function HomePage({ data, activeTheme, items, notes, openDrawer, navigate }: PageProps) {
  if (!activeTheme) {
    return <EmptyState title="テーマがありません" action="テーマを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />;
  }
  const related = items.filter((item) => item.theme_id === activeTheme.id);
  const open = related.filter((item) => item.status !== "done");
  const waiting = open.filter((item) => item.kind === "waiting" || item.status === "waiting");
  const milestones = open.filter((item) => item.kind === "milestone").sort(compareDate);
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
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { theme_id: activeTheme.id } })}>項目を追加</button>
      </PageHeader>
      <div className="metric-grid home-metrics">
        <Metric label="未完了" value={open.length} tone="primary" />
        <Metric label="待ち" value={waiting.length} />
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
          <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("milestones")}>一覧を開く</button></div>
          <SimpleRows records={milestones.slice(0, 5)} onOpen={(item) => openDrawer({ type: "item", entity: item })} meta={(item) => String((item as Item).date_text || formatDate((item as Item).due_date || (item as Item).planned_end))} />
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading"><h2>次のタスク</h2><button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button></div>
          <SimpleRows
            records={open.filter((item) => item.kind === "task" || item.kind === "deliverable").sort(compareDate).slice(0, 7)}
            onOpen={(item) => openDrawer({ type: "item", entity: item })}
            meta={(item) => formatDate((item as Item).due_date)}
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
