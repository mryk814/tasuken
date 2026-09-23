import { useEffect, useMemo, useState } from "react";
import {
  IconCopy,
  IconFolder,
  IconMessage2Plus,
  IconPencil,
  IconRefresh,
} from "@tabler/icons-react";

import type { ThemeAiPackPreviewResult } from "../../../../../shared/ipc/contracts";
import { noteProjectId } from "../../../../../shared/themeRef.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import { usePreference } from "../../../utils/usePreference";
import { AI_ICON } from "../../../pages/semanticIcons";
import type { BaseRecord, PageProps, SaveOperation } from "../types";
import {
  KNOWLEDGE_NODE_LABELS,
  NOTES_KIND_LABELS,
  notesKindFromNoteType,
  THEME_STATUS_LABELS,
} from "../lib/domain";
import { formatDate, str } from "../lib/format";
import {
  FEED_POST_KIND_LABELS,
  authorOf,
  buildOwnPosts,
  buildPostsFromProposals,
  buildRepliesFromEntities,
  requestFeedPostFocus,
} from "../lib/feedPosts";
import { isPromptNote, promptPurpose } from "../lib/prompts";
import { compactNotesBodyPreview } from "../lib/notes";
import { buildCompleteTaskOperations } from "../domain-model/taskRecurrence";
import {
  buildTaskSection,
  groupTasksBySection,
  listTaskSections,
  type TaskSection,
  type TaskSectionGroup,
} from "../lib/taskSections";
import { ArtifactSection } from "../components/artifacts";
import { AiContextPreviewPanel } from "../components/AiContextPreviewPanel";
import { AgentWorkSummaryPanel } from "../components/AgentWorkSummaryPanel";
import { ThemeIntentPanel } from "../components/ThemeIntentPanel";
import {
  ActionButton,
  Button,
  EmptyState,
  IntegrationStatus,
  PageHeader,
  SimpleRows,
  StatusBadge,
} from "../components/common";
import type { Schedule, Task } from "../domain-model/types";

const REPORT_TYPE_LABELS: Record<string, string> = {
  weekly: "週報",
  monthly: "月報",
  milestone: "節目報告",
  ad_hoc: "その他",
};

/**
 * Themeの面。目的・仕事・会話・知見を一つのThemeへ集める（計画フェーズ4）。
 * 選んだ面はpreferenceへ残し、画面を離れて戻っても同じ面を開く。
 */
type ThemeTab = "overview" | "tasks" | "posts" | "notes";

const THEME_TABS: ReadonlyArray<{ id: ThemeTab; label: string }> = [
  { id: "overview", label: "概要" },
  { id: "tasks", label: "タスク" },
  { id: "posts", label: "投稿" },
  { id: "notes", label: "Notes" },
];

/** Overviewは全件一覧ではない。上位だけ出して続きは各画面へ回す（#321）。 */
const REPORT_PREVIEW_LIMIT = 5;
const TASK_PREVIEW_LIMIT = 7;
/** 概要の「次の仕事」と「近いマイルストーン」は、次の判断に要る分だけを出す。 */
const OVERVIEW_TASK_LIMIT = 3;
const MILESTONE_PREVIEW_LIMIT = 3;
/** 「いま分かっていること」に出すKnowledgeの上限。 */
const KNOWLEDGE_PREVIEW_LIMIT = 2;
const NOTE_PREVIEW_LIMIT = 4;
const AI_PACK_STATE_LABELS: Record<string, string> = {
  missing: "未生成",
  dirty: "更新あり",
  current: "最新",
  skipped: "最新",
  current_with_warning: "最新（要確認）",
  stale_preview: "再確認が必要",
  publishing: "更新中",
  failed_retryable: "再試行できます",
  recovery_required: "復旧が必要",
  needs_root: "保存先未設定",
  root_unavailable: "保存先を利用できません",
  identity_conflict: "Theme ID競合",
};

function aiPackStatusTone(
  state: string | undefined,
  loading: boolean,
): "normal" | "neutral" | "attention" | "error" | "loading" {
  if (loading || state === "publishing") return "loading";
  if (state === "recovery_required" || state === "identity_conflict") return "error";
  if (
    [
      "missing",
      "dirty",
      "stale_preview",
      "failed_retryable",
      "needs_root",
      "root_unavailable",
      "current_with_warning",
    ].includes(state || "")
  )
    return "attention";
  if (state === "current" || state === "skipped") return "normal";
  return "neutral";
}

function noteProps(note: BaseRecord): Record<string, unknown> {
  return note.properties_json && typeof note.properties_json === "object"
    ? (note.properties_json as Record<string, unknown>)
    : {};
}

/** 完了時刻。今日の分は時刻まで、それ以前は日付で出す。 */
function completedLabel(task: Task): string {
  const value = str(task.completed_at || task.updated_at || task.created_at);
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return sameDay
    ? date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : formatDate(value.slice(0, 10));
}

/**
 * 投稿時刻はFeedと同じ相対表示にする。
 * 読み方はFeedの投稿カードと揃え、Theme面だけ別の時刻表記を混ぜない。
 */
function relativeTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`;
  const days = Math.floor(minutes / (60 * 24));
  if (days < 7) return `${days}日前`;
  return formatDate(value.slice(0, 10));
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
              <button className="text-button compact" onClick={() => onToggleCollapse(group.id)}>
                {collapsed ? "開く" : "閉じる"}
              </button>
              <strong>{group.title}</strong>
              <span>
                {group.openCount}未完了 / {group.doneCount}完了
              </span>
              {group.section && (
                <div className="inline-actions">
                  <button
                    className="text-button compact"
                    onClick={() => onRename(group.section as TaskSection)}
                  >
                    名前変更
                  </button>
                  <button
                    className="text-button compact danger-text"
                    onClick={() => onDelete(group.section as TaskSection)}
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
            {!collapsed && (
              <div className="task-section-list">
                {group.tasks.length ? (
                  group.tasks.map((task) => (
                    <button
                      key={task.id}
                      className={`wide-row ${task.state === "done" || task.state === "cancelled" ? "is-done" : ""}`}
                      onClick={() => onOpenTask(task)}
                    >
                      <strong>{task.title}</strong>
                      <span>
                        {formatDate(schedulesMap.get(`task:${task.id}`)?.end_date)} / {task.state}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="field-help">タスクはありません。</p>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function ThemePage({
  data,
  domain: v2,
  activeTheme,
  notes,
  openDrawer,
  openContentViewer,
  openContextPack,
  navigate,
  saveEntities,
  removeEntity,
  setToast,
}: PageProps) {
  const [sectionTitle, setSectionTitle] = useState("");
  const [aiPack, setAiPack] = useState<ThemeAiPackPreviewResult | null>(null);
  const [aiPackLoading, setAiPackLoading] = useState(false);
  const [aiPackPublishing, setAiPackPublishing] = useState(false);
  const [aiPackError, setAiPackError] = useState("");
  const [aiPackPreviewOpen, setAiPackPreviewOpen] = useState(false);
  const [themePreference, setThemePreference] = usePreference(
    "theme.preferences",
    activeTheme?.id || "none",
  );
  const tab = themePreference.tab;
  const activeThemeId = activeTheme?.id || "";
  const aiPackRevisionKey = useMemo(
    () =>
      Object.values(data as unknown as Record<string, unknown>)
        .filter(Array.isArray)
        .flatMap((entries) => entries as Array<Record<string, unknown>>)
        .map(
          (entry) =>
            `${String(entry.id || "")}:${String(entry.version || "")}:${String(entry.updated_at || "")}`,
        )
        .sort()
        .join("|"),
    [data],
  );

  useEffect(() => {
    if (!activeThemeId) {
      setAiPack(null);
      return undefined;
    }
    let current = true;
    const refresh = async () => {
      setAiPack((previous) => (previous?.themeId === activeThemeId ? previous : null));
      setAiPackLoading(true);
      setAiPackError("");
      try {
        const preview = await workspaceApi.previewThemeAiPack(activeThemeId);
        if (current) setAiPack(preview);
      } catch (error) {
        if (current)
          setAiPackError(
            error instanceof Error ? error.message : "AI Packを確認できませんでした。",
          );
      } finally {
        if (current) setAiPackLoading(false);
      }
    };
    void refresh();
    const unsubscribe = workspaceApi.onThemeAiPackChanged((change) => {
      if (change.themeId === activeThemeId) void refresh();
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [activeThemeId, aiPackRevisionKey]);

  const collapsedSections = new Set(themePreference.collapsedSections);
  if (!activeTheme) {
    return (
      <EmptyState
        title="テーマがありません"
        action="テーマを追加"
        onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}
      />
    );
  }
  const theme = activeTheme;
  const themeRepositoryIds = new Set([
    ...(theme.repository_context_ids || []).map(String),
    ...(theme.primary_repository_context_id ? [String(theme.primary_repository_context_id)] : []),
  ]);
  const themeRepositories = v2.repository_contexts.filter(
    (repository) =>
      themeRepositoryIds.has(String(repository.id)) &&
      !repository.deleted_at &&
      repository.active !== false,
  );

  function toggleTaskSection(sectionId: string) {
    setThemePreference((current) => ({
      ...current,
      collapsedSections: current.collapsedSections.includes(sectionId)
        ? current.collapsedSections.filter((id) => id !== sectionId)
        : [...current.collapsedSections, sectionId],
    }));
  }
  function selectTab(next: ThemeTab) {
    setThemePreference((current) => ({ ...current, tab: next }));
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
    .sort((a, b) =>
      str(b.completed_at || b.updated_at || b.created_at).localeCompare(
        str(a.completed_at || a.updated_at || a.created_at),
      ),
    )
    .slice(0, 7);
  const activeWaitings = themeWaitings.filter((w) => w.state === "waiting");
  const milestones = themePlanNodes
    .filter((p) => p.type === "milestone" && p.state !== "done" && p.state !== "cancelled")
    .sort((a, b) =>
      (schedulesMap.get(`plan_node:${a.id}`)?.end_date || "9999").localeCompare(
        schedulesMap.get(`plan_node:${b.id}`)?.end_date || "9999",
      ),
    );
  const updates = (data.status_updates || [])
    .filter((entry) => entry.theme_id === theme.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = updates[0];
  const themeNotes = notes.filter((note) => noteProjectId(note) === theme.id);
  const reportNotes = themeNotes
    .filter((note) => note.note_type === "report")
    .sort((a, b) =>
      str(noteProps(b).period_end || b.updated_at || b.created_at).localeCompare(
        str(noteProps(a).period_end || a.updated_at || a.created_at),
      ),
    );
  const reportPrompts = themeNotes
    .filter(
      (note) =>
        note.note_type === "report_prompt" ||
        (isPromptNote(note) && promptPurpose(note) === "report"),
    )
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  /** 未完了は期限の近い順。Overviewでは上位だけ出し、続きはToDoへ回す（#321）。 */
  const nextTasks = [...openTasks]
    .sort((a, b) =>
      (schedulesMap.get(`task:${a.id}`)?.end_date || "9999").localeCompare(
        schedulesMap.get(`task:${b.id}`)?.end_date || "9999",
      ),
    )
    .slice(0, TASK_PREVIEW_LIMIT);
  /** 最近更新したNote。報告書とプロンプトは別枠なので混ぜない。 */
  const recentNotes = themeNotes
    .filter((note) => note.note_type !== "report" && !isPromptNote(note))
    .sort((a, b) =>
      str(b.updated_at || b.created_at).localeCompare(str(a.updated_at || a.created_at)),
    )
    .slice(0, NOTE_PREVIEW_LIMIT);
  const overviewTasks = nextTasks.slice(0, OVERVIEW_TASK_LIMIT);
  const overviewMilestones = milestones.slice(0, MILESTONE_PREVIEW_LIMIT);
  /**
   * KnowledgeもNote・Taskと同じく、Themeに紐づく記録だけを投影する。
   * 「確認済み」のような新しい印は作らず、出典の表示だけを行う。
   */
  const themeKnowledgeNodes = (data.knowledge_nodes || [])
    .filter((node) => str(node.theme_id) === theme.id)
    .sort((a, b) =>
      str(b.updated_at || b.created_at).localeCompare(str(a.updated_at || a.created_at)),
    )
    .slice(0, KNOWLEDGE_PREVIEW_LIMIT);

  /*
   * Themeに紐づくFeed投稿は、Feedと同じ投影から読む（正本はProposalと返信Entity、
   * 自分の投稿はFeed専用Entityのまま）。
   * 会話の全文と記事本文はFeedの面が持つので、ここでは数と入口だけを置く。
   * 早期returnより後ではHookを増やせないため、投影は表示のたびに組み立てる。
   */
  const feedProjection = [
    ...buildPostsFromProposals({
      proposals: v2.ai_proposals,
      themes: data.themes,
      tasks: v2.tasks,
    }),
    ...buildRepliesFromEntities({ replies: v2.feed_replies, proposals: v2.ai_proposals }),
    ...buildOwnPosts({ feedPosts: v2.feed_posts }),
  ];
  /** 返信自身はThemeを持たない。親投稿のThemeで数える。 */
  const themeFeedPosts = feedProjection.filter(
    (post) => !post.replyTo && post.themeId === theme.id,
  );
  const themeReplyCounts = new Map<string, number>();
  for (const reply of feedProjection) {
    if (!reply.replyTo) continue;
    themeReplyCounts.set(reply.replyTo, (themeReplyCounts.get(reply.replyTo) || 0) + 1);
  }

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
  /** 会話の全文と記事はFeedで読む。開きたい投稿だけを預けてからFeedへ渡す。 */
  function openFeedPost(postId: string) {
    requestFeedPostFocus(postId);
    navigate("feed");
  }
  async function addTaskSection() {
    const title = sectionTitle.trim();
    if (!title) {
      setToast("セクション名を入力してください。", "warning");
      return;
    }
    const section = buildTaskSection({
      title,
      themeId: theme.id,
      sortOrder: taskSections.length,
    });
    await saveEntities(
      [{ action: "save", type: "view", entity: section as SaveOperation["entity"] }],
      "セクションを追加しました。",
    );
    setSectionTitle("");
  }
  async function renameTaskSection(section: TaskSection) {
    const title = window.prompt("セクション名", section.title)?.trim();
    if (!title) return;
    await saveEntities(
      [{ action: "save", type: "view", entity: { ...section, title } as SaveOperation["entity"] }],
      "セクション名を更新しました。",
    );
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
        note_type: "prompt",
        content_format: "markdown",
        title: `${theme.name} 報告書プロンプト`,
        body_markdown: `${theme.name} の活動を、対象期間に沿って簡潔な報告書として整理してください。`,
        properties_json: {
          prompt_purpose: "report",
          prompt_variables: "themeName, periodStart, periodEnd",
          is_default: false,
          ai_export_enabled: true,
        },
      },
    });
  }
  function editPrompt(prompt: BaseRecord) {
    openDrawer({ type: "note", mode: "edit", entity: prompt });
  }
  async function publishAiPack() {
    if (!aiPack || aiPackPublishing) return;
    setAiPackPublishing(true);
    setAiPackError("");
    try {
      const result = await workspaceApi.publishThemeAiPack(theme.id, aiPack.contentHash);
      if (result.state === "stale_preview") {
        setToast("Previewが古くなりました。生成内容を確認し直してください。", "warning");
      } else if (["current", "skipped", "current_with_warning"].includes(result.state)) {
        setToast(
          result.state === "skipped" ? "AI Packは最新です。" : "AI Packを更新しました。",
          "success",
        );
      } else {
        setToast(
          result.error || "AI Packを更新できませんでした。保存先を確認して再試行してください。",
          "warning",
        );
      }
      setAiPack(await workspaceApi.previewThemeAiPack(theme.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI Packを更新できませんでした。";
      setAiPackError(message);
      setToast(`${message} 保存先を確認して再試行してください。`, "danger");
    } finally {
      setAiPackPublishing(false);
    }
  }

  async function openAiPackFolder() {
    try {
      const result = await workspaceApi.openThemeAiPackFolder(theme.id);
      if (!result.ok) setToast(result.error || "AI Packフォルダを開けませんでした。", "warning");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "AI Packフォルダを開けませんでした。",
        "danger",
      );
    }
  }

  return (
    <div className="page theme-page">
      {/* 見出しと三つの主操作は、どの面にいても同じ位置に置く。 */}
      <PageHeader title={theme.name} subtitle={theme.description}>
        {theme.code && <span className="theme-code">{theme.code}</span>}
        <Button variant="ai" onClick={() => openContextPack(theme.id)}>
          <AI_ICON size={16} />
          AI向けContext
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: theme.id } })
          }
        >
          現在地を記録
        </Button>
        <ActionButton
          action="themeAddTask"
          onClick={() =>
            openDrawer({ type: "task", mode: "edit", entity: { project_id: theme.id } })
          }
        >
          タスクを追加
        </ActionButton>
      </PageHeader>

      <div className="theme-tabs" role="tablist" aria-label="Themeの切り替え">
        {THEME_TABS.map((entry) => (
          <button
            key={entry.id}
            id={`theme-tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`theme-panel-${entry.id}`}
            className={tab === entry.id ? "is-active" : undefined}
            onClick={() => selectTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div
          id="theme-panel-overview"
          role="tabpanel"
          aria-labelledby="theme-tab-overview"
          className="theme-tab-panel"
        >
          <ThemeIntentPanel
            theme={theme}
            edit={() => openDrawer({ type: "theme", mode: "edit", entity: theme })}
          />

          {/* 出典がある分だけ出す。無ければ欄ごと出さず、空の見出しを残さない。 */}
          {(latest || latestReport || themeKnowledgeNodes.length > 0) && (
            <section className="panel theme-known-panel">
              <div className="section-heading">
                <h2>いま分かっていること</h2>
              </div>
              <div className="theme-known-list">
                {latest && (
                  <button
                    className="theme-known-row"
                    onClick={() =>
                      openDrawer({ type: "status_update", mode: "edit", entity: latest })
                    }
                  >
                    <span className="theme-known-source">現在地 {formatDate(latest.date)}</span>
                    <strong>{latest.summary}</strong>
                  </button>
                )}
                {latestReport && (
                  <button
                    className="theme-known-row"
                    onClick={() => openDrawer({ type: "note", mode: "edit", entity: latestReport })}
                  >
                    <span className="theme-known-source">
                      報告書 更新{" "}
                      {formatDate(str(latestReport.updated_at || latestReport.created_at))}
                    </span>
                    <strong>{str(latestReport.title) || "無題"}</strong>
                    <p>
                      {compactNotesBodyPreview(latestReport.body_markdown, 120) ||
                        "本文はまだありません"}
                    </p>
                  </button>
                )}
                {themeKnowledgeNodes.map((node) => (
                  <button
                    key={node.id}
                    className="theme-known-row"
                    onClick={() =>
                      openDrawer({ type: "knowledge_node", mode: "view", entity: node })
                    }
                  >
                    <span className="theme-known-source">Knowledge</span>
                    <strong>{node.title || "無題"}</strong>
                    <p>{KNOWLEDGE_NODE_LABELS[String(node.node_type || "")] || node.node_type}</p>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="section-heading">
              <h2>現在地</h2>
              <span>{latest ? formatDate(latest.date) : "未記録"}</span>
            </div>
            {latest ? (
              <div className="status-summary">
                <StatusBadge
                  value={latest.status}
                  label={
                    THEME_STATUS_LABELS[String(latest.status || "")] ||
                    String(latest.status || "未設定")
                  }
                />
                <strong>{latest.summary}</strong>
                {latest.risks && <p>{latest.risks}</p>}
                {latest.next_actions && (
                  <p>
                    <b>次:</b> {latest.next_actions}
                  </p>
                )}
              </div>
            ) : (
              <EmptyState
                title="現在地がまだありません"
                action="記録する"
                onAction={() =>
                  openDrawer({
                    type: "status_update",
                    mode: "edit",
                    entity: { theme_id: theme.id },
                  })
                }
              />
            )}
          </section>

          <section className="panel theme-next-tasks">
            <div className="section-heading">
              <h2>次の仕事</h2>
              <span>{openTasks.length}件</span>
              {/* 追加の入口はヘッダーに常時ある。ここでは二重に置かない。 */}
              <button className="text-button compact" onClick={() => navigate("todo")}>
                ToDoへ
              </button>
            </div>
            {overviewTasks.length ? (
              <ul className="theme-task-list">
                {overviewTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      className="theme-task-check"
                      aria-label={`${task.title}を完了にする`}
                      title="完了にする"
                      onClick={() => void completeTask(task)}
                    />
                    <button
                      className="theme-task-main"
                      onClick={() =>
                        openDrawer({
                          type: "task",
                          entity: {
                            ...task,
                            _schedule: schedulesMap.get(`task:${task.id}`),
                          } as Record<string, unknown>,
                        })
                      }
                    >
                      <strong>{task.title}</strong>
                      <span>
                        {formatDate(schedulesMap.get(`task:${task.id}`)?.end_date) || "予定なし"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="未完了のタスクはありません" />
            )}
          </section>

          <AgentWorkSummaryPanel
            domain={v2}
            themeId={theme.id}
            includeUnresolved
            limit={3}
            title="Recent AI work"
            openDrawer={openDrawer}
            saveEntities={saveEntities}
          />
          <div className="theme-ai-work-actions">
            <button
              type="button"
              className="text-button compact"
              onClick={() => navigate("debrief")}
            >
              Debriefで見る
            </button>
          </div>

          <section className="panel">
            <div className="section-heading">
              <h2>近いマイルストーン</h2>
              <button className="text-button compact" onClick={() => navigate("timeline")}>
                Timelineへ
              </button>
            </div>
            <SimpleRows
              records={overviewMilestones as unknown as BaseRecord[]}
              onOpen={(node) => openDrawer({ type: "plan_node", entity: node })}
              meta={(node) => formatDate(schedulesMap.get(`plan_node:${node.id}`)?.end_date)}
            />
          </section>

          {/*
            技術設定は日常の概要より後ろへ畳む（計画フェーズ4）。
            登録・Preview・更新・フォルダを開く操作は、開いた先でそのまま使える。
          */}
          <details className="theme-settings">
            <summary>連携と設定</summary>
            <section className="panel theme-repository-panel">
              <div className="section-heading">
                <div>
                  <h2>Repository</h2>
                  <span>AIセッションの作業場所とThemeを結びます。</span>
                </div>
                <Button
                  variant="secondary"
                  compact
                  onClick={() =>
                    openDrawer({
                      type: "theme",
                      mode: "edit",
                      entity: theme,
                      initialSection: "repository",
                    })
                  }
                >
                  登録・変更
                </Button>
              </div>
              {themeRepositories.length ? (
                <div className="theme-repository-list">
                  {themeRepositories.map((repository) => {
                    const isPrimary = theme.primary_repository_context_id === repository.id;
                    return (
                      <div className="theme-repository-row" key={repository.id}>
                        <IconFolder size={17} aria-hidden="true" />
                        <span>
                          <strong>
                            {repository.label || repository.repository_slug || "Repository"}
                          </strong>
                          <small>
                            {repository.local_path || repository.canonical_url || "場所未登録"}
                          </small>
                        </span>
                        {isPrimary && <span className="theme-repository-primary">Primary</span>}
                        {!repository.local_path && (
                          <small className="theme-repository-warning">
                            AIセッションの自動関連付けにはLocal pathが必要です。
                          </small>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="theme-repository-empty">
                  <strong>Repositoryが未登録です。</strong>
                  <span>
                    登録すると、この作業場所で集めたAIセッションをThemeへ関連付けやすくなります。
                  </span>
                </div>
              )}
            </section>

            <section
              className="panel theme-ai-pack-panel"
              aria-busy={aiPackLoading || aiPackPublishing}
            >
              <div className="section-heading">
                <div className="theme-ai-pack-title">
                  <h2>M365向け AI Pack</h2>
                  <IntegrationStatus
                    tone={aiPackStatusTone(aiPack?.state, aiPackPublishing || aiPackLoading)}
                    label={
                      aiPackPublishing
                        ? "更新中"
                        : aiPackLoading
                          ? "確認中"
                          : AI_PACK_STATE_LABELS[aiPack?.state || ""] || "確認できません"
                    }
                  />
                </div>
                <div className="inline-actions">
                  <Button
                    variant="secondary"
                    compact
                    onClick={() => setAiPackPreviewOpen((open) => !open)}
                    disabled={!aiPack || aiPackLoading}
                  >
                    {aiPackPreviewOpen ? "閉じる" : "Preview"}
                  </Button>
                  {aiPack?.canOpenFolder && (
                    <Button variant="secondary" compact onClick={() => void openAiPackFolder()}>
                      <IconFolder size={15} />
                      開く
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    compact
                    onClick={() => void publishAiPack()}
                    disabled={!aiPack || aiPackLoading || aiPackPublishing}
                  >
                    <IconRefresh size={15} />
                    {aiPackPublishing ? "更新中" : aiPack?.retryPending ? "再試行" : "更新"}
                  </Button>
                </div>
              </div>
              {aiPackLoading && !aiPack && <p className="field-help">生成内容を確認しています。</p>}
              {aiPackError && (
                <p className="form-error">{aiPackError} 保存先を確認して再試行してください。</p>
              )}
              {aiPack && (
                <div className="theme-ai-pack-summary">
                  <span>{aiPack.files.length} files</span>
                  <span>{aiPack.includedCount}件を収録</span>
                  <span>{aiPack.excludedCount}件を除外</span>
                  <span>{aiPack.totalCharacterCount.toLocaleString("ja-JP")}文字</span>
                  {aiPack.lastPublishedAt && (
                    <span>最終生成 {formatDate(aiPack.lastPublishedAt)}</span>
                  )}
                  {aiPack.warnings.length > 0 && (
                    <span className="danger-text">警告 {aiPack.warnings.length}件</span>
                  )}
                </div>
              )}
              {aiPackPreviewOpen && aiPack && (
                <div className="theme-ai-pack-preview">
                  {(aiPack.excludedReasons.length > 0 || aiPack.warnings.length > 0) && (
                    <div className="theme-ai-pack-notices">
                      {aiPack.excludedReasons.map((reason) => (
                        <span key={`${reason.type}:${reason.reason}`}>
                          {reason.type}: {reason.reason} ({reason.count})
                        </span>
                      ))}
                      {aiPack.warnings.map((warning) => (
                        <span key={`${warning.kind}:${warning.type}:${warning.id}`}>
                          {warning.title}: {warning.reason}
                        </span>
                      ))}
                    </div>
                  )}
                  {aiPack.files.map((file) => (
                    <details key={file.name} className="theme-ai-pack-file">
                      <summary>
                        <strong>{file.name}</strong>
                        <span>
                          {file.includedCount}件 / {file.characterCount.toLocaleString("ja-JP")}
                          文字
                        </span>
                      </summary>
                      <pre>{file.content}</pre>
                    </details>
                  ))}
                </div>
              )}
            </section>

            {/* 公開範囲の確認も技術設定なので、同じ折り畳みへ置いて入口を失わない。 */}
            <AiContextPreviewPanel
              scope={{ type: "theme", id: theme.id }}
              data={data}
              openDrawer={openDrawer}
            />
          </details>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div
          id="theme-panel-tasks"
          role="tabpanel"
          aria-labelledby="theme-tab-tasks"
          className="theme-tab-panel"
        >
          {/* 未完了と完了を横並びにして、これからやることとやったことを同時に見る。 */}
          <div className="dashboard-grid theme-task-grid">
            <section className="panel">
              <div className="section-heading">
                <h2>未完了</h2>
                <span>{openTasks.length}件</span>
                <button className="text-button compact" onClick={() => navigate("todo")}>
                  ToDoへ
                </button>
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
                        onClick={() =>
                          openDrawer({
                            type: "task",
                            entity: {
                              ...task,
                              _schedule: schedulesMap.get(`task:${task.id}`),
                            } as Record<string, unknown>,
                          })
                        }
                      >
                        <strong>{task.title}</strong>
                        <span>
                          {formatDate(schedulesMap.get(`task:${task.id}`)?.end_date) || "予定なし"}
                        </span>
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
                <button className="text-button compact" onClick={() => navigate("todo")}>
                  完了一覧へ
                </button>
              </div>
              {doneTasks.length ? (
                <ul className="theme-task-list is-done">
                  {doneTasks.map((task) => (
                    <li key={task.id}>
                      <button
                        className="theme-task-main"
                        onClick={() =>
                          openDrawer({
                            type: "task",
                            entity: {
                              ...task,
                              _schedule: schedulesMap.get(`task:${task.id}`),
                            } as Record<string, unknown>,
                          })
                        }
                      >
                        <strong>{task.title}</strong>
                        {/* 完了時刻はActivity（#315）と同じ値を出す。 */}
                        <time
                          dateTime={str(task.completed_at || task.updated_at || task.created_at)}
                        >
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

          <section className="panel task-sections-panel">
            <div className="section-heading">
              <h2>タスクセクション</h2>
              <span>{taskSections.length}件</span>
            </div>
            <div className="section-create-row">
              <input
                value={sectionTitle}
                onChange={(event) => setSectionTitle(event.target.value)}
                placeholder="見出し名"
              />
              <Button variant="secondary" compact onClick={addTaskSection}>
                追加
              </Button>
            </div>
            <TaskSectionBoard
              groups={taskSectionGroups}
              schedulesMap={schedulesMap}
              collapsedSections={collapsedSections}
              onToggleCollapse={toggleTaskSection}
              onOpenTask={(task) =>
                openDrawer({
                  type: "task",
                  entity: { ...task, _schedule: schedulesMap.get(`task:${task.id}`) } as Record<
                    string,
                    unknown
                  >,
                })
              }
              onRename={renameTaskSection}
              onDelete={deleteTaskSection}
            />
          </section>
        </div>
      ) : null}

      {tab === "posts" ? (
        <div
          id="theme-panel-posts"
          role="tabpanel"
          aria-labelledby="theme-tab-posts"
          className="theme-tab-panel"
        >
          <section className="panel theme-posts-panel">
            <div className="section-heading">
              <h2>投稿</h2>
              <span>{themeFeedPosts.length}件</span>
            </div>
            {themeFeedPosts.length ? (
              <ul className="theme-post-list">
                {themeFeedPosts.map((post) => {
                  const author = authorOf(post);
                  const article = post.attachment;
                  const replyCount = themeReplyCounts.get(post.id) || 0;
                  return (
                    <li className="theme-post" key={post.id}>
                      <span
                        className={`feed-avatar feed-avatar-${author.kind} feed-avatar-${author.id}`}
                        aria-hidden="true"
                      >
                        {author.initial}
                      </span>
                      <div className="theme-post-main">
                        <div className="theme-post-head">
                          <span className="theme-post-author">{author.label}</span>
                          {author.kind === "ai" ? <span className="feed-ai-badge">AI</span> : null}
                          <time className="theme-post-time" dateTime={post.createdAt}>
                            {relativeTimeLabel(post.createdAt)}
                          </time>
                          <span className="theme-post-kind">
                            {FEED_POST_KIND_LABELS[post.kind]}
                          </span>
                        </div>
                        {post.paragraphs.map((paragraph, index) => (
                          <p className="theme-post-text" key={`${post.id}-${index}`}>
                            {paragraph}
                          </p>
                        ))}
                        <div className="theme-post-foot">
                          <span className="theme-post-replies">返信 {replyCount}件</span>
                          {article?.articleBody?.length || article?.articleMarkdown ? (
                            <Button variant="ghost" compact onClick={() => openFeedPost(post.id)}>
                              記事を読む
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="このThemeの投稿はまだありません。" />
            )}
          </section>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div
          id="theme-panel-notes"
          role="tabpanel"
          aria-labelledby="theme-tab-notes"
          className="theme-tab-panel"
        >
          <section className="panel report-section">
            <div className="section-heading">
              <h2>報告書・重要文書</h2>
              <div className="inline-actions">
                {reportNotes.length > REPORT_PREVIEW_LIMIT && (
                  <button className="text-button compact" onClick={() => navigate("notes")}>
                    すべて表示
                  </button>
                )}
                {defaultPrompt ? (
                  <>
                    <Button
                      variant="secondary"
                      compact
                      onClick={() =>
                        copyNoteText(defaultPrompt, "報告書プロンプトをコピーしました。")
                      }
                    >
                      <IconCopy size={15} />
                      プロンプトをコピー
                    </Button>
                    <Button variant="secondary" compact onClick={() => editPrompt(defaultPrompt)}>
                      <IconPencil size={15} />
                      プロンプトを編集
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" compact onClick={addPrompt}>
                    <IconMessage2Plus size={15} />
                    プロンプトを追加
                  </Button>
                )}
                <ActionButton action="themeAddReport" compact onClick={addReport}>
                  報告書を追加
                </ActionButton>
              </div>
            </div>
            <div className="report-list">
              {reportNotes.slice(0, REPORT_PREVIEW_LIMIT).map((note) => {
                const props = noteProps(note);
                const reportType = str(props.report_type) || "weekly";
                return (
                  <div className="report-row" key={note.id}>
                    <button
                      onClick={() => openDrawer({ type: "note", mode: "edit", entity: note })}
                    >
                      <strong>{note.title}</strong>
                      <span>
                        {REPORT_TYPE_LABELS[reportType] || reportType}
                        {" / "}
                        {formatDate(str(props.period_start))} - {formatDate(str(props.period_end))}
                        {" / 更新 "}
                        {formatDate(str(note.updated_at || note.created_at))}
                      </span>
                    </button>
                    <Button
                      variant="secondary"
                      compact
                      className="icon-only"
                      onClick={() => copyNoteText(note, "報告書本文をコピーしました。")}
                      aria-label={`${note.title}の本文をコピー`}
                      title="本文をコピー"
                    >
                      <IconCopy size={15} />
                    </Button>
                  </div>
                );
              })}
              {!reportNotes.length && (
                <EmptyState
                  title="報告書はまだありません"
                  action="報告書を追加"
                  onAction={addReport}
                />
              )}
            </div>
          </section>

          {/* タイトルだけでは思い出せないので、本文の書き出しを見せる。 */}
          <section className="panel theme-recent-notes">
            <div className="section-heading">
              <h2>最近のNote</h2>
              <span>{recentNotes.length}件</span>
              <button className="text-button compact" onClick={() => navigate("notes")}>
                Notesへ
              </button>
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
                    <p>
                      {compactNotesBodyPreview(note.body_markdown, 160) || "本文はまだありません"}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="このThemeのNoteはまだありません" />
            )}
          </section>

          <section className="panel theme-artifacts">
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
              headingExtra={
                <button className="text-button compact" onClick={() => navigate("artifacts")}>
                  一覧へ
                </button>
              }
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
