import { useState } from "react";
import { IconCopy, IconMessage2Plus } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { usePreference } from "../../../utils/usePreference";
import { AI_ICON } from "../../../pages/semanticIcons";
import type { BaseRecord, PageProps, SaveOperation } from "../types";
import { NOTES_KIND_LABELS, notesKindFromNoteType, THEME_STATUS_LABELS } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { isDefaultPrompt, isPromptNote, promptPurpose } from "../lib/prompts";
import { compactNotesBodyPreview } from "../lib/notes";
import { buildCompleteTaskOperations } from "../domain-model/taskRecurrence";
import { buildTaskSection, groupTasksBySection, listTaskSections, type TaskSection, type TaskSectionGroup } from "../lib/taskSections";
import { ArtifactSection } from "../components/artifacts";
import { ActionButton, Button, EmptyState, PageHeader, SimpleRows, StatusBadge } from "../components/common";
import type { Schedule, Task } from "../domain-model/types";

const REPORT_TYPE_LABELS: Record<string, string> = {
  weekly: "週報",
  monthly: "月報",
  milestone: "節目報告",
  ad_hoc: "その他",
};

/** Overviewは全件一覧ではない。上位だけ出して続きは各画面へ回す（#321）。 */
const REPORT_PREVIEW_LIMIT = 5;
const TASK_PREVIEW_LIMIT = 7;
const NOTE_PREVIEW_LIMIT = 4;

function noteProps(note: BaseRecord): Record<string, unknown> {
  return note.properties_json && typeof note.properties_json === "object" ? note.properties_json as Record<string, unknown> : {};
}

/** 完了時刻。今日の分は時刻まで、それ以前は日付で出す。 */
function completedLabel(task: Task): string {
  const value = str(task.completed_at || task.updated_at || task.created_at);
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return sameDay
    ? date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : formatDate(value.slice(0, 10));
}

function TaskSectionBoard({
  groups,
  schedulesMap,
  collapsedSections,
  onToggleCollapse,
  onOpenTask,
  onRename,
  onDelete,
}: {
  groups: TaskSectionGroup[];
  schedulesMap: Map<string, Schedule>;
  collapsedSections: Set<string>;
  onToggleCollapse: (sectionId: string) => void;
  onOpenTask: (task: Task) => void;
  onRename: (section: TaskSection) => void;
  onDelete: (section: TaskSection) => void;
}) {
  return (
    <div className="task-section-board">
      {groups.map((group) => {
        const collapsed = collapsedSections.has(group.id);
        return (
          <section className="task-section-group" key={group.id}>
            <div className="task-section-heading">
              <button className="text-button compact" onClick={() => onToggleCollapse(group.id)}>{collapsed ? "開く" : "閉じる"}</button>
              <strong>{group.title}</strong>
              <span>{group.openCount}未完了 / {group.doneCount}完了</span>
              {group.section && (
                <div className="inline-actions">
                  <button className="text-button compact" onClick={() => onRename(group.section as TaskSection)}>名前変更</button>
                  <button className="text-button compact danger-text" onClick={() => onDelete(group.section as TaskSection)}>削除</button>
                </div>
              )}
            </div>
            {!collapsed && (
              <div className="task-section-list">
                {group.tasks.length ? group.tasks.map((task) => (
                  <button key={task.id} className={`wide-row ${task.state === "done" || task.state === "cancelled" ? "is-done" : ""}`} onClick={() => onOpenTask(task)}>
                    <strong>{task.title}</strong>
                    <span>{formatDate(schedulesMap.get(`task:${task.id}`)?.end_date)} / {task.state}</span>
                  </button>
                )) : <p className="field-help">タスクはありません。</p>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function ThemePage({ data, domain: v2, activeTheme, notes, openDrawer, openContentViewer, openContextPack, navigate, saveEntities, removeEntity, setToast }: PageProps) {
  const [sectionTitle, setSectionTitle] = useState("");
  const [themePreference, setThemePreference] = usePreference("theme.preferences", activeTheme?.id || "none");
  const collapsedSections = new Set(themePreference.collapsedSections);
  if (!activeTheme) {
    return <EmptyState title="テーマがありません" action="テーマを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />;
  }
  const theme = activeTheme;

  function toggleTaskSection(sectionId: string) {
    setThemePreference((current) => ({
      collapsedSections: current.collapsedSections.includes(sectionId)
        ? current.collapsedSections.filter((id) => id !== sectionId)
        : [...current.collapsedSections, sectionId],
    }));
  }
  const schedulesMap = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const themeTasks = v2.tasks.filter((t) => t.project_id === theme.id);
  const taskSections = listTaskSections(data.views || [], theme.id);
  const taskSectionGroups = groupTasksBySection(themeTasks, taskSections, theme.id);
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
  /** 未完了は期限の近い順。Overviewでは上位だけ出し、続きはToDoへ回す（#321）。 */
  const nextTasks = [...openTasks]
    .sort((a, b) => (schedulesMap.get(`task:${a.id}`)?.end_date || "9999").localeCompare(schedulesMap.get(`task:${b.id}`)?.end_date || "9999"))
    .slice(0, TASK_PREVIEW_LIMIT);
  /** 最近更新したNote。報告書とプロンプトは別枠なので混ぜない。 */
  const recentNotes = themeNotes
    .filter((note) => note.note_type !== "report" && !isPromptNote(note))
    .sort((a, b) => str(b.updated_at || b.created_at).localeCompare(str(a.updated_at || a.created_at)))
    .slice(0, NOTE_PREVIEW_LIMIT);

  async function completeTask(task: Task) {
    await saveEntities(
      buildCompleteTaskOperations(task, schedulesMap.get(`task:${task.id}`)),
      "完了しました。",
    );
  }

  const latestReport = reportNotes[0];
  const latestReportProps = latestReport ? noteProps(latestReport) : null;
  const defaultPrompt = reportPrompts[0];
  function copyNoteText(note: BaseRecord, message: string) {
    workspaceApi.copyText(str(note.body_markdown)).then(() => setToast(message));
  }
  async function addTaskSection() {
    const title = sectionTitle.trim();
    if (!title) { setToast("セクション名を入力してください。", "warning"); return; }
    const section = buildTaskSection({
      title,
      themeId: theme.id,
      sortOrder: taskSections.length,
    });
    await saveEntities([{ action: "save", type: "view", entity: section as SaveOperation["entity"] }], "セクションを追加しました。");
    setSectionTitle("");
  }
  async function renameTaskSection(section: TaskSection) {
    const title = window.prompt("セクション名", section.title)?.trim();
    if (!title) return;
    await saveEntities([{ action: "save", type: "view", entity: { ...section, title } as SaveOperation["entity"] }], "セクション名を更新しました。");
  }
  async function deleteTaskSection(section: TaskSection) {
    await removeEntity("view", section);
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
        <Button variant="ai" onClick={() => openContextPack(theme.id)}><AI_ICON size={16} />AI向けContext</Button>
        <Button variant="secondary" onClick={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: theme.id } })}>現在地を記録</Button>
        <ActionButton action="themeAddTask" onClick={() => openDrawer({ type: "task", mode: "edit", entity: { project_id: theme.id } })}>タスクを追加</ActionButton>
      </PageHeader>
      {/*
        Themeへ戻ったとき短時間で状況を把握するOverview（#321）。
        上から 報告書 → Task（未完了 / 完了）→ 最近のNote → Artifact の順に置き、
        現在地・マイルストーン・セクションは補助として下へ回す。
      */}
      <section className="panel report-section">
        <div className="section-heading">
          <h2>報告書・重要文書</h2>
          <div className="inline-actions">
            {reportNotes.length > REPORT_PREVIEW_LIMIT && (
              <button className="text-button compact" onClick={() => navigate("notes")}>すべて表示</button>
            )}
            <Button variant="secondary" compact onClick={defaultPrompt ? () => copyNoteText(defaultPrompt, "報告書プロンプトをコピーしました。") : addPrompt}>
              {defaultPrompt ? <IconCopy size={15} /> : <IconMessage2Plus size={15} />}
              {defaultPrompt ? "プロンプトをコピー" : "プロンプトを追加"}
            </Button>
            <ActionButton action="themeAddReport" compact onClick={addReport}>報告書を追加</ActionButton>
          </div>
        </div>
        <div className="report-list">
          {reportNotes.slice(0, REPORT_PREVIEW_LIMIT).map((note) => {
            const props = noteProps(note);
            const reportType = str(props.report_type) || "weekly";
            return (
              <div className="report-row" key={note.id}>
                <button onClick={() => openDrawer({ type: "note", mode: "edit", entity: note })}>
                  <strong>{note.title}</strong>
                  <span>
                    {REPORT_TYPE_LABELS[reportType] || reportType}
                    {" / "}
                    {formatDate(str(props.period_start))} - {formatDate(str(props.period_end))}
                    {" / 更新 "}
                    {formatDate(str(note.updated_at || note.created_at))}
                  </span>
                </button>
                <Button variant="secondary" compact className="icon-only" onClick={() => copyNoteText(note, "報告書本文をコピーしました。")} aria-label={`${note.title}の本文をコピー`} title="本文をコピー">
                  <IconCopy size={15} />
                </Button>
              </div>
            );
          })}
          {!reportNotes.length && <EmptyState title="報告書はまだありません" action="報告書を追加" onAction={addReport} />}
        </div>
      </section>

      {/* 未完了と完了を横並びにして、これからやることとやったことを同時に見る。 */}
      <div className="dashboard-grid theme-task-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>未完了</h2>
            <span>{openTasks.length}件</span>
            <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
          </div>
          {nextTasks.length ? (
            <ul className="theme-task-list">
              {nextTasks.map((task) => (
                <li key={task.id}>
                  <button
                    className="theme-task-check"
                    aria-label={`${task.title}を完了にする`}
                    title="完了にする"
                    onClick={() => void completeTask(task)}
                  />
                  <button
                    className="theme-task-main"
                    onClick={() => openDrawer({ type: "task", entity: { ...task, _schedule: schedulesMap.get(`task:${task.id}`) } as Record<string, unknown> })}
                  >
                    <strong>{task.title}</strong>
                    <span>{formatDate(schedulesMap.get(`task:${task.id}`)?.end_date) || "予定なし"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="未完了のタスクはありません" />
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>完了・やったこと</h2>
            <span>{doneTasks.length}件</span>
            <button className="text-button compact" onClick={() => navigate("todo")}>完了一覧へ</button>
          </div>
          {doneTasks.length ? (
            <ul className="theme-task-list is-done">
              {doneTasks.map((task) => (
                <li key={task.id}>
                  <button
                    className="theme-task-main"
                    onClick={() => openDrawer({ type: "task", entity: { ...task, _schedule: schedulesMap.get(`task:${task.id}`) } as Record<string, unknown> })}
                  >
                    <strong>{task.title}</strong>
                    {/* 完了時刻はActivity（#315）と同じ値を出す。 */}
                    <time dateTime={str(task.completed_at || task.updated_at || task.created_at)}>
                      {completedLabel(task)}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="完了済みの記録はまだありません" />
          )}
        </section>
      </div>

      {/* タイトルだけでは思い出せないので、本文の書き出しを見せる。 */}
      <section className="panel">
        <div className="section-heading">
          <h2>最近のNote</h2>
          <span>{recentNotes.length}件</span>
          <button className="text-button compact" onClick={() => navigate("notes")}>Notesへ</button>
        </div>
        {recentNotes.length ? (
          <div className="theme-note-grid">
            {recentNotes.map((note) => (
              <button
                className="theme-note-card"
                key={note.id}
                onClick={() => openDrawer({ type: "note", mode: "edit", entity: note })}
              >
                <strong>{str(note.title) || "無題"}</strong>
                <span className="theme-note-meta">
                  {NOTES_KIND_LABELS[notesKindFromNoteType(str(note.note_type))]}
                  {" / 更新 "}
                  {formatDate(str(note.updated_at || note.created_at))}
                </span>
                <p>{compactNotesBodyPreview(note.body_markdown, 160) || "本文はまだありません"}</p>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="このThemeのNoteはまだありません" />
        )}
      </section>

      <section className="panel">
        <ArtifactSection
          sourceType="theme"
          sourceId={theme.id}
          themeId={theme.id}
          artifacts={data.artifacts || []}
          data={data}
          // 元Note / Taskを辿れるようにする（#321）。
          openDrawer={openDrawer}
          openContentViewer={openContentViewer}
          saveEntities={saveEntities}
          removeEntity={removeEntity}
          setToast={setToast}
          includeThemeArtifacts
          headingExtra={<button className="text-button compact" onClick={() => navigate("artifacts")}>一覧へ</button>}
        />
      </section>

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

      <section className="panel task-sections-panel">
        <div className="section-heading"><h2>タスクセクション</h2><span>{taskSections.length}件</span></div>
        <div className="section-create-row">
          <input value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} placeholder="見出し名" />
          <Button variant="secondary" compact onClick={addTaskSection}>追加</Button>
        </div>
        <TaskSectionBoard
          groups={taskSectionGroups}
          schedulesMap={schedulesMap}
          collapsedSections={collapsedSections}
          onToggleCollapse={toggleTaskSection}
          onOpenTask={(task) => openDrawer({ type: "task", entity: { ...task, _schedule: schedulesMap.get(`task:${task.id}`) } as Record<string, unknown> })}
          onRename={renameTaskSection}
          onDelete={deleteTaskSection}
        />
      </section>
    </div>
  );
}
