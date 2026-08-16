import { useState } from "react";
import { IconArrowsMaximize, IconClock, IconCopyPlus, IconFileTypePdf, IconFolder, IconMicrophone, IconPencil, IconTrash } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import { workspaceApi } from "../../../services/workspaceApi";
import { useUiStore } from "../../../stores/uiStore";
import { noteExportSignature } from "../../../../../shared/fileExport";
import { canonicalThemeId } from "../../../../../shared/themeRef.mjs";
import { normalizeExternalReferences } from "../../../../../shared/externalReference.mjs";
import type {
  BaseRecord,
  DrawerConfig,
  ExecuteCommand,
  KnowledgeNode,
  Note,
  OpenContentViewer,
  RemoveEntity,
  SaveEntities,
  SaveEntity,
  SaveOperation,
  Sketch,
  WorkspaceData,
} from "../types";
import { KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS, NOTE_TYPE_LABELS, NOTE_TYPE_OPTIONS, THEME_STATUS_LABELS, relatedEntityTitle, uiNoteType } from "../lib/domain";
import { dateOnly, formatDate, localDateIso, num, str, uuid } from "../lib/format";
import { notePublishEnabled } from "../lib/io";
import { normalizeTaskShelf } from "../lib/taskShelves";
import { buildKnowledgeLinkContext } from "../lib/knowledgeLinks";
import { sketchCanvasMode } from "../lib/sketch";
import {
  escapeHtml,
  HEADING_NUMBER_LEVELS,
  HEADING_NUMBER_LEVEL_LABELS,
  headingNumberOptionsFromProperties,
  normalizeHeadingNumberLevels,
  normalizeHeadingNumberStart,
  outlookHtml,
  previewDocument,
  previewHtml,
  renderedText,
  type HeadingNumberLevel,
} from "../lib/markdown";
import { renderMermaidDocumentForPdf } from "../lib/mermaid";
import { PROMPT_PURPOSE_LABELS, promptPurpose, promptVariables, isDefaultPrompt } from "../lib/prompts";
import { CHAT_SERVICE_LABELS, CHAT_SERVICE_TYPES, isKnownChatService, resolveChatService } from "../lib/chatServices";
import { isConversationMarkdown } from "../lib/conversationParser";
import type { AiAudience } from "../../../../../shared/aiMetadata.mjs";
import type { CommandEnvelope } from "../../../../../shared/applicationCommand";
import { AiContextFields, AiContextSummary, ThemeAiVisibilityField, workspaceAiVisibility } from "./aiContext";
import { ArtifactSection } from "./artifacts";
import { AiContextPreviewPanel } from "./AiContextPreviewPanel";
import { ConversationPreview } from "./ConversationPreview";
import { LineagePanel } from "./LineagePanel";
import {
  CaptureEntryFields,
  findSchedule,
  PlanNodeFields,
  TaskFields,
  WaitingFields,
} from "./drawerEntityFields";
import { MarkdownPreview } from "./MarkdownPreview";
import { DrawerHeader, Field, StatusBadge, ThemePickerSelect, ThemeSelect, type CloseDrawer } from "./common";
import { ChecklistProgressBadge } from "./taskChecklist";
import { ChatGroupPicker, ThemeColorPicker, ThemeGroupPicker, ThemeStorageRootField } from "./drawerPickers";
import { ThemeRepositoryContextFields } from "./repositoryContextFields";
import {
  TASK_STATE_LABELS,
  TASK_WORK_STATE_LABELS,
  EXTERNAL_REFERENCE_KIND_LABELS,
  WAITING_STATE_LABELS,
  PLAN_NODE_TYPE_LABELS,
  PLAN_NODE_STATE_LABELS,
  CAPTURE_ENTRY_STATE_LABELS,
} from "../domain-model/labels";
import {
  buildSaveTaskOperations,
  buildSaveScheduleOperations,
  buildSaveWaitingOperations,
  buildSavePlanNodeOperations,
} from "../domain-model/persistence";
import { duplicateTask } from "../domain-model/taskDuplication";
import { buildCompleteTaskOperations, repeatRuleLabel } from "../domain-model/taskRecurrence";
import type { CaptureEntry, PlanNode, Reference, Resource, Schedule, Task, WorkReceipt, Waiting } from "../domain-model/types";
import { normalizeReminderDateTime } from "../lib/reminders";
import { listTaskSections, normalizeTaskSectionId } from "../lib/taskSections";

const CHAT_REFERENCE_STATUSES = ["inbox", "adopted"];
const CHAT_REFERENCE_STATUS_LABELS: Record<string, string> = {
  inbox: "未整理",
  adopted: "採用",
};
const normalizeReferenceStatus = (value: unknown) => str(value) === "adopted" ? "adopted" : "inbox";
const initialChatLinkType = (value: unknown) => {
  const normalized = str(value);
  if (isKnownChatService(normalized)) return normalized;
  return "";
};
const isChatReferenceEntity = (entity: Record<string, unknown>) => (
  isKnownChatService(entity.link_type) ||
  resolveChatService({ link_type: entity.link_type, url: entity.url }) !== "other" ||
  Boolean(entity.reference_status || entity.chat_group)
);
const chatDateInput = (value: unknown): string => {
  const raw = str(value);
  if (raw.length > 10 && !Number.isNaN(Date.parse(raw))) return localDateIso(new Date(raw));
  return dateOnly(raw);
};
const PRIMARY_KNOWLEDGE_NODE_TYPES = ["question", "claim", "evidence", "decision"];
const REPEAT_FREQUENCY_LABELS = {
  daily: "毎日",
  weekly: "毎週",
  monthly: "毎月",
};
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const REPORT_TYPE_LABELS: Record<string, string> = {
  weekly: "週報",
  monthly: "月報",
  milestone: "節目報告",
  ad_hoc: "その他",
};

type SaveForm = (event: React.FormEvent<HTMLFormElement>) => void;
type RegisterEditForm = (form: HTMLFormElement | null) => void;

interface EntityDrawerProps {
  drawer: DrawerConfig;
  data: WorkspaceData;
  close: CloseDrawer;
  saveForm: SaveForm;
  registerEditForm: RegisterEditForm;
  isFormDirty: boolean;
  removeEntity: RemoveEntity;
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
  registerChecklistSave: (promise: Promise<boolean>) => void;
  markChecklistSaved: () => void;
  markChecklistDraftChange: () => void;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  executeCommand?: ExecuteCommand;
  openContentViewer?: OpenContentViewer;
  startFocusSession?: (taskId: string) => void;
  navigate: (route: string) => void;
}

function DerivedSourceReference({
  data,
  entityType,
  entityId,
  openSource,
}: {
  data: WorkspaceData;
  entityType: "task" | "note";
  entityId: string;
  openSource: (note: Note) => void;
}) {
  const reference = ((data.references || []) as unknown as Reference[]).find((entry) => (
    entry.source_type === entityType
    && entry.source_id === entityId
    && entry.target_type === "note"
    && entry.relation_type === "derived_from"
  ));
  if (!reference) return null;
  const source = data.notes.find((note) => note.id === reference.target_id);
  if (!source) return null;
  return (
    <section className="derived-source-card">
      <span>元の文書</span>
      <button type="button" className="text-button compact" onClick={() => openSource(source)}>
        {source.title || "無題"}
      </button>
      {reference.source_heading && <small>見出し: {reference.source_heading}</small>}
      {reference.source_excerpt && <blockquote>{reference.source_excerpt}</blockquote>}
    </section>
  );
}

function splitWorkLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function receiptExternalReferences(receipt: WorkReceipt) {
  try {
    return normalizeExternalReferences(receipt.external_references);
  } catch {
    return [];
  }
}

function TaskWorkSection({
  task,
  receipts,
  executeCommand,
  setToast,
}: {
  task: Task;
  receipts: WorkReceipt[];
  executeCommand?: ExecuteCommand;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}) {
  const [summary, setSummary] = useState("");
  const [completedItems, setCompletedItems] = useState("");
  const [changedItems, setChangedItems] = useState("");
  const [verification, setVerification] = useState("");
  const [remainingWork, setRemainingWork] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const workState = task.work_state || (task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated");
  const sortedReceipts = [...receipts].filter((receipt) => receipt.task_id === task.id).sort((a, b) => b.reported_at.localeCompare(a.reported_at));
  const expectedVersion = Number((task as unknown as Record<string, unknown>).version || 0);
  const executorKind = task.intended_executor === "ai_agent" ? "ai_agent" : task.intended_executor === "human" ? "human" : "self";
  const executorLabel = task.executor_identity || (executorKind === "ai_agent" ? "AI agent" : executorKind === "human" ? "人" : "自分");
  const hasWorkHistory = sortedReceipts.length > 0;
  const hasDelegatedWork = task.requester !== "self"
    || task.intended_executor !== "self"
    || workState !== "not_delegated"
    || hasWorkHistory;
  const [workOpen, setWorkOpen] = useState(hasWorkHistory || workState !== "not_delegated");
  const run = async (name: CommandEnvelope["name"], payload: CommandEnvelope["payload"], message: string) => {
    if (!executeCommand || busy) return;
    setBusy(true);
    try {
      await executeCommand({
        commandId: uuid(),
        name,
        payload,
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [{ type: "task", id: task.id, version: expectedVersion }],
        issuedAt: new Date().toISOString(),
      } as CommandEnvelope);
      setToast(message, "success");
      setSummary("");
      setCompletedItems("");
      setChangedItems("");
      setVerification("");
      setRemainingWork("");
      setReviewNote("");
    } catch (error) {
      setToast(`Work stateを更新できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setBusy(false);
    }
  };
  const report = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = summary.trim();
    if (!trimmed) {
      setToast("報告の概要を入力してください。", "warning");
      return;
    }
    const reportedAt = new Date().toISOString();
    void run("ReportTaskDone", {
      taskId: task.id,
      receipt: {
        id: uuid(),
        task_id: task.id,
        executor_kind: executorKind,
        executor_label: executorLabel,
        started_at: task.work_started_at || reportedAt,
        reported_at: reportedAt,
        summary: trimmed,
        completed_items: splitWorkLines(completedItems),
        changed_or_created_items: splitWorkLines(changedItems),
        verification: splitWorkLines(verification),
        remaining_work: splitWorkLines(remainingWork),
        source_session: null,
      },
    }, "Work Receiptを追加しました。人間の確認待ちです。");
  };
  if (!executeCommand || !hasDelegatedWork) return null;
  return (
    <details className="drawer-subsection drawer-disclosure task-work-disclosure" open={workOpen} onToggle={(event) => setWorkOpen(event.currentTarget.open)}>
      <summary aria-labelledby="task-work-heading">
        <span className="drawer-disclosure-title" id="task-work-heading">作業履歴</span>
        <span className="drawer-disclosure-meta">担当: {executorLabel}</span>
        <StatusBadge value={workState} label={TASK_WORK_STATE_LABELS[workState as keyof typeof TASK_WORK_STATE_LABELS] || workState} />
      </summary>
      <div className="drawer-disclosure-body">
      {sortedReceipts.length > 0 ? (
        <div className="task-learning-list" aria-label="Work Receipt一覧">
          {sortedReceipts.map((receipt) => (
            <article className="task-learning-item" key={receipt.id}>
              <div className="section-heading"><strong>{receipt.executor_label}</strong><small>{formatDate(receipt.reported_at)}</small></div>
              <p>{receipt.summary}</p>
              {receipt.completed_items?.length > 0 && <p><strong>完了:</strong> {receipt.completed_items.join("、")}</p>}
              {receipt.changed_or_created_items?.length > 0 && <p><strong>変更・作成:</strong> {receipt.changed_or_created_items.join("、")}</p>}
              {receipt.verification?.length ? <p><strong>検証:</strong> {receipt.verification.join("、")}</p> : null}
              {receipt.remaining_work?.length ? <p><strong>残り:</strong> {receipt.remaining_work.join("、")}</p> : null}
              {receiptExternalReferences(receipt).length > 0 && (
                <div className="task-work-external-references" aria-label="External references">
                  {receiptExternalReferences(receipt).map((reference) => (
                    <a key={`${reference.kind}:${reference.url}`} href={reference.url} target="_blank" rel="noreferrer" title={EXTERNAL_REFERENCE_KIND_LABELS[reference.kind]}>
                      {reference.display_label}
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : <p className="field-help">まだ作業報告はありません。</p>}
      {!["done", "cancelled"].includes(task.state) && !["accepted", "reported_done", "needs_human_review", "in_progress"].includes(workState) && (
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void run("StartTaskWork", { taskId: task.id, executorKind, executorIdentity: task.executor_identity || null }, "作業を開始しました。")}>作業を開始する</button>
      )}
      {workState === "in_progress" && (
        <form className="form-grid" onSubmit={report}>
          <Field label="報告の概要"><textarea value={summary} onChange={(event) => setSummary(event.target.value)} required /></Field>
          <Field label="完了した項目"><textarea value={completedItems} onChange={(event) => setCompletedItems(event.target.value)} placeholder="1行1項目" /></Field>
          <Field label="変更・作成した項目"><textarea value={changedItems} onChange={(event) => setChangedItems(event.target.value)} placeholder="1行1項目" /></Field>
          <Field label="検証"><textarea value={verification} onChange={(event) => setVerification(event.target.value)} placeholder="1行1項目" /></Field>
          <Field label="残りの作業"><textarea value={remainingWork} onChange={(event) => setRemainingWork(event.target.value)} placeholder="1行1項目" /></Field>
          <button className="primary-button" type="submit" disabled={busy}>報告を追加する</button>
        </form>
      )}
      {(["reported_done", "needs_human_review"].includes(workState)) && sortedReceipts[0] && (
        <div className="drawer-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={() => void run("AcceptTaskWork", { taskId: task.id }, "Work Receiptを確認しました。Taskを完了できます。")}>確認して受け入れる</button>
          <Field label="差戻し理由"><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} required /></Field>
          <button className="secondary-button" type="button" disabled={busy || !reviewNote.trim()} onClick={() => void run("ReturnTaskWork", { taskId: task.id, reviewNote }, "Work Receiptを差し戻しました。")}>差し戻す</button>
        </div>
      )}
      </div>
    </details>
  );
}

export function EntityDrawer({ drawer, data, close, saveForm, registerEditForm, isFormDirty, removeEntity, saveEntity, saveEntities, registerChecklistSave, markChecklistSaved, markChecklistDraftChange, setToast, executeCommand, openContentViewer, startFocusSession, navigate }: EntityDrawerProps) {
  const entity = drawer.entity || {};
  if (drawer.mode === "edit") {
    return (
      <EditDrawer
        drawer={drawer}
        data={data}
        close={close}
        saveForm={saveForm}
        registerEditForm={registerEditForm}
        isFormDirty={isFormDirty}
        removeEntity={removeEntity}
        saveEntities={saveEntities}
        registerChecklistSave={registerChecklistSave}
        markChecklistSaved={markChecklistSaved}
        markChecklistDraftChange={markChecklistDraftChange}
        setToast={setToast}
        executeCommand={executeCommand}
        openContentViewer={openContentViewer}
        startFocusSession={startFocusSession}
      />
    );
  }
  const type = drawer.type;
  if (type === "note") {
    return (
      <NoteDetailDrawer
        note={entity as Note}
        data={data}
        close={close}
        removeEntity={removeEntity}
        saveEntity={saveEntity}
        saveEntities={saveEntities}
        setToast={setToast}
        openContentViewer={openContentViewer}
      />
    );
  }
  if (type === "knowledge_node") return <KnowledgeNodeDetailDrawer node={entity as KnowledgeNode} data={data} close={close} />;
  if (type === "knowledge_edge") return <KnowledgeEdgeDetailDrawer edge={entity as unknown as import("../domain-model/types").KnowledgeEdge} data={data} close={close} />;
  if (type === "sketch") {
    const sketch = entity as unknown as Sketch;
    return (
      <DetailDrawer
        title="Sketch詳細"
        close={close}
        onEdit={() => close({ type: "sketch", mode: "edit", entity })}
        onOpenCanvas={navigate ? () => {
          localStorage.setItem("tasken:sketch:active-id", sketch.id);
          navigate("sketch-editor");
        } : undefined}
      >
        <div className="badge-row">
          <StatusBadge
            value="neutral"
            label={sketchCanvasMode(sketch.document) === "infinite" ? "Infinite Canvas" : `${sketch.document.pages.length}ページ`}
          />
          {sketch.origin_capture_id && <StatusBadge value="neutral" label="Ink Capture" />}
        </div>
        <h2>{sketch.title || "無題のSketch"}</h2>
        <Field label="Theme">
          <ThemePickerSelect
            themes={data.themes}
            value={sketch.project_id || ""}
            onChange={async (next) => {
              try {
                await saveEntity("sketch", {
                  ...sketch,
                  project_id: canonicalThemeId(next),
                });
                setToast("SketchのThemeを更新しました。", "success");
              } catch (error) {
                setToast(`Themeを更新できませんでした。もう一度選択してください。${error instanceof Error ? ` ${error.message}` : ""}`, "danger");
              }
            }}
            allowPersonal
            allowNone
            ariaLabel="SketchのTheme"
          />
        </Field>
        <dl>
          <dt>作成</dt><dd>{formatDate(sketch.created_at)}</dd>
          <dt>更新</dt><dd>{formatDate(sketch.updated_at)}</dd>
        </dl>
        <LineagePanel
          data={data}
          seed={{ type: "sketch", id: sketch.id }}
          openDrawer={(next) => close(next)}
          openContentViewer={openContentViewer}
        />
        <AiContextSummary type="sketch" entity={entity} themes={data.themes} workspaceDefault={workspaceAiVisibility(data)} />
      </DetailDrawer>
    );
  }
  if (type === "resource") {
    const isChatRef = isChatReferenceEntity(entity);
    const service = resolveChatService({ link_type: entity.link_type, url: entity.url });
    const themeName = (data.themes || []).find((t) => t.id === (entity.project_id || entity.theme_id))?.name || "未設定";
    const resourceId = str(entity.id);
    const relatedTasks = ((data.references || []) as unknown as Reference[])
      .filter((reference) => (
        reference.source_type === "resource" &&
        reference.source_id === resourceId &&
        reference.target_type === "task"
      ) || (
        reference.target_type === "resource" &&
        reference.target_id === resourceId &&
        reference.source_type === "task"
      ))
      .map((reference) => reference.source_type === "task" ? reference.source_id : reference.target_id)
      .map((taskId) => ((data.tasks || []) as unknown as Task[]).find((task) => task.id === taskId))
      .filter((task): task is Task => Boolean(task));
    return (
      <DetailDrawer
        title={isChatRef ? "リンク詳細" : "リソース詳細"}
        close={close}
        onEdit={() => close({ type: "resource", mode: "edit", entity })}
        onDelete={() => removeEntity("resource", entity)}
      >
        {isChatRef && (
          <div className="badge-row">
            <StatusBadge value="neutral" label={CHAT_SERVICE_LABELS[service]} />
            <StatusBadge value={normalizeReferenceStatus(entity.reference_status)} label={CHAT_REFERENCE_STATUS_LABELS[normalizeReferenceStatus(entity.reference_status)]} />
            {Boolean(entity.archived_at) && <StatusBadge value="paused" label="Archive" />}
          </div>
        )}
        <h2>{str(entity.title)}</h2>
        {Boolean(entity.url) && <a href={str(entity.url)} target="_blank" rel="noreferrer">{str(entity.url)}</a>}
        <dl>
          <dt>Theme</dt><dd>{themeName}</dd>
          {isChatRef && (
            <>
              <dt>グループ</dt><dd>{str(entity.chat_group) || "未分類"}</dd>
              {Boolean(entity.archived_at) && (
                <>
                  <dt>Archive</dt>
                  <dd>保管中（削除・グループ解除とは別）</dd>
                </>
              )}
            </>
          )}
          {relatedTasks.length > 0 && (
            <>
              <dt>関連タスク</dt>
              <dd>
                <div className="drawer-related-list">
                  {relatedTasks.map((task) => (
                    <button
                      key={task.id}
                      className="text-button compact"
                      onClick={() => close({ type: "task", entity: { ...task, _schedule: findSchedule(data, "task", task.id) } as Record<string, unknown> })}
                    >
                      {task.title}
                    </button>
                  ))}
                </div>
              </dd>
            </>
          )}
        </dl>
        {Boolean(entity.description) && <p>{str(entity.description)}</p>}
        {Boolean(entity.body_markdown) && (
          isChatRef && isConversationMarkdown(str(entity.body_markdown))
            ? <ConversationPreview body={str(entity.body_markdown)} />
            : <MarkdownPreview className="markdown-preview" html={previewHtml(str(entity.body_markdown), "markdown")} />
        )}
        <LineagePanel
          data={data}
          seed={{ type: "resource", id: resourceId }}
          conversation={isChatRef}
          openDrawer={(next) => close(next)}
          openContentViewer={openContentViewer}
        />
        {isChatRef && (
          <>
            <div className="lineage-create-actions" aria-label="この会話から作成">
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => close({
                  type: "task",
                  mode: "edit",
                  entity: {
                    project_id: entity.project_id || entity.theme_id || null,
                    _lineage_source_type: "resource",
                    _lineage_source_id: resourceId,
                    _lineage_reference_id: uuid(),
                  },
                })}
              >
                Taskを作る
              </button>
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => close({
                  type: "note",
                  mode: "edit",
                  entity: {
                    project_id: entity.project_id || entity.theme_id || null,
                    note_type: "note",
                    _lineage_source_type: "resource",
                    _lineage_source_id: resourceId,
                    _lineage_reference_id: uuid(),
                  },
                })}
              >
                Noteを作る
              </button>
            </div>
          </>
        )}
        <AiContextSummary type="resource" entity={entity} themes={data.themes} workspaceDefault={workspaceAiVisibility(data)} />
        {isChatRef && (
          <ArtifactSection
            sourceType="chat_ref"
            sourceId={resourceId}
            themeId={str(entity.project_id || entity.theme_id) || null}
            artifacts={data.artifacts || []}
            data={data}
            openDrawer={(next) => close(next)}
            openContentViewer={openContentViewer}
            saveEntities={saveEntities}
            removeEntity={removeEntity}
            setToast={setToast}
          />
        )}
      </DetailDrawer>
    );
  }
  if (type === "task") {
    const task = ((data.tasks || []) as unknown as Task[]).find((candidate) => candidate.id === entity.id) || entity as unknown as Task;
    const schedule = findSchedule(data, "task", task.id, entity._schedule);
    const themeName = (data.themes || []).find((t) => t.id === task.project_id)?.name || "個人業務";
    const completionNote = str((entity as Record<string, unknown>).completion_note);
    const taskWorkState = task.work_state || (task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated");
    const requiresHumanAcceptance = task.intended_executor === "ai_agent" && taskWorkState !== "accepted";
    const learningNotes = (data.notes || [])
      .filter((note) => note.item_id === task.id && note.note_type === "learning")
      .sort((a, b) => str(b.created_at || b.updated_at).localeCompare(str(a.created_at || a.updated_at)));
    const copyTask = async () => {
      const duplicated = duplicateTask(task, schedule);
      const ops = buildSaveTaskOperations(duplicated.task, { reason: "duplicated" });
      if (duplicated.schedule) {
        ops.push(...buildSaveScheduleOperations(duplicated.schedule, { reason: "duplicated" }));
      }
      await saveEntities(ops, "タスクを複製しました。");
      close({ type: "task", mode: "edit", entity: { ...duplicated.task, _schedule: duplicated.schedule } as Record<string, unknown> });
    };
    const addLearningNote = async (completeTask = false) => {
      const learning = window.prompt("この作業で気づいたこと・学んだこと", "");
      const operations: SaveOperation[] = [];
      if (completeTask) operations.push(...buildCompleteTaskOperations(task, schedule));
      if (learning?.trim()) {
        operations.push({
          action: "save",
          type: "note",
          entity: {
            id: uuid(),
            title: `学び: ${task.title}`,
            body_markdown: learning.trim(),
            note_type: "learning",
            content_format: "markdown",
            project_id: task.project_id || "theme-personal-default",
            item_id: task.id,
            properties_json: { activity_date: todayIso(), source_task_id: task.id },
            created_at: new Date().toISOString(),
          },
        });
      }
      if (!operations.length) return;
      await saveEntities(operations, completeTask ? "完了と学びを保存しました。" : "学びを保存しました。");
      if (completeTask) close();
    };
    return (
      <aside className="drawer">
        <DrawerHeader title="タスク詳細" close={close} />
        <div className="drawer-content">
          <div className="badge-row">
            <StatusBadge value={task.state} label={TASK_STATE_LABELS[task.state]} />
            {task.priority === "high" && <StatusBadge value="review" label="優先" />}
            {task.repeat_rule && <StatusBadge value="doing" label={repeatRuleLabel(task.repeat_rule)} />}
          </div>
          <h2>{task.title}</h2>
          <p>{task.description || "説明なし"}</p>
          {Boolean(task.checklist_items?.length) && (
            <>
              <div className="task-checklist-detail-heading">
                <strong>チェックリスト</strong>
                <ChecklistProgressBadge items={task.checklist_items} />
              </div>
              <ul className="task-checklist-detail">
                {task.checklist_items?.map((item) => (
                  <li key={item.id} className={item.done ? "is-done" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={async () => {
                          const nextItems = (task.checklist_items || []).map((entry) => entry.id === item.id
                            ? { ...entry, done: !entry.done, completed_at: !entry.done ? new Date().toISOString() : null }
                            : entry);
                          await saveEntities(buildSaveTaskOperations({ ...task, checklist_items: nextItems }), "チェックリストを保存しました。");
                        }}
                      />
                      <span>{item.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <dl>
            <dt>Theme</dt><dd>{themeName}</dd>
            <dt>予定</dt><dd>{`${formatDate(schedule?.start_date)} - ${formatDate(schedule?.end_date)}`}</dd>
            {/* 完了時のひとことは本文と分けて保存する（#308）。 */}
            {completionNote && (<><dt>完了時のひとこと</dt><dd>{completionNote}</dd></>)}
          </dl>
          <TaskWorkSection task={task} receipts={(data.work_receipts || []) as unknown as import("../domain-model/types").WorkReceipt[]} executeCommand={executeCommand} setToast={setToast} />
          <details className="drawer-subsection drawer-disclosure task-related-disclosure">
            <summary>
              <span className="drawer-disclosure-title">関連情報</span>
              <span className="drawer-disclosure-meta">系譜・AI・学び・成果物</span>
            </summary>
            <div className="drawer-disclosure-body">
          <DerivedSourceReference
            data={data}
            entityType="task"
            entityId={task.id}
            openSource={(source) => close({ type: "note", entity: source })}
          />
          <LineagePanel
            data={data}
            seed={{ type: "task", id: task.id }}
            openDrawer={(next) => close(next)}
            openContentViewer={openContentViewer}
          />
          <AiContextPreviewPanel
            scope={{ type: "task", id: task.id }}
            data={data}
            openDrawer={(next) => close(next)}
          />
          <section className="task-learning-section">
            <div className="section-heading">
              <h3>気づき・学び</h3>
              <button className="text-button compact" onClick={() => addLearningNote(false)}>追加</button>
            </div>
            {learningNotes.length ? (
              <div className="task-learning-list">
                {learningNotes.map((note) => (
                  <div className="task-learning-item" key={note.id}>
                    <strong>{note.title}</strong>
                    <p>{str(note.body_markdown)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="field-help">完了時や作業後の気づきを、このタスクに紐づけて残せます。</p>
            )}
          </section>
          <ArtifactSection
            sourceType="task"
            sourceId={task.id}
            themeId={task.project_id || null}
            artifacts={data.artifacts || []}
            data={data}
            openContentViewer={openContentViewer}
            saveEntities={saveEntities}
            removeEntity={removeEntity}
            setToast={setToast}
          />
          <AiContextSummary type="task" entity={entity} themes={data.themes} workspaceDefault={workspaceAiVisibility(data)} />
            </div>
          </details>
          <div className="drawer-actions">
            <button className="primary-button" onClick={() => startFocusSession?.(task.id)}><IconClock size={16} />集中して作業する</button>
            <button className="secondary-button" onClick={() => close({ type: "task", mode: "edit", entity: { ...entity, _schedule: schedule } })}><IconPencil size={16} />編集する</button>
            <button className="secondary-button" onClick={copyTask}><IconCopyPlus size={16} />複製する</button>
            <button className="secondary-button" disabled={requiresHumanAcceptance} title={requiresHumanAcceptance ? "AIの報告を人間が確認してから完了できます。" : undefined} onClick={async () => {
              const nextState = task.state === "done" ? "todo" : "done";
              const message = nextState === "done" && task.repeat_rule ? "完了しました。次のタスクを作成しました。" : nextState === "done" ? "完了しました。" : "未完了に戻しました。";
              await saveEntities(buildCompleteTaskOperations(task, schedule), message);
              close();
            }}>{task.state === "done" ? "未完了に戻す" : requiresHumanAcceptance ? "確認してから完了" : "完了にする"}</button>
            {task.state !== "done" && <button className="secondary-button" disabled={requiresHumanAcceptance} onClick={() => addLearningNote(true)}>完了して学びを書く</button>}
            <button className="danger-button" onClick={() => removeEntity("task", entity)}><IconTrash size={16} />削除する</button>
          </div>
        </div>
      </aside>
    );
  }
  if (type === "waiting") {
    const waiting = entity as unknown as Waiting;
    const schedule = findSchedule(data, "waiting", waiting.id, entity._schedule);
    const themeName = (data.themes || []).find((t) => t.id === waiting.project_id)?.name || "個人業務";
    return (
      <aside className="drawer">
        <DrawerHeader title="待ち詳細" close={close} />
        <div className="drawer-content">
          <div className="badge-row">
            <StatusBadge value={waiting.state} label={WAITING_STATE_LABELS[waiting.state]} />
          </div>
          <h2>{waiting.title}</h2>
          <dl>
            <dt>相手</dt><dd>{waiting.waiting_for}</dd>
            <dt>Theme</dt><dd>{themeName}</dd>
            <dt>期限</dt><dd>{formatDate(schedule?.end_date)}</dd>
          </dl>
          {waiting.description && <p>{waiting.description}</p>}
          <LineagePanel
            data={data}
            seed={{ type: "waiting", id: waiting.id }}
            openDrawer={(next) => close(next)}
            openContentViewer={openContentViewer}
          />
          <AiContextSummary type="waiting" entity={entity} themes={data.themes} workspaceDefault={workspaceAiVisibility(data)} />
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => close({ type: "waiting", mode: "edit", entity: { ...entity, _schedule: schedule } })}><IconPencil size={16} />編集する</button>
            {waiting.state === "waiting" ? (
              <>
                <button className="primary-button" onClick={async () => {
                  await saveEntities(buildSaveWaitingOperations({ ...waiting, state: "received" }), "受領しました。");
                  close();
                }}>受領する</button>
                <button className="secondary-button" onClick={async () => {
                  await saveEntities(buildSaveWaitingOperations({ ...waiting, state: "cancelled" }), "中止しました。");
                  close();
                }}>中止する</button>
              </>
            ) : (
              <button className="secondary-button" onClick={async () => {
                await saveEntities(buildSaveWaitingOperations({ ...waiting, state: "waiting" }), "待ちに戻しました。");
                close();
              }}>待ちに戻す</button>
            )}
            <button className="danger-button" onClick={() => removeEntity("waiting", entity)}><IconTrash size={16} />削除する</button>
          </div>
        </div>
      </aside>
    );
  }
  if (type === "plan_node") {
    const planNode = entity as unknown as PlanNode;
    const schedule = findSchedule(data, "plan_node", planNode.id, entity._schedule);
    const themeName = (data.themes || []).find((t) => t.id === planNode.project_id)?.name || "個人業務";
    return (
      <aside className="drawer">
        <DrawerHeader title={`${PLAN_NODE_TYPE_LABELS[planNode.type]}詳細`} close={close} />
        <div className="drawer-content">
          <div className="badge-row">
            <StatusBadge value={planNode.state} label={PLAN_NODE_STATE_LABELS[planNode.state]} />
            <StatusBadge value="neutral" label={PLAN_NODE_TYPE_LABELS[planNode.type]} />
          </div>
          <h2>{planNode.title}</h2>
          <p>{planNode.description || "説明なし"}</p>
          <dl>
            <dt>Theme</dt><dd>{themeName}</dd>
            <dt>予定</dt><dd>{`${formatDate(schedule?.start_date)} - ${formatDate(schedule?.end_date)}`}</dd>
          </dl>
          <LineagePanel
            data={data}
            seed={{ type: "plan_node", id: planNode.id }}
            openDrawer={(next) => close(next)}
            openContentViewer={openContentViewer}
          />
          <AiContextSummary type="plan_node" entity={entity} themes={data.themes} workspaceDefault={workspaceAiVisibility(data)} />
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => close({ type: "plan_node", mode: "edit", entity: { ...entity, _schedule: schedule } })}><IconPencil size={16} />編集する</button>
            <button className="primary-button" onClick={async () => {
              const nextState = planNode.state === "done" ? "planned" : "done";
              await saveEntities(buildSavePlanNodeOperations({ ...planNode, state: nextState }), nextState === "done" ? "完了しました。" : "未完了に戻しました。");
              close();
            }}>{planNode.state === "done" ? "未完了に戻す" : "完了にする"}</button>
            <button className="danger-button" onClick={() => removeEntity("plan_node", entity)}><IconTrash size={16} />削除する</button>
          </div>
        </div>
      </aside>
    );
  }
  if (type === "capture_entry") {
    const entry = entity as unknown as CaptureEntry;
    return (
      <aside className="drawer">
        <DrawerHeader title="キャプチャ詳細" close={close} />
        <div className="drawer-content">
          <StatusBadge value={entry.state} label={CAPTURE_ENTRY_STATE_LABELS[entry.state]} />
          <h2>{entry.title || entry.text}</h2>
          <dl><dt>記録日</dt><dd>{formatDate(entry.captured_at)}</dd></dl>
          <LineagePanel
            data={data}
            seed={{ type: "capture_entry", id: entry.id }}
            openDrawer={(next) => close(next)}
            openContentViewer={openContentViewer}
          />
          <AiContextSummary type="capture_entry" entity={entity} themes={data.themes} workspaceDefault={workspaceAiVisibility(data)} />
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => close({ type: "capture_entry", mode: "edit", entity })}><IconPencil size={16} />編集する</button>
            <button className="danger-button" onClick={() => removeEntity("capture_entry", entity)}><IconTrash size={16} />削除する</button>
          </div>
        </div>
      </aside>
    );
  }
  return (
    <EditDrawer
      drawer={{ ...drawer, mode: "edit" }}
      data={data}
      close={close}
      saveForm={saveForm}
      registerEditForm={registerEditForm}
      isFormDirty={isFormDirty}
      removeEntity={removeEntity}
      saveEntities={saveEntities}
      registerChecklistSave={registerChecklistSave}
      markChecklistSaved={markChecklistSaved}
      markChecklistDraftChange={markChecklistDraftChange}
      setToast={setToast}
      openContentViewer={openContentViewer}
      navigate={navigate}
    />
  );
}
function EditDrawer({
  drawer,
  data,
  close,
  saveForm,
  registerEditForm,
  isFormDirty,
  removeEntity,
  saveEntities,
  registerChecklistSave,
  markChecklistSaved,
  markChecklistDraftChange,
  setToast,
  executeCommand: _executeCommand,
  openContentViewer,
  startFocusSession,
  navigate,
}: {
  drawer: DrawerConfig;
  data: WorkspaceData;
  close: CloseDrawer;
  saveForm: SaveForm;
  registerEditForm: RegisterEditForm;
  isFormDirty: boolean;
  removeEntity?: RemoveEntity;
  saveEntities?: SaveEntities;
  registerChecklistSave: (promise: Promise<boolean>) => void;
  markChecklistSaved: () => void;
  markChecklistDraftChange: () => void;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  executeCommand?: ExecuteCommand;
  openContentViewer?: OpenContentViewer;
  startFocusSession?: (taskId: string) => void;
  navigate?: (route: string) => void;
}) {
  const type = drawer.type;
  const entity = drawer.entity;
  const typeLabels: Record<string, string> = {
    item: "タスク",
    theme: "Theme",
    note: "メモ",
    resource: "リソース",
    status_update: "現在地",
    knowledge_node: "Knowledge",
    knowledge_edge: "Knowledge Edge",
    task: "タスク",
    waiting: "待ち",
    plan_node: "計画ノード",
    capture_entry: "キャプチャ",
    sketch: "Sketch",
  };
  const kindLabel = typeLabels[type] || type;
  const title = `${entity.id ? "編集" : "追加"}: ${kindLabel}`;
  const entityId = str(entity.id);
  const editFormId = "drawer-edit-form";
  const taskFormEntity = type === "task"
    ? (((data.tasks || []) as unknown as Task[]).find((candidate) => candidate.id === entityId)
      ? {
        ...((data.tasks || []) as unknown as Task[]).find((candidate) => candidate.id === entityId),
        ...entity,
      }
      : entity) as unknown as DrawerConfig["entity"]
      : entity;
  const taskChecklistEditorKey = type === "task"
    ? `${entityId}:${str(entity._focusChecklistItem)}:${JSON.stringify(taskFormEntity.checklist_items || [])}`
    : "";
  const workspaceAiVisibilityDefault = workspaceAiVisibility(data);
  const requestInboxRecorder = useUiStore((state) => state.requestInboxRecorder);
  // Chat/Task/Note は常用が edit 直行なので、作業面として Artifact を同じドロワーに置く。
  const artifactSource = (() => {
    if (!entityId || !saveEntities || !removeEntity) return null;
    if (type === "task") {
      return { sourceType: "task" as const, sourceId: entityId, themeId: str(entity.project_id) || null };
    }
    if (type === "note") {
      const isReport = str(entity.note_type) === "report";
      return {
        sourceType: (isReport ? "report" : "note") as "report" | "note",
        sourceId: entityId,
        themeId: str(entity.theme_id) || null,
      };
    }
    if (type === "capture_entry") {
      return {
        sourceType: "capture_entry" as const,
        sourceId: entityId,
        themeId: str(entity.project_id || entity.theme_id) || null,
      };
    }
    if (type === "resource" && isChatReferenceEntity(entity)) {
      return {
        sourceType: "chat_ref" as const,
        sourceId: entityId,
        themeId: str(entity.project_id || entity.theme_id) || null,
      };
    }
    return null;
  })();
  return (
    <aside className="drawer">
      <DrawerHeader title={title} close={close} />
      <form id={editFormId} ref={registerEditForm} className="drawer-form" data-entity-type={type} onSubmit={saveForm} key={`${type}:${entityId || "new"}:${str(entity.theme_id)}:${str(entity.parent_item_id)}`}>
        {type === "task" && entityId && (
          <button className="secondary-button" type="button" onClick={() => startFocusSession?.(entityId)}>
            <IconClock size={16} />集中して作業する
          </button>
        )}
        {type === "theme" && (
          <>
            <Field label="テーマ名"><input name="name" autoFocus defaultValue={str(entity.name)} /></Field>
            <Field label="識別子"><input name="code" defaultValue={str(entity.code)} placeholder="例: MAT-A" /></Field>
            <Field label="概要"><textarea name="description" defaultValue={str(entity.description)} /></Field>
            <ThemeColorPicker value={str(entity.color)} />
            <ThemeGroupPicker value={str(entity.group)} themes={data.themes} />
            <ThemeStorageRootField value={str(entity.storage_root)} setToast={setToast} />
            <ThemeRepositoryContextFields entity={entity} data={data} saveEntities={saveEntities} removeEntity={removeEntity} />
            <ThemeAiVisibilityField
              value={entity.default_ai_visibility as AiAudience[] | null | undefined}
              workspaceDefault={workspaceAiVisibilityDefault}
            />
          </>
        )}
        {type === "note" && <NoteFields entity={entity} data={data} />}
        {type === "resource" && <ResourceFields entity={entity} data={data} />}
        {type === "status_update" && (
          <>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
            <Field label="日付"><input name="date" type="date" defaultValue={str(entity.date) || todayIso()} /></Field>
            <Field label="状態"><select name="status" defaultValue={str(entity.status) || "on_track"}>{Object.entries(THEME_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="概要"><textarea name="summary" autoFocus defaultValue={str(entity.summary)} /></Field>
            <Field label="進捗"><input name="progress" type="number" min="0" max="100" defaultValue={num(entity.progress)} /></Field>
            <Field label="リスク"><textarea name="risks" defaultValue={str(entity.risks)} /></Field>
            <Field label="次アクション"><textarea name="next_actions" defaultValue={str(entity.next_actions)} /></Field>
          </>
        )}
        {type === "knowledge_node" && <KnowledgeNodeFields entity={entity} data={data} />}
        {type === "knowledge_edge" && <KnowledgeEdgeFields entity={entity} data={data} />}
        {type === "task" && (
          <TaskFields
            key={taskChecklistEditorKey}
            entity={taskFormEntity}
            data={data}
            saveEntities={saveEntities}
            onChecklistSavePending={registerChecklistSave}
            onChecklistSaved={markChecklistSaved}
            onChecklistDraftChange={markChecklistDraftChange}
          />
        )}
        {type === "waiting" && <WaitingFields entity={entity} data={data} />}
        {type === "plan_node" && <PlanNodeFields entity={entity} data={data} />}
        {type === "capture_entry" && (
          <>
            {!entityId && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  // 録音の入口はStudioへ移した（#383）。手数を増やさないよう導線は残す。
                  close();
                  navigate?.("studio");
                  requestInboxRecorder();
                }}
              >
                <IconMicrophone size={16} />マイクで録音
              </button>
            )}
            <CaptureEntryFields entity={entity} />
          </>
        )}
        {type === "sketch" && (
          <>
            <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
            <ThemeSelect themes={data.themes} value={str(entity.project_id)} fieldName="project_id" />
            {entity.id && (
              <dl className="sketch-drawer-meta">
                <dt>ページ</dt>
                <dd>
                  {entity.document && sketchCanvasMode(entity.document as Sketch["document"]) === "infinite"
                    ? "Infinite Canvas"
                    : `${(entity.document as Sketch["document"] | undefined)?.pages.length || 1}ページ`}
                </dd>
                <dt>更新</dt>
                <dd>{formatDate(entity.updated_at)}</dd>
              </dl>
            )}
          </>
        )}
        {/* AI共通metadata（#294）。通常編集の主目的を圧迫しないよう折りたたみで置く。 */}
        <AiContextFields
          type={type}
          entity={entity}
          themes={data.themes}
          workspaceDefault={workspaceAiVisibilityDefault}
        />
      </form>
      {type === "task" && entityId && (
        <TaskWorkSection
          task={((data.tasks || []) as unknown as Task[]).find((candidate) => candidate.id === entityId) || entity as unknown as Task}
          receipts={(data.work_receipts || []) as unknown as WorkReceipt[]}
          executeCommand={_executeCommand}
          setToast={setToast}
        />
      )}
      <div className="drawer-edit-footer">
        <div className="drawer-edit-actions">
          <button className="primary-button" form={editFormId} type="submit" disabled={!isFormDirty}>保存する</button>
          {entityId && removeEntity && (
            <button
              className="danger-button"
              type="button"
              onClick={() => removeEntity(type as Parameters<RemoveEntity>[0], entity)}
            >
              <IconTrash size={16} />削除
            </button>
          )}
        </div>
        {artifactSource && saveEntities && removeEntity && (
          <ArtifactSection
            sourceType={artifactSource.sourceType}
            sourceId={artifactSource.sourceId}
            themeId={artifactSource.themeId}
            artifacts={data.artifacts || []}
            data={data}
            openDrawer={(next) => close(next)}
            openContentViewer={openContentViewer}
            saveEntities={saveEntities}
            removeEntity={removeEntity}
            setToast={setToast}
          />
        )}
      </div>
    </aside>
  );
}

function NoteFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const initialType = uiNoteType(str(entity.note_type) || "note");
  const [noteType, setNoteType] = useState(initialType);
  const properties = entity.properties_json && typeof entity.properties_json === "object" ? entity.properties_json as Record<string, unknown> : {};
  const legacyHeadingStart = normalizeHeadingNumberStart(properties.heading_number_start);
  const initialHeadingLevels = Object.prototype.hasOwnProperty.call(properties, "heading_number_levels")
    ? normalizeHeadingNumberLevels(properties.heading_number_levels)
    : HEADING_NUMBER_LEVELS.filter((level) => level >= legacyHeadingStart);
  const isReport = noteType === "report";
  const isPrompt = noteType === "prompt";
  const initialFormat = str(entity.content_format) || "markdown";
  const [contentFormat, setContentFormat] = useState(initialFormat);
  function chooseNoteType(next: string) {
    setNoteType(next);
    if (contentFormat === "plain") setContentFormat("markdown");
  }
  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <ThemeSelect themes={data.themes} value={str(entity.project_id ?? entity.theme_id)} allowPersonal />
      <Field label="種別">
        <select name="note_type" value={noteType} onChange={(event) => chooseNoteType(event.target.value)}>
          {NOTE_TYPE_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {isReport && (
        <div className="form-grid">
          <Field label="報告種別">
            <select name="report_type" defaultValue={str(properties.report_type) || "weekly"}>
              {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="対象開始"><input name="period_start" type="date" defaultValue={str(properties.period_start)} /></Field>
          <Field label="対象終了"><input name="period_end" type="date" defaultValue={str(properties.period_end)} /></Field>
        </div>
      )}
      {isPrompt && (
        <div className="form-grid">
          <Field label="用途">
            <select name="prompt_purpose" defaultValue={promptPurpose({ note_type: str(entity.note_type) || noteType, properties_json: properties })}>
              {Object.entries(PROMPT_PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="変数">
            <input name="prompt_variables" defaultValue={promptVariables({ properties_json: properties }) || "themeName, periodStart, periodEnd"} />
          </Field>
          <Field label="既定">
            <input type="hidden" name="prompt_is_default" value="false" />
            <label className="toggle">
              <input type="checkbox" name="prompt_is_default" value="true" defaultChecked={isDefaultPrompt({ properties_json: properties })} />
              この用途の既定にする
            </label>
          </Field>
        </div>
      )}
      <Field label="形式">
        <select name="content_format" value={contentFormat} onChange={(event) => setContentFormat(event.target.value)}>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="plain">Plain text</option>
        </select>
      </Field>
      {!isPrompt && (
        <Field label="出力設定">
          <input type="hidden" name="publish_enabled" value="false" />
          <label className="toggle">
            <input type="checkbox" name="publish_enabled" value="true" defaultChecked={properties.publish_enabled === true || properties.export_enabled === true} />
            一括出力の対象にする（Markdown / PDF）
          </label>
        </Field>
      )}
      {!isPrompt && contentFormat === "markdown" && (
        <Field label="見出し番号">
          <input type="hidden" name="heading_numbers" value="false" />
          <label className="toggle">
            <input type="checkbox" name="heading_numbers" value="true" defaultChecked={properties.heading_numbers === true} />
            編集・Preview・PDF に通し番号を表示（本文は書き換えない）
          </label>
          <div className="note-heading-level-form" aria-label="番号を付ける見出し">
            <input type="hidden" name="heading_number_levels_present" value="true" />
            <span>番号を付ける見出し</span>
            {HEADING_NUMBER_LEVELS.map((level) => (
              <label key={level}>
                <input
                  type="checkbox"
                  name="heading_number_levels"
                  value={level}
                  defaultChecked={initialHeadingLevels.includes(level)}
                />
                {HEADING_NUMBER_LEVEL_LABELS[level]}
              </label>
            ))}
          </div>
        </Field>
      )}
      <p className="field-help">本文は中央の編集エリアで書きます。</p>
    </>
  );
}

function ResourceFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const isChatRef = isChatReferenceEntity(entity);
  const allResources = [...(data.resources || []), ...data.links];
  const [projectId, setProjectId] = useState(canonicalThemeId(str(entity.project_id || entity.theme_id), { defaultPersonal: true }));
  const [url, setUrl] = useState(str(entity.url));
  const [linkType, setLinkType] = useState(initialChatLinkType(entity.link_type));
  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <Field label="URL"><input name="url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
      <ThemeSelect themes={data.themes} value={projectId} fieldName="project_id" allowPersonal onChange={setProjectId} />
      {isChatRef && (
        <>
          <ChatGroupPicker value={str(entity.chat_group)} resources={allResources as { chat_group?: string | null; project_id?: string | null; theme_id?: string | null }[]} projectId={projectId} />
          <Field label="元チャット">
            <select name="parent_resource_id" defaultValue={str(entity.parent_resource_id)}>
              <option value="">なし</option>
              {(allResources as Record<string, unknown>[])
                .filter((resource) => resource.id !== entity.id)
                .filter((resource) => str(resource.project_id || resource.theme_id) === projectId)
                .filter(isChatReferenceEntity)
                .map((resource) => (
                  <option key={str(resource.id)} value={str(resource.id)}>
                    {str(resource.title) || str(resource.url)}
                  </option>
                ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="サービス">
              <select name="link_type" value={linkType} onChange={(event) => setLinkType(event.target.value)}>
                <option value="">URLから推定</option>
                {CHAT_SERVICE_TYPES.map((value) => <option key={value} value={value}>{CHAT_SERVICE_LABELS[value]}</option>)}
                <option value="other">{CHAT_SERVICE_LABELS.other}</option>
              </select>
            </Field>
            <Field label="参照状態">
              <select name="reference_status" defaultValue={normalizeReferenceStatus(entity.reference_status)}>
                {CHAT_REFERENCE_STATUSES.map((value) => <option key={value} value={value}>{CHAT_REFERENCE_STATUS_LABELS[value]}</option>)}
              </select>
            </Field>
            <Field label="保存日"><input name="captured_at" type="date" defaultValue={chatDateInput(entity.captured_at || entity.created_at)} /></Field>
            <input type="hidden" name="captured_at_timestamp" value={str(entity.captured_at)} />
          </div>
        </>
      )}
      {isChatRef ? (
        <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
      ) : (
        <>
          <Field label="短い説明">
            <textarea name="description" defaultValue={str(entity.description)} rows={2} placeholder="一覧用の一行メモ（任意）" />
          </Field>
          <p className="field-help">メモ本文は中央の編集エリアで書きます。</p>
        </>
      )}
    </>
  );
}


function KnowledgeNodeFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const selectedNodeType = str(entity.node_type) || "question";
  const nodeTypeOptions = PRIMARY_KNOWLEDGE_NODE_TYPES.includes(selectedNodeType)
    ? PRIMARY_KNOWLEDGE_NODE_TYPES
    : [...PRIMARY_KNOWLEDGE_NODE_TYPES, selectedNodeType];
  return (
    <>
      <Field label="種類">
        <select name="node_type" defaultValue={selectedNodeType}>
          {nodeTypeOptions.map((value) => <option key={value} value={value}>{KNOWLEDGE_NODE_LABELS[value] || value}</option>)}
        </select>
      </Field>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
      <div className="form-grid">
        <Field label="確度">
          <select name="confidence" defaultValue={str(entity.confidence) || "medium"}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </Field>
        <Field label="状態">
          <select name="status" defaultValue={str(entity.status) || "active"}>
            <option value="active">active</option>
            <option value="resolved">resolved</option>
            <option value="deprecated">deprecated</option>
            <option value="rejected">rejected</option>
          </select>
        </Field>
      </div>
      <Field label="本文"><textarea className="large-textarea" name="body" defaultValue={str(entity.body)} /></Field>
      <KnowledgeSourceFields entity={entity} data={data} />
    </>
  );
}

const SOURCE_TYPE_LABELS: Record<string, string> = { note: "メモ", resource: "リソース", task: "タスク", waiting: "待ち", plan_node: "計画ノード" };

function resolveSourceType(entity: DrawerConfig["entity"]): string {
  if (entity.source_type) return str(entity.source_type);
  if (entity.source_note_id) return "note";
  if (entity.source_link_id) return "resource";
  if (entity.source_item_id) return "task";
  return "";
}

function resolveSourceId(entity: DrawerConfig["entity"]): string {
  if (entity.source_id) return str(entity.source_id);
  if (entity.source_note_id) return str(entity.source_note_id);
  if (entity.source_link_id) return str(entity.source_link_id);
  if (entity.source_item_id) return str(entity.source_item_id);
  return "";
}

function KnowledgeSourceFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const [sourceType, setSourceType] = useState(resolveSourceType(entity));
  const resourceIds = new Set((data.resources || []).map((r) => r.id));
  const candidates: Record<string, { id: string; title: string }[]> = {
    note: (data.notes || []).map((n) => ({ id: n.id, title: n.title })),
    resource: [
      ...(data.resources || []).map((r) => ({ id: r.id, title: str(r.title) })),
      ...(data.links || []).filter((l) => !resourceIds.has(l.id)).map((l) => ({ id: l.id, title: l.title })),
    ],
    task: (data.tasks || []).map((t) => ({ id: t.id, title: str(t.title) })),
    waiting: (data.waitings || []).map((w) => ({ id: w.id, title: str(w.title) })),
    plan_node: (data.plan_nodes || []).map((p) => ({ id: p.id, title: str(p.title) })),
  };
  const options = candidates[sourceType] || [];
  return (
    <div className="form-grid">
      <Field label="出典の種類">
        <select name="source_type" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
          <option value="">未設定</option>
          {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="出典">
        <select name="source_id" defaultValue={resolveSourceId(entity)} key={sourceType}>
          <option value="">未設定</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
      </Field>
    </div>
  );
}

function KnowledgeEdgeFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const nodes = data.knowledge_nodes || [];
  return (
    <>
      <Field label="関係元">
        <select name="source_node_id" defaultValue={str(entity.source_node_id)}>
          <option value="">選択</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
        </select>
      </Field>
      <Field label="関係種別">
        <select name="relation_type" defaultValue={str(entity.relation_type) || "supports"}>
          {Object.entries(KNOWLEDGE_RELATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="関係先">
        <select name="target_node_id" defaultValue={str(entity.target_node_id)}>
          <option value="">選択</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
        </select>
      </Field>
      <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
    </>
  );
}

function DetailDrawer({
  title,
  close,
  onEdit,
  onDelete,
  onOpenCanvas,
  children,
}: {
  title: string;
  close: CloseDrawer;
  onEdit: () => void;
  onDelete?: () => void;
  onOpenCanvas?: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="drawer">
      <DrawerHeader title={title} close={close} />
      <div className="drawer-content">
        {children}
        <div className="drawer-actions">
          {onOpenCanvas && <button className="secondary-button" onClick={onOpenCanvas}><IconArrowsMaximize size={16} />キャンバスを開く</button>}
          <button className="primary-button" onClick={onEdit}><IconPencil size={16} />編集する</button>
          {onDelete && <button className="danger-button" onClick={onDelete}><IconTrash size={16} />削除する</button>}
        </div>
      </div>
    </aside>
  );
}

function NoteDetailDrawer({
  note,
  data,
  close,
  removeEntity,
  saveEntity,
  saveEntities,
  setToast,
  openContentViewer,
}: {
  note: Note;
  data: WorkspaceData;
  close: CloseDrawer;
  removeEntity: RemoveEntity;
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  openContentViewer?: OpenContentViewer;
}) {
  const [comment, setComment] = useState("");
  const [artifactMode, setArtifactMode] = useState<"preview" | "raw">("preview");
  const [markdownExporting, setMarkdownExporting] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const comments = note.comments || [];
  const theme = data.themes.find((entry) => entry.id === note.theme_id);
  const contentFormat = str(note.content_format) || (note.note_type === "artifact" ? "markdown" : "plain");
  const isArtifact = note.note_type === "artifact" || ["markdown", "html"].includes(contentFormat);
  const body = note.body_markdown || "";
  const properties = note.properties_json && typeof note.properties_json === "object" ? note.properties_json as Record<string, unknown> : {};
  const headingNumberOptions = headingNumberOptionsFromProperties(properties);
  const headingNumberLevels = normalizeHeadingNumberLevels(headingNumberOptions.preview.headingNumberLevels);
  const headingNumberLevelSummary = headingNumberLevels.length ? headingNumberLevels.map((level) => `h${level}`).join("–") : "選択なし";
  const publishEnabled = notePublishEnabled(note);
  const isReport = note.note_type === "report";
  const reportType = str(properties.report_type) || "weekly";
  const reportTypeLabel = REPORT_TYPE_LABELS[reportType] || "報告";
  const periodStart = str(properties.period_start);
  const periodEnd = str(properties.period_end);
  const periodLabel = [periodStart, periodEnd].filter(Boolean).join(" - ");
  const markdownExport = properties.markdown_export && typeof properties.markdown_export === "object" && !Array.isArray(properties.markdown_export)
    ? properties.markdown_export as Record<string, unknown>
    : null;
  const currentExportSignature = noteExportSignature(body);
  const exportedSignature = str(markdownExport?.bodySignature);
  const hasMarkdownExportDirectory = Boolean(str(markdownExport?.directory));
  const markdownExportStale = Boolean(exportedSignature && exportedSignature !== currentExportSignature);
  const canExportDocument = contentFormat === "markdown" && Boolean(body.trim());
  const publishMarkdownBody = [
    "---",
    `title: ${JSON.stringify(note.title)}`,
    theme?.name ? `theme: ${JSON.stringify(theme.name)}` : "",
    str(note.updated_at || note.created_at) ? `updated_at: ${JSON.stringify(str(note.updated_at || note.created_at))}` : "",
    "---",
    "",
    body.trim(),
    "",
  ].filter((line) => line !== "").join("\n");
  const emailSubject = `${theme?.name ? `[${theme.name}] ` : ""}${note.title || reportTypeLabel}${periodLabel ? `（${periodLabel}）` : ""}`;
  const emailBody = [
    theme?.name ? `Theme: ${theme.name}` : "",
    `報告種別: ${reportTypeLabel}`,
    periodLabel ? `対象期間: ${periodLabel}` : "",
    "",
    renderedText(body, contentFormat),
  ].filter((line, index, lines) => line || lines[index - 1]).join("\n").trim();
  const emailBodyHtml = [
    theme?.name ? `<p style="margin:0 0 4px;color:#666;">Theme: ${escapeHtml(theme.name)}</p>` : "",
    `<p style="margin:0 0 4px;color:#666;">報告種別: ${escapeHtml(reportTypeLabel)}</p>`,
    periodLabel ? `<p style="margin:0 0 12px;color:#666;">対象期間: ${escapeHtml(periodLabel)}</p>` : "",
    outlookHtml(body, contentFormat),
  ].filter(Boolean).join("");

  async function copyReportEmail(kind: "subject" | "body" | "combined") {
    if (kind === "subject") {
      await workspaceApi.copyText(emailSubject);
    } else if (kind === "body") {
      await workspaceApi.copyHtml(emailBodyHtml, emailBody);
    } else {
      await workspaceApi.copyHtml(
        `<p style="margin:0 0 12px;"><strong>件名:</strong> ${escapeHtml(emailSubject)}</p>${emailBodyHtml}`,
        `件名: ${emailSubject}\n\n${emailBody}`,
      );
    }
    setToast(kind === "subject" ? "件名候補をコピーしました。" : kind === "combined" ? "件名とメール本文をコピーしました。" : "Outlook貼り付け用本文をコピーしました。", "success");
  }

  async function setPublishEnabled(next: boolean) {
    const saved = await saveEntity("note", {
      ...note,
      properties_json: {
        ...properties,
        publish_enabled: next,
      },
    });
    setToast(next ? "一括出力の対象にしました。" : "一括出力の対象から外しました。", "success");
    close({ type: "note", entity: saved });
  }

  async function updateHeadingNumberSettings(patch: { heading_numbers?: boolean; heading_number_levels?: HeadingNumberLevel[] }) {
    const nextEnabled = patch.heading_numbers ?? headingNumberOptions.preview.headingNumbers === true;
    const nextLevels = patch.heading_number_levels ?? headingNumberLevels;
    const saved = await saveEntity("note", {
      ...note,
      properties_json: {
        ...properties,
        heading_numbers: nextEnabled,
        heading_number_levels: nextLevels,
        heading_number_start: nextLevels[0] ?? normalizeHeadingNumberStart(headingNumberOptions.preview.headingNumberStart),
      },
    });
    if (patch.heading_numbers !== undefined && patch.heading_number_levels === undefined) {
      setToast(nextEnabled ? "見出し番号を表示します（Preview / PDF）。" : "見出し番号を非表示にしました。", "success");
    } else if (patch.heading_number_levels !== undefined) {
      setToast(`番号対象を${nextLevels.length ? nextLevels.map((level) => `h${level}`).join("・") : "なし"}にしました。`, "success");
    }
    close({ type: "note", entity: saved });
  }

  async function addComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = comment.trim();
    if (!body) return;
    const saved = await saveEntity("note", {
      ...note,
      comments: [...comments, { id: uuid(), body, created_at: new Date().toISOString() }],
    });
    setComment("");
    close({ type: "note", entity: saved });
  }

  async function removeComment(commentId: string) {
    const saved = await saveEntity("note", {
      ...note,
      comments: comments.filter((entry) => entry.id !== commentId),
    });
    close({ type: "note", entity: saved });
  }


  async function exportMarkdown(chooseDirectory: boolean) {
    if (!canExportDocument) return;
    setMarkdownExporting(true);
    try {
      const result = await workspaceApi.exportMarkdownFile({
        title: note.title,
        content: publishMarkdownBody,
        directory: str(markdownExport?.directory) || null,
        chooseDirectory,
        fileName: `${note.title || "markdown-document"}.md`,
        themeId: str(note.theme_id) || null,
      });
      if (result.canceled) {
        setToast("Markdown出力をキャンセルしました。", "info");
        return;
      }
      const saved = await saveEntity("note", {
        ...note,
        properties_json: {
          ...properties,
          markdown_export: {
            directory: result.directory,
            filePath: result.filePath,
            exportedAt: result.exportedAt,
            bodySignature: noteExportSignature(body),
          },
        },
      });
      setToast(`Markdownを保存しました。${result.filePath || ""}`, "success");
      close({ type: "note", entity: saved });
    } catch (error) {
      setToast(`Markdown出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setMarkdownExporting(false);
    }
  }

  async function exportPdf() {
    if (!canExportDocument) return;
    setPdfExporting(true);
    try {
      const result = await workspaceApi.exportMarkdownPdf({
        title: note.title,
        html: await renderMermaidDocumentForPdf(
          previewDocument(publishMarkdownBody, "markdown", headingNumberOptions.publish),
        ),
        chooseDirectory: true,
        fileName: `${note.title || "markdown-document"}.pdf`,
        themeId: str(note.theme_id) || null,
      });
      if (result.canceled) {
        setToast("PDF出力をキャンセルしました。", "info");
        return;
      }
      const warningText = result.warnings?.length ? `（注意: ${result.warnings[0]}${result.warnings.length > 1 ? ` 他${result.warnings.length - 1}件` : ""}）` : "";
      setToast(`PDFを出力しました。${result.filePath || ""}${warningText}`, result.warnings?.length ? "warning" : "success");
    } catch (error) {
      setToast(`PDF出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setPdfExporting(false);
    }
  }

  return (
    <aside className="drawer">
      <DrawerHeader title="メモ詳細" close={close} />
      <div className="drawer-content">
        <StatusBadge value="neutral" label={NOTE_TYPE_LABELS[note.note_type ?? ""] || note.note_type} />
        <h2>{note.title}</h2>
        <DerivedSourceReference
          data={data}
          entityType="note"
          entityId={note.id}
          openSource={(source) => close({ type: "note", entity: source })}
        />
        <LineagePanel
          data={data}
          seed={{ type: "note", id: note.id }}
          openDrawer={(next) => close(next)}
          openContentViewer={openContentViewer}
        />
        <section className={`document-rule-strip ${publishEnabled ? "is-export-target" : "is-export-muted"}`}>
          <div>
            <strong>{publishEnabled ? "一括出力対象" : "一括出力対象外"}</strong>
            <span>{publishEnabled ? "Markdown / PDF 一括出力の対象です。" : "文書出力の対象から外れています。"}</span>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={publishEnabled} onChange={(event) => setPublishEnabled(event.target.checked)} />
            対象
          </label>
        </section>
        {contentFormat === "markdown" && (
          <section className="document-rule-strip">
            <div>
              <strong>見出し番号</strong>
              <span>本文は書き換えず、Preview / PDF に通し番号を付けます。対象レベルだけ番号になります。</span>
            </div>
            <div className="document-publish-actions">
              <label className="toggle note-heading-number-toggle">
                <input
                  type="checkbox"
                  checked={headingNumberOptions.preview.headingNumbers === true}
                  onChange={(event) => updateHeadingNumberSettings({ heading_numbers: event.target.checked })}
                />
                表示する
              </label>
              {headingNumberOptions.preview.headingNumbers === true && (
                <details className="note-heading-level-picker">
                  <summary title="番号を付ける見出しレベル">{headingNumberLevelSummary}</summary>
                  <div className="note-heading-level-menu" aria-label="番号を付ける見出し">
                    {HEADING_NUMBER_LEVELS.map((level) => (
                      <label key={level}>
                        <input
                          type="checkbox"
                          checked={headingNumberLevels.includes(level)}
                          onChange={(event) => updateHeadingNumberSettings({
                            heading_number_levels: normalizeHeadingNumberLevels(
                              event.target.checked
                                ? [...headingNumberLevels, level]
                                : headingNumberLevels.filter((current) => current !== level),
                            ),
                          })}
                        />
                        {HEADING_NUMBER_LEVEL_LABELS[level]}
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>
        )}
        {note.source_url && <div className="link-value"><a href={note.source_url} target="_blank" rel="noreferrer">{note.source_url}</a></div>}
        {Boolean(body.trim()) && openContentViewer && (
          <div className="content-viewer-expand-row">
            <button
              type="button"
              className="primary-button compact"
              onClick={() => openContentViewer({ type: "note", noteId: note.id })}
            >
              <IconArrowsMaximize size={15} />大きく表示
            </button>
          </div>
        )}
        {isArtifact ? (
          <section className="artifact-preview-section">
            <div className="section-heading">
              <div className="segmented" aria-label="Markdown表示">
                <button className={artifactMode === "preview" ? "is-active" : ""} onClick={() => setArtifactMode("preview")}>Preview</button>
                <button className={artifactMode === "raw" ? "is-active" : ""} onClick={() => setArtifactMode("raw")}>Raw</button>
              </div>
              <button className="secondary-button compact" onClick={() => workspaceApi.copyText(body)}>Rawをコピー</button>
              <button className="secondary-button compact" onClick={() => workspaceApi.copyText(renderedText(body, contentFormat))}>Previewをコピー</button>
            </div>
            {artifactMode === "preview" ? (
              <iframe
                className="artifact-preview-frame"
                sandbox=""
                srcDoc={previewDocument(body, contentFormat, headingNumberOptions.preview)}
                title={`${note.title} preview`}
              />
            ) : (
              <pre className="artifact-raw">{body}</pre>
            )}
          </section>
        ) : (
          <p className="note-body">{note.body_markdown}</p>
        )}
        {isReport && (
          <section className="report-email-panel">
            <div className="section-heading">
              <h3>メール本文</h3>
            </div>
            <dl className="report-email-meta">
              <dt>件名候補</dt><dd>{emailSubject}</dd>
              {periodLabel && <><dt>対象期間</dt><dd>{periodLabel}</dd></>}
            </dl>
            <div className="document-publish-actions">
              <button className="secondary-button compact" onClick={() => copyReportEmail("subject")}>件名をコピー</button>
              <button className="secondary-button compact" onClick={() => copyReportEmail("body")}>Outlook本文をコピー</button>
              <button className="primary-button compact" onClick={() => copyReportEmail("combined")}>件名+本文をコピー</button>
            </div>
          </section>
        )}
        {canExportDocument && (
          <section className={`document-publish-panel ${markdownExportStale ? "needs-export" : ""}`}>
            <div className="document-publish-title">
              {(str(markdownExport?.filePath) || str(markdownExport?.directory)) && (
                <button
                  className="document-publish-open"
                  type="button"
                  title={str(markdownExport?.directory) || str(markdownExport?.filePath)}
                  aria-label="保存先フォルダを開く"
                  onClick={async () => {
                    const target = str(markdownExport?.directory) || str(markdownExport?.filePath);
                    if (!target) return;
                    const result = await workspaceApi.openPath(target);
                    if (result.ok) setToast("Markdownの保存先フォルダを開きました。", "success");
                    else setToast(result.error || "Markdownの保存先フォルダを開けませんでした。", "danger");
                  }}
                >
                  <IconFolder size={15} stroke={1.8} />
                </button>
              )}
              {markdownExportStale && <span className="save-status save-status-error">要再出力</span>}
            </div>
            <div className="document-publish-actions">
              <button className="primary-button compact" disabled={markdownExporting} onClick={() => exportMarkdown(false)}>
                {markdownExporting ? "保存中" : "保存"}
              </button>
              {hasMarkdownExportDirectory && (
                <button className="secondary-button compact" disabled={markdownExporting} onClick={() => exportMarkdown(true)} title="出力先フォルダを変更">
                  <IconFolder size={15} stroke={1.8} aria-hidden />
                  保存先を変更
                </button>
              )}
              <button className="secondary-button compact" disabled={pdfExporting} onClick={exportPdf} title="PDFを出力">
                <IconFileTypePdf size={15} stroke={1.8} aria-hidden />
                {pdfExporting ? "出力中" : "PDF"}
              </button>
            </div>
          </section>
        )}
        <ArtifactSection
          sourceType={isReport ? "report" : "note"}
          sourceId={str(note.id)}
          originNoteId={str(note.id)}
          themeId={note.theme_id || null}
          artifacts={data.artifacts || []}
          data={data}
          openDrawer={(next) => close(next)}
          openContentViewer={openContentViewer}
          saveEntities={saveEntities}
          removeEntity={removeEntity}
          setToast={setToast}
        />
        <section className="comment-thread">
          <h3>コメント {comments.length > 0 && `(${comments.length})`}</h3>
          {comments.length > 0 && (
            <div className="comment-list">
              {comments.map((entry) => (
                <div className="comment-item" key={entry.id}>
                  <div className="comment-body">{entry.body}</div>
                  <div className="comment-meta">
                    <time>{new Date(entry.created_at).toLocaleString("ja-JP")}</time>
                    <button className="text-button compact" onClick={() => removeComment(entry.id)}>削除する</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form className="comment-input" onSubmit={addComment}>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="補足や確認事項を残す" aria-label="コメント" />
            <button className="secondary-button compact" type="submit">コメントする</button>
          </form>
        </section>
        <AiContextSummary
          type="note"
          entity={note as unknown as Record<string, unknown>}
          themes={data.themes}
          workspaceDefault={workspaceAiVisibility(data)}
        />
        <div className="drawer-actions">
          <button className="primary-button" onClick={() => close({ type: "note", mode: "edit", entity: note })}><IconPencil size={16} />編集する</button>
          <button className="danger-button" onClick={() => removeEntity("note", note)}><IconTrash size={16} />削除する</button>
        </div>
      </div>
    </aside>
  );
}

function KnowledgeNodeDetailDrawer({
  node,
  data,
  close,
}: {
  node: KnowledgeNode;
  data: WorkspaceData;
  close: CloseDrawer;
}) {
  const relations = ((data.knowledge_edges || []) as unknown as import("../domain-model/types").KnowledgeEdge[]).filter((relation) => relation.source_node_id === node.id || relation.target_node_id === node.id);
  const linkContext = buildKnowledgeLinkContext(node as unknown as BaseRecord, {
    notes: data.notes as unknown as BaseRecord[],
    knowledge_nodes: data.knowledge_nodes as unknown as BaseRecord[],
  });
  const resourceIds = new Set((data.resources || []).map((r) => r.id));
  const allResources = [...(data.resources || []), ...(data.links || []).filter((l) => !resourceIds.has(l.id))];
  const allTasks = [...(data.tasks || []), ...(data.waitings || []), ...(data.plan_nodes || [])];
  const sourceLabel = (() => {
    if (node.source_type && node.source_id) {
      const typeLabel = SOURCE_TYPE_LABELS[node.source_type] || node.source_type;
      if (node.source_type === "note") { const n = data.notes.find((n) => n.id === node.source_id); return `${typeLabel}: ${n?.title || node.source_id}`; }
      if (node.source_type === "resource") { const r = allResources.find((r) => r.id === node.source_id); return `${typeLabel}: ${str(r?.title) || node.source_id}`; }
      const t = allTasks.find((t) => t.id === node.source_id); return `${typeLabel}: ${str(t?.title) || node.source_id}`;
    }
    if (node.source_note_id) return `メモ: ${data.notes.find((n) => n.id === node.source_note_id)?.title || "不明"}`;
    if (node.source_link_id) return `リソース: ${allResources.find((r) => r.id === node.source_link_id)?.title || "不明"}`;
    if (node.source_item_id) return `タスク: ${allTasks.find((t) => t.id === node.source_item_id)?.title || "不明"}`;
    return "未設定";
  })();

  return (
    <aside className="drawer">
      <DrawerHeader title="Knowledge詳細" close={close} />
      <div className="drawer-content">
        <div className="badge-row">
          <StatusBadge value={node.status} label={KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type} />
          <StatusBadge value="neutral" label={node.confidence || "medium"} />
        </div>
        <h2>{node.title}</h2>
        <p className="note-body">{node.body || "本文なし"}</p>
        <dl>
          <dt>Theme</dt><dd>{data.themes.find((theme) => theme.id === node.theme_id)?.name || "未設定"}</dd>
          <dt>出典</dt><dd>{sourceLabel}</dd>
        </dl>
        {relations.length > 0 && (
          <div className="revision-list">
            <h3>関係</h3>
            {relations.map((relation) => {
              const isSource = relation.source_node_id === node.id;
              const other = data.knowledge_nodes.find((entry) => entry.id === (isSource ? relation.target_node_id : relation.source_node_id));
              return (
                <div key={relation.id}>
                  <span>{isSource ? "→" : "←"} {relation.relation_type}: {str(other?.title) || "不明"}</span>
                </div>
              );
            })}
          </div>
        )}
        {linkContext.backlinks.length > 0 && (
          <div className="revision-list">
            <h3>Backlinks</h3>
            {linkContext.backlinks.map((entry) => (
              <div key={`${entry.type}-${entry.id}`}>
                <div className="knowledge-link-row">
                  <strong>{entry.title}</strong>
                  <span>{entry.type === "note" ? "Note" : "Knowledge"} / {entry.body.slice(0, 80) || "本文なし"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {linkContext.unlinkedMentions.length > 0 && (
          <div className="revision-list">
            <h3>未リンク候補</h3>
            {linkContext.unlinkedMentions.map((entry) => (
              <div className="knowledge-link-candidate" key={`${entry.type}-${entry.id}`}>
                <div className="knowledge-link-row">
                  <strong>{entry.title}</strong>
                  <span>{entry.type === "note" ? "Note" : "Knowledge"} / {entry.body.slice(0, 80) || "本文なし"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <LineagePanel
          data={data}
          seed={{ type: "knowledge_node", id: node.id }}
          openDrawer={(next) => close(next)}
        />
      </div>
    </aside>
  );
}

function KnowledgeEdgeDetailDrawer({
  edge,
  data,
  close,
}: {
  edge: import("../domain-model/types").KnowledgeEdge;
  data: WorkspaceData;
  close: CloseDrawer;
}) {
  const source = data.knowledge_nodes.find((node) => node.id === edge.source_node_id);
  const target = data.knowledge_nodes.find((node) => node.id === edge.target_node_id);
  return (
    <aside className="drawer">
      <DrawerHeader title="Knowledge Relation詳細" close={close} />
      <div className="drawer-content">
        <StatusBadge value="neutral" label="read-only" />
        <dl>
          <dt>関係元</dt><dd>{source?.title || edge.source_node_id || "不明"}</dd>
          <dt>関係種別</dt><dd>{KNOWLEDGE_RELATION_LABELS[edge.relation_type] || edge.relation_type || "未設定"}</dd>
          <dt>関係先</dt><dd>{target?.title || edge.target_node_id || "不明"}</dd>
        </dl>
        {edge.description && <p className="note-body">{edge.description}</p>}
        <p className="field-help">既存Relationの確認専用です。この画面からの追加・編集・削除は行いません。</p>
      </div>
    </aside>
  );
}
