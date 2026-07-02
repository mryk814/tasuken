import { IconCopy, IconFileText, IconMessage2Plus } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, PageProps } from "../types";
import { THEME_STATUS_LABELS } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { isDefaultPrompt, isPromptNote, promptPurpose } from "../lib/prompts";
import { EmptyState, Metric, PageHeader, SimpleRows, StatusBadge } from "../components/common";

const REPORT_TYPE_LABELS: Record<string, string> = {
  weekly: "週報",
  monthly: "月報",
  milestone: "節目報告",
  ad_hoc: "その他",
};

function noteProps(note: BaseRecord): Record<string, unknown> {
  return note.properties_json && typeof note.properties_json === "object" ? note.properties_json as Record<string, unknown> : {};
}

export function ThemePage({ data, domain: v2, activeTheme, notes, openDrawer, navigate, setToast }: PageProps) {
  if (!activeTheme) {
    return <EmptyState title="テーマがありません" action="テーマを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />;
  }
  const theme = activeTheme;
  const schedulesMap = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const themeTasks = v2.tasks.filter((t) => t.project_id === theme.id);
  const themeWaitings = v2.waitings.filter((w) => w.project_id === theme.id);
  const themePlanNodes = v2.plan_nodes.filter((p) => p.project_id === theme.id);
  const openTasks = themeTasks.filter((t) => t.state !== "done" && t.state !== "cancelled");
  const doneTasks = themeTasks
    .filter((t) => t.state === "done")
    .sort((a, b) => str(b.completed_at || b.updated_at || b.created_at).localeCompare(str(a.completed_at || a.updated_at || a.created_at)))
    .slice(0, 7);
  const activeWaitings = themeWaitings.filter((w) => w.state === "waiting");
  const milestones = themePlanNodes
    .filter((p) => p.type === "milestone" && p.state !== "done" && p.state !== "cancelled")
    .sort((a, b) => (schedulesMap.get(`plan_node:${a.id}`)?.end_date || "9999").localeCompare(schedulesMap.get(`plan_node:${b.id}`)?.end_date || "9999"));
  const updates = (data.status_updates || [])
    .filter((entry) => entry.theme_id === theme.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = updates[0];
  const themeNotes = notes.filter((note) => note.theme_id === theme.id);
  const reportNotes = themeNotes
    .filter((note) => note.note_type === "report")
    .sort((a, b) => str(noteProps(b).period_end || b.updated_at || b.created_at).localeCompare(str(noteProps(a).period_end || a.updated_at || a.created_at)));
  const reportPrompts = themeNotes
    .filter((note) => note.note_type === "report_prompt" || (isPromptNote(note) && promptPurpose(note) === "report"))
    .sort((a, b) => Number(isDefaultPrompt(b)) - Number(isDefaultPrompt(a)) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const latestReport = reportNotes[0];
  const latestReportProps = latestReport ? noteProps(latestReport) : null;
  const defaultPrompt = reportPrompts[0];
  function copyNoteText(note: BaseRecord, message: string) {
    workspaceApi.copyText(str(note.body_markdown)).then(() => setToast(message));
  }
  function addReport() {
    const previousEnd = latestReportProps ? str(latestReportProps.period_end) : "";
    openDrawer({
      type: "note",
      mode: "edit",
      entity: {
        theme_id: theme.id,
        note_type: "report",
        content_format: "markdown",
        title: `${theme.name} ${REPORT_TYPE_LABELS.weekly}`,
        properties_json: {
          report_type: "weekly",
          period_start: previousEnd,
          period_end: "",
        },
      },
    });
  }
  function addPrompt() {
    openDrawer({
      type: "note",
      mode: "edit",
      entity: {
        theme_id: theme.id,
        note_type: "report_prompt",
        content_format: "markdown",
        title: `${theme.name} 報告書プロンプト`,
        body_markdown: `${theme.name} の活動を、対象期間に沿って簡潔な報告書として整理してください。`,
        properties_json: { report_type: "weekly" },
      },
    });
  }
  return (
    <div className="page">
      <PageHeader title={theme.name} subtitle={theme.description}>
        {theme.code && <span className="theme-code">{theme.code}</span>}
        <button className="secondary-button" onClick={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: theme.id } })}>現在地を記録</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "task", mode: "edit", entity: { project_id: theme.id } })}>タスクを追加</button>
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
              <StatusBadge value={latest.status} label={THEME_STATUS_LABELS[String(latest.status || "")] || String(latest.status || "未設定")} />
              <strong>{latest.summary}</strong>
              {latest.risks && <p>{latest.risks}</p>}
              {latest.next_actions && <p><b>次:</b> {latest.next_actions}</p>}
            </div>
          ) : (
            <EmptyState title="現在地がまだありません" action="記録する" onAction={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: theme.id } })} />
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
          <SimpleRows records={themeNotes.filter((note) => note.note_type !== "report" && !isPromptNote(note)).slice(0, 5)} onOpen={(note) => openDrawer({ type: "note", entity: note })} meta={(note) => String(note.note_type ?? "")} />
        </section>
      </div>
      <section className="panel">
        <div className="section-heading"><h2>最近やったこと</h2><button className="text-button compact" onClick={() => navigate("todo")}>完了一覧へ</button></div>
        <SimpleRows
          records={doneTasks as unknown as BaseRecord[]}
          onOpen={(task) => openDrawer({ type: "task", entity: task })}
          meta={(task) => formatDate(str(task.completed_at || task.updated_at || task.created_at))}
        />
        {!doneTasks.length && <EmptyState title="完了済みの記録はまだありません" />}
      </section>
      <section className="panel report-section">
        <div className="section-heading">
          <h2>報告書</h2>
          <div className="inline-actions">
            <button className="secondary-button compact" onClick={defaultPrompt ? () => copyNoteText(defaultPrompt, "報告書プロンプトをコピーしました。") : addPrompt}>
              {defaultPrompt ? <IconCopy size={15} /> : <IconMessage2Plus size={15} />}
              {defaultPrompt ? "プロンプトをコピー" : "プロンプトを追加"}
            </button>
            <button className="primary-button compact" onClick={addReport}><IconFileText size={15} />報告書を追加</button>
          </div>
        </div>
        <div className="report-summary-row">
          <div>
            <span>前回報告</span>
            <strong>{latestReportProps ? `${formatDate(str(latestReportProps.period_start))} - ${formatDate(str(latestReportProps.period_end))}` : "未作成"}</strong>
          </div>
          <div>
            <span>履歴</span>
            <strong className="metric-value">{reportNotes.length}</strong>
          </div>
          <div>
            <span>プロンプト</span>
            <strong>{defaultPrompt ? "保存済み" : "未作成"}</strong>
          </div>
        </div>
        <div className="report-list">
          {reportNotes.slice(0, 5).map((note) => {
            const props = noteProps(note);
            const reportType = str(props.report_type) || "weekly";
            return (
              <div className="report-row" key={note.id}>
                <button onClick={() => openDrawer({ type: "note", mode: "edit", entity: note })}>
                  <strong>{note.title}</strong>
                  <span>{REPORT_TYPE_LABELS[reportType] || reportType} / {formatDate(str(props.period_start))} - {formatDate(str(props.period_end))}</span>
                </button>
                <button className="secondary-button compact icon-only" onClick={() => copyNoteText(note, "報告書本文をコピーしました。")} aria-label={`${note.title}の本文をコピー`} title="本文をコピー">
                  <IconCopy size={15} />
                </button>
              </div>
            );
          })}
          {!reportNotes.length && <EmptyState title="報告書はまだありません" action="報告書を追加" onAction={addReport} />}
        </div>
      </section>
    </div>
  );
}
