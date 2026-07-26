import { useRef, useState } from "react";
import { IconArrowsMaximize, IconCopyPlus, IconFileTypePdf, IconFolder, IconPencil, IconTrash } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import { workspaceApi } from "../../../services/workspaceApi";
import { noteExportSignature } from "../../../../../shared/fileExport";
import type {
  BaseRecord,
  DrawerConfig,
  KnowledgeNode,
  Note,
  OpenContentViewer,
  RemoveEntity,
  SaveEntities,
  SaveEntity,
  SaveOperation,
  WorkspaceData,
} from "../types";
import { KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS, NOTE_TYPE_LABELS, NOTE_TYPE_OPTIONS, THEME_STATUS_LABELS, relatedEntityTitle, uiNoteType } from "../lib/domain";
import { dateOnly, formatDate, num, str, uuid } from "../lib/format";
import { notePublishEnabled } from "../lib/io";
import { normalizeTaskShelf } from "../lib/taskShelves";
import { buildKnowledgeNodeDraftFromNote, isLongKnowledgeSource } from "../lib/knowledgeExtraction";
import { buildKnowledgeLinkContext, type KnowledgeLinkEntry } from "../lib/knowledgeLinks";
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
import { PROMPT_PURPOSE_LABELS, promptPurpose, promptVariables, isDefaultPrompt } from "../lib/prompts";
import { AI_IMPORT_SCHEMA, assertImportCandidateSavable, parseAiImportPayload } from "../lib/aiImport.js";
import { CHAT_SERVICE_LABELS, CHAT_SERVICE_TYPES, isKnownChatService, resolveChatService } from "../lib/chatServices";
import { ArtifactSection } from "./artifacts";
import {
  CaptureEntryFields,
  findSchedule,
  PlanNodeFields,
  TaskFields,
  WaitingFields,
} from "./drawerEntityFields";
import { MarkdownPreview } from "./MarkdownPreview";
import { DrawerHeader, Field, StatusBadge, ThemeSelect, type CloseDrawer } from "./common";
import { ChecklistProgressBadge } from "./taskChecklist";
import { ChatGroupPicker, ThemeColorPicker, ThemeGroupPicker, ThemeStorageRootField } from "./drawerPickers";
import {
  TASK_STATE_LABELS,
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
import type { CaptureEntry, PlanNode, Reference, Resource, Schedule, Task, Waiting } from "../domain-model/types";
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
const PRIMARY_KNOWLEDGE_NODE_TYPES = ["question", "claim", "evidence", "decision"];
interface ImportCandidate {
  type: "item" | "note" | "link" | "knowledge_node" | "knowledge_edge";
  entry: Record<string, unknown>;
  theme?: { id: string; name: string };
  duplicate?: BaseRecord;
  action: string;
  issues: string[];
}
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
  removeEntity: RemoveEntity;
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  openContentViewer?: OpenContentViewer;
}

export function EntityDrawer({ drawer, data, close, saveForm, registerEditForm, removeEntity, saveEntity, saveEntities, setToast, openContentViewer }: EntityDrawerProps) {
  const entity = drawer.entity || {};
  if (drawer.mode === "edit") {
    return (
      <EditDrawer
        drawer={drawer}
        data={data}
        close={close}
        saveForm={saveForm}
        registerEditForm={registerEditForm}
        removeEntity={removeEntity}
        saveEntities={saveEntities}
        setToast={setToast}
        openContentViewer={openContentViewer}
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
  if (type === "knowledge_node") return <KnowledgeNodeDetailDrawer node={entity as KnowledgeNode} data={data} close={close} removeEntity={removeEntity} saveEntities={saveEntities} />;
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
        {!isChatRef && Boolean(entity.body_markdown) && (
          <MarkdownPreview className="markdown-preview" html={previewHtml(str(entity.body_markdown), "markdown")} />
        )}
        {isChatRef && (
          <ArtifactSection
            sourceType="chat_ref"
            sourceId={resourceId}
            themeId={str(entity.project_id || entity.theme_id) || null}
            artifacts={data.artifacts || []}
            data={data}
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
    const task = entity as unknown as Task;
    const schedule = findSchedule(data, "task", task.id, entity._schedule);
    const themeName = (data.themes || []).find((t) => t.id === task.project_id)?.name || "個人業務";
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
            theme_id: task.project_id || null,
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
          </dl>
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
                    <button
                      className="text-button compact"
                      onClick={() => close({
                        type: "knowledge_node",
                        mode: "edit",
                        entity: {
                          node_type: "insight",
                          title: note.title,
                          body: note.body_markdown,
                          theme_id: note.theme_id || null,
                          source_type: "note",
                          source_id: note.id,
                          confidence: "medium",
                          status: "active",
                        },
                      })}
                    >
                      Knowledge化
                    </button>
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
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => close({ type: "task", mode: "edit", entity: { ...entity, _schedule: schedule } })}><IconPencil size={16} />編集する</button>
            <button className="secondary-button" onClick={copyTask}><IconCopyPlus size={16} />複製する</button>
            <button className="primary-button" onClick={async () => {
              const nextState = task.state === "done" ? "todo" : "done";
              const message = nextState === "done" && task.repeat_rule ? "完了しました。次のタスクを作成しました。" : nextState === "done" ? "完了しました。" : "未完了に戻しました。";
              await saveEntities(buildCompleteTaskOperations(task, schedule), message);
              close();
            }}>{task.state === "done" ? "未完了に戻す" : "完了にする"}</button>
            {task.state !== "done" && <button className="secondary-button" onClick={() => addLearningNote(true)}>完了して学びを書く</button>}
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
      removeEntity={removeEntity}
      saveEntities={saveEntities}
      setToast={setToast}
      openContentViewer={openContentViewer}
    />
  );
}
function EditDrawer({
  drawer,
  data,
  close,
  saveForm,
  registerEditForm,
  removeEntity,
  saveEntities,
  setToast,
  openContentViewer,
}: {
  drawer: DrawerConfig;
  data: WorkspaceData;
  close: CloseDrawer;
  saveForm: SaveForm;
  registerEditForm: RegisterEditForm;
  removeEntity?: RemoveEntity;
  saveEntities?: SaveEntities;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  openContentViewer?: OpenContentViewer;
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
  };
  const kindLabel = typeLabels[type] || type;
  const title = `${entity.id ? "編集" : "追加"}: ${kindLabel}`;
  const entityId = str(entity.id);
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
      <form ref={registerEditForm} className="drawer-form" data-entity-type={type} onSubmit={saveForm} key={`${type}:${entityId || "new"}:${str(entity.theme_id)}:${str(entity.parent_item_id)}`}>
        {type === "theme" && (
          <>
            <Field label="テーマ名"><input name="name" autoFocus defaultValue={str(entity.name)} /></Field>
            <Field label="識別子"><input name="code" defaultValue={str(entity.code)} placeholder="例: MAT-A" /></Field>
            <Field label="概要"><textarea name="description" defaultValue={str(entity.description)} /></Field>
            <ThemeColorPicker value={str(entity.color)} />
            <ThemeGroupPicker value={str(entity.group)} themes={data.themes} />
            <ThemeStorageRootField value={str(entity.storage_root)} setToast={setToast} />
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
        {type === "task" && <TaskFields entity={entity} data={data} saveEntities={saveEntities} />}
        {type === "waiting" && <WaitingFields entity={entity} data={data} />}
        {type === "plan_node" && <PlanNodeFields entity={entity} data={data} />}
        {type === "capture_entry" && <CaptureEntryFields entity={entity} />}
        <button className="primary-button" type="submit">保存する</button>
      </form>
      {(artifactSource || (entityId && removeEntity)) && (
        <div className="drawer-edit-footer">
          {artifactSource && saveEntities && removeEntity && (
            <ArtifactSection
              sourceType={artifactSource.sourceType}
              sourceId={artifactSource.sourceId}
              themeId={artifactSource.themeId}
              artifacts={data.artifacts || []}
              data={data}
              openContentViewer={openContentViewer}
              saveEntities={saveEntities}
              removeEntity={removeEntity}
              setToast={setToast}
            />
          )}
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
      )}
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
      <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
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
  const [projectId, setProjectId] = useState(str(entity.project_id || entity.theme_id));
  const [url, setUrl] = useState(str(entity.url));
  const [linkType, setLinkType] = useState(initialChatLinkType(entity.link_type));
  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <Field label="URL"><input name="url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
      <ThemeSelect themes={data.themes} value={projectId} fieldName="project_id" onChange={setProjectId} />
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
            <Field label="保存日"><input name="captured_at" type="date" defaultValue={dateOnly(entity.captured_at || entity.created_at)} /></Field>
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
  children,
}: {
  title: string;
  close: CloseDrawer;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="drawer">
      <DrawerHeader title={title} close={close} />
      <div className="drawer-content">
        {children}
        <div className="drawer-actions">
          <button className="primary-button" onClick={onEdit}><IconPencil size={16} />編集する</button>
          <button className="danger-button" onClick={onDelete}><IconTrash size={16} />削除する</button>
        </div>
      </div>
    </aside>
  );
}

function buildNoteKnowledgePrompt(note: Note, themeName: string, schema: string) {
  return `あなたはTaskenのNote本文からKnowledge候補を抽出します。JSONだけを返してください。
説明文、Markdownコードブロック、コメントは禁止です。

出力形式:
${schema}

ルール:
- knowledge_nodes と knowledge_edges だけを返す
- node_typeは question / claim / evidence / decision を優先する
- 各knowledge_nodeには temp_id を付ける
- knowledge_edgesは同じ出力内のtemp_idで接続する
- Note本文にない断定は作らない
- confidenceは low / medium / high のいずれか
- actionは create または ignore

Theme:
${themeName || "未設定"}

Note:
${note.title}

本文:
${note.body_markdown || ""}`;
}

function buildKnowledgeCandidateOperations(candidates: ImportCandidate[], note: Note, data: WorkspaceData): SaveOperation[] {
  const acceptedNodeIds = new Map<string, string>();
  const operations: SaveOperation[] = [];
  const noteTheme = data.themes.find((theme) => theme.id === note.theme_id);
  for (const candidate of candidates.filter((entry) => entry.type === "knowledge_node")) {
    if (candidate.action === "ignore") continue;
    const entry = candidate.entry;
    const id = str(candidate.duplicate?.id) || uuid();
    if (str(entry.temp_id)) acceptedNodeIds.set(str(entry.temp_id), id);
    operations.push({
      action: "save",
      type: "knowledge_node",
      entity: {
        ...(candidate.duplicate || {}),
        id,
        node_type: str(entry.node_type) || "insight",
        title: str(entry.title) || "無題",
        body: str(entry.body),
        theme_id: candidate.theme?.id || note.theme_id || noteTheme?.id || null,
        source_type: "note",
        source_id: note.id,
        source_note_id: note.id,
        confidence: str(entry.confidence) || "medium",
        status: str(entry.status) || "active",
      },
      options: { source: "imported" },
    });
  }
  for (const candidate of candidates.filter((entry) => entry.type === "knowledge_edge")) {
    if (candidate.action === "ignore") continue;
    const entry = candidate.entry;
    const sourceNodeId = str(entry.source_node_id) || acceptedNodeIds.get(str(entry.source_temp_id)) || "";
    const targetNodeId = str(entry.target_node_id) || acceptedNodeIds.get(str(entry.target_temp_id)) || "";
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) continue;
    operations.push({
      action: "save",
      type: "knowledge_edge",
      entity: {
        ...(candidate.duplicate || {}),
        id: str(candidate.duplicate?.id) || uuid(),
        source_node_id: sourceNodeId,
        target_node_id: targetNodeId,
        relation_type: str(entry.relation_type) || "supports",
        description: str(entry.description),
      },
      options: { source: "imported" },
    });
  }
  return operations;
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
  const [knowledgeText, setKnowledgeText] = useState("");
  const [knowledgePreview, setKnowledgePreview] = useState<{ candidates: ImportCandidate[]; payloadIssues: string[] } | null>(null);
  const [artifactMode, setArtifactMode] = useState<"preview" | "raw">("preview");
  const [markdownExporting, setMarkdownExporting] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const knowledgeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const comments = note.comments || [];
  const theme = data.themes.find((entry) => entry.id === note.theme_id);
  const extractionPrompt = buildNoteKnowledgePrompt(note, theme?.name || "", AI_IMPORT_SCHEMA);
  const contentFormat = str(note.content_format) || (note.note_type === "artifact" ? "markdown" : "plain");
  const isArtifact = note.note_type === "artifact" || ["markdown", "html"].includes(contentFormat);
  const body = note.body_markdown || "";
  const properties = note.properties_json && typeof note.properties_json === "object" ? note.properties_json as Record<string, unknown> : {};
  const headingNumberOptions = headingNumberOptionsFromProperties(properties);
  const headingNumberLevels = normalizeHeadingNumberLevels(headingNumberOptions.preview.headingNumberLevels);
  const headingNumberLevelSummary = headingNumberLevels.length ? headingNumberLevels.map((level) => `h${level}`).join("–") : "選択なし";
  const publishEnabled = notePublishEnabled(note);
  const isReport = note.note_type === "report";
  const isLongKnowledgeBody = isLongKnowledgeSource(body);
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

  async function startKnowledgeExtraction() {
    await workspaceApi.copyText(extractionPrompt);
    setToast("要点抽出プロンプトをコピーしました。AIのJSONを貼り付けて候補を確認してください。", "success");
    knowledgeTextareaRef.current?.focus();
  }

  function openManualKnowledgeDraft() {
    close({
      type: "knowledge_node",
      mode: "edit",
      entity: buildKnowledgeNodeDraftFromNote(note, { bodyMode: isLongKnowledgeBody ? "empty" : "source" }),
    });
  }

  function previewKnowledgeCandidates() {
    try {
      const parsed = parseAiImportPayload(knowledgeText, data.themes || [], {
        items: [],
        notes: [],
        links: [],
        knowledge_nodes: data.knowledge_nodes || [],
        knowledge_edges: data.knowledge_edges || [],
      });
      const candidates = parsed.candidates
        .filter((candidate: ImportCandidate) => candidate.type === "knowledge_node" || candidate.type === "knowledge_edge")
        .map((candidate: ImportCandidate): ImportCandidate => {
          if (candidate.type !== "knowledge_node") return candidate;
          return {
            ...candidate,
            action: candidate.issues.length ? "ignore" : candidate.action === "ignore" ? "ignore" : "create",
            entry: {
              ...candidate.entry,
              source_note_id: note.id,
              source_type: "note",
              source_id: note.id,
              theme: str(candidate.entry.theme) || theme?.name || "",
            },
          };
        });
      setKnowledgePreview({ candidates, payloadIssues: parsed.payloadIssues });
    } catch (error) {
      alert(`候補を解析できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function saveKnowledgeCandidates() {
    if (!knowledgePreview) return;
    try {
      knowledgePreview.candidates.forEach(assertImportCandidateSavable);
      const operations = buildKnowledgeCandidateOperations(knowledgePreview.candidates, note, data);
      if (!operations.length) return;
      await saveEntities(operations, `${operations.length}件のKnowledge候補を保存しました。`);
      setKnowledgeText("");
      setKnowledgePreview(null);
    } catch (error) {
      alert(`保存できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
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
        html: previewDocument(publishMarkdownBody, "markdown", headingNumberOptions.publish),
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
          themeId={note.theme_id || null}
          artifacts={data.artifacts || []}
          data={data}
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
        <section className="comment-thread">
          <div className="section-heading">
            <h3>Knowledge候補</h3>
            <button className="secondary-button compact" onClick={() => workspaceApi.copyText(extractionPrompt)}>プロンプトをコピー</button>
          </div>
          {isLongKnowledgeBody && (
            <div className="long-knowledge-source">
              <div>
                <strong>本文が長いため、このまま1つのKnowledgeにはしません。</strong>
                <span>要点を抽出して候補にするか、短い本文を自分で作成します。元Noteへの参照は残ります。</span>
              </div>
              <div className="document-publish-actions">
                <button className="primary-button compact" onClick={startKnowledgeExtraction}>要点抽出する</button>
                <button className="secondary-button compact" onClick={openManualKnowledgeDraft}>自分で短くして作成</button>
              </div>
            </div>
          )}
          <textarea
            ref={knowledgeTextareaRef}
            value={knowledgeText}
            onChange={(event) => { setKnowledgeText(event.target.value); setKnowledgePreview(null); }}
            placeholder="AIが返したknowledge_nodes / knowledge_edges JSONを貼り付ける"
            aria-label="Knowledge候補JSON"
          />
          <button className="secondary-button compact" onClick={previewKnowledgeCandidates}>候補を確認</button>
          {knowledgePreview && (
            <div className="import-preview inline-preview">
              {knowledgePreview.payloadIssues.length > 0 && <p className="alert-note warning">注意: {knowledgePreview.payloadIssues.join(" / ")}</p>}
              {knowledgePreview.candidates.map((candidate, index) => (
                <div className="import-candidate" key={`${candidate.type}-${str(candidate.entry.title)}-${index}`}>
                  <div>
                    <strong>{str(candidate.entry.title) || str(candidate.entry.relation_type) || "無題"}</strong>
                    <small>{candidate.type}{candidate.issues.length ? ` / 確認: ${candidate.issues.join(" / ")}` : ""}</small>
                  </div>
                  <select value={candidate.action} onChange={(event) => setKnowledgePreview((current) => current ? { ...current, candidates: current.candidates.map((entry, itemIndex) => itemIndex === index ? { ...entry, action: event.target.value } : entry) } : current)}>
                    <option value="create">採用</option>
                    <option value="ignore">無視</option>
                  </select>
                </div>
              ))}
              <button className="primary-button compact" onClick={saveKnowledgeCandidates}>採用した候補を保存</button>
            </div>
          )}
        </section>
        <div className="drawer-actions">
          <button
            className="secondary-button"
            onClick={openManualKnowledgeDraft}
          >
            {isLongKnowledgeBody ? "短くしてKnowledge化" : "Knowledge化する"}
          </button>
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
  removeEntity,
  saveEntities,
}: {
  node: KnowledgeNode;
  data: WorkspaceData;
  close: CloseDrawer;
  removeEntity: RemoveEntity;
  saveEntities: SaveEntities;
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

  async function adoptMention(entry: KnowledgeLinkEntry) {
    const operations: SaveOperation[] = [
      {
        action: "save",
        type: "reference",
        entity: {
          id: uuid(),
          source_type: entry.type,
          source_id: entry.id,
          target_type: "knowledge_node",
          target_id: node.id,
          relation_type: "mentions",
          note: `[[${node.title}]]`,
        } as SaveOperation["entity"],
      },
    ];
    if (entry.type === "knowledge_node") {
      operations.push({
        action: "save",
        type: "knowledge_edge",
        entity: {
          id: uuid(),
          source_node_id: entry.id,
          target_node_id: node.id,
          relation_type: "similar_to",
          description: `未リンク候補から採用: ${entry.title}`,
        },
      });
    }
    await saveEntities(operations, "Knowledgeリンク候補を採用しました。");
  }

  function openLinkEntry(entry: KnowledgeLinkEntry) {
    if (entry.type === "note") {
      close({ type: "note", mode: "edit", entity: entry.record });
      return;
    }
    close({ type: "knowledge_node", mode: "edit", entity: entry.record });
  }

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
                <button className="knowledge-link-row" onClick={() => openLinkEntry(entry)}>
                  <strong>{entry.title}</strong>
                  <span>{entry.type === "note" ? "Note" : "Knowledge"} / {entry.body.slice(0, 80) || "本文なし"}</span>
                </button>
              </div>
            ))}
          </div>
        )}
        {linkContext.unlinkedMentions.length > 0 && (
          <div className="revision-list">
            <h3>未リンク候補</h3>
            {linkContext.unlinkedMentions.map((entry) => (
              <div className="knowledge-link-candidate" key={`${entry.type}-${entry.id}`}>
                <button className="knowledge-link-row" onClick={() => openLinkEntry(entry)}>
                  <strong>{entry.title}</strong>
                  <span>{entry.type === "note" ? "Note" : "Knowledge"} / {entry.body.slice(0, 80) || "本文なし"}</span>
                </button>
                <button className="secondary-button compact" onClick={() => adoptMention(entry)}>リンク化</button>
              </div>
            ))}
          </div>
        )}
        <div className="drawer-actions">
          <button className="secondary-button" onClick={() => close({ type: "knowledge_edge", mode: "edit", entity: { source_node_id: node.id } })}>関係を追加</button>
          <button className="primary-button" onClick={() => close({ type: "knowledge_node", mode: "edit", entity: node })}><IconPencil size={16} />編集する</button>
          <button className="danger-button" onClick={() => removeEntity("knowledge_node", node)}><IconTrash size={16} />削除する</button>
        </div>
      </div>
    </aside>
  );
}
