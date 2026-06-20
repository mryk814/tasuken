import { useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import type {
  DrawerConfig,
  KnowledgeNode,
  Note,
  RemoveEntity,
  SaveEntities,
  SaveEntity,
  WorkspaceData,
} from "../types";
import { CHART_COLORS, KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS, NOTE_TYPE_LABELS, THEME_STATUS_LABELS, relatedEntityTitle } from "../lib/domain";
import { dateOnly, formatDate, num, str, uuid } from "../lib/format";
import { DrawerHeader, Field, ItemSelect, StatusBadge, ThemeSelect, type CloseDrawer } from "./common";
import {
  TASK_STATE_LABELS,
  WAITING_STATE_LABELS,
  PLAN_NODE_TYPE_LABELS,
  PLAN_NODE_STATE_LABELS,
  CAPTURE_ENTRY_STATE_LABELS,
} from "../domain-model/labels";
import {
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSavePlanNodeOperations,
} from "../domain-model/persistence";
import type { CaptureEntry, PlanNode, Schedule, Task, Waiting } from "../domain-model/types";

const LINK_TYPES = ["chatgpt", "claude", "gemini", "copilot", "github", "paper", "notebook", "document", "other"];
const LINK_TYPE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  github: "GitHub",
  paper: "論文",
  notebook: "Notebook",
  document: "文書",
  other: "その他",
};
const CHAT_REFERENCE_STATUSES = ["inbox", "keep", "adopted", "pending", "stale"];
const CHAT_REFERENCE_STATUS_LABELS: Record<string, string> = {
  inbox: "未整理",
  keep: "参照",
  adopted: "採用",
  pending: "再確認",
  stale: "古い",
};
const normalizeLinkType = (value: unknown) => LINK_TYPES.includes(str(value)) ? str(value) : "other";
const normalizeReferenceStatus = (value: unknown) => CHAT_REFERENCE_STATUSES.includes(str(value)) ? str(value) : "keep";

function ThemeColorPicker({ value }: { value?: string }) {
  const [selected, setSelected] = useState(value || CHART_COLORS[0]);
  return (
    <Field label="カラー">
      <input type="hidden" name="color" value={selected} />
      <div className="color-swatch-picker">
        {CHART_COLORS.map((key) => (
          <button
            key={key}
            type="button"
            className={`color-swatch ${selected === key ? "is-selected" : ""}`}
            style={{ background: `var(--color-${key})` }}
            onClick={() => setSelected(key)}
          />
        ))}
      </div>
    </Field>
  );
}

function ThemeGroupPicker({ value, themes }: { value?: string; themes: WorkspaceData["themes"] }) {
  const [selected, setSelected] = useState(value || "");
  const groups = [...new Set(themes.map((theme) => str(theme.group).trim()).filter(Boolean))];
  return (
    <Field label="グループ">
      <input name="group" value={selected} onChange={(event) => setSelected(event.target.value)} placeholder="新しいグループ名" />
      {groups.length > 0 && (
        <div className="group-chip-list">
          <button
            type="button"
            className={`theme-chip ${!selected ? "is-selected" : ""}`}
            onClick={() => setSelected("")}
          >
            なし
          </button>
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              className={`theme-chip ${selected === group ? "is-selected" : ""}`}
              onClick={() => setSelected(group)}
            >
              {group}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

function ChatGroupPicker({ value, links }: { value?: string; links: WorkspaceData["links"] }) {
  const [selected, setSelected] = useState(value || "");
  const groups = [...new Set(links.map((link) => str(link.chat_group).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja-JP"));
  return (
    <Field label="グループ">
      <input name="chat_group" value={selected} onChange={(event) => setSelected(event.target.value)} placeholder="例: 〇〇モデル改善検討" />
      {groups.length > 0 && (
        <div className="group-chip-list">
          <button
            type="button"
            className={`theme-chip ${!selected ? "is-selected" : ""}`}
            onClick={() => setSelected("")}
          >
            なし
          </button>
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              className={`theme-chip ${selected === group ? "is-selected" : ""}`}
              onClick={() => setSelected(group)}
            >
              {group}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

type SaveForm = (event: React.FormEvent<HTMLFormElement>) => void;

interface EntityDrawerProps {
  drawer: DrawerConfig;
  data: WorkspaceData;
  close: CloseDrawer;
  saveForm: SaveForm;
  removeEntity: RemoveEntity;
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
}

function findSchedule(data: WorkspaceData, ownerType: string, ownerId: string, passedSchedule?: unknown): Schedule | undefined {
  if (passedSchedule && typeof passedSchedule === "object" && "id" in (passedSchedule as object)) return passedSchedule as unknown as Schedule;
  return (data.schedules || []).find((s) => (s as unknown as Schedule).owner_type === ownerType && (s as unknown as Schedule).owner_id === ownerId) as unknown as Schedule | undefined;
}

export function EntityDrawer({ drawer, data, close, saveForm, removeEntity, saveEntity, saveEntities }: EntityDrawerProps) {
  const entity = drawer.entity || {};
  if (drawer.mode === "edit") return <EditDrawer drawer={drawer} data={data} close={close} saveForm={saveForm} />;
  const type = drawer.type;
  if (type === "note") return <NoteDetailDrawer note={entity as Note} close={close} removeEntity={removeEntity} saveEntity={saveEntity} />;
  if (type === "knowledge_node") return <KnowledgeNodeDetailDrawer node={entity as KnowledgeNode} data={data} close={close} removeEntity={removeEntity} />;
  if (type === "link") {
    return (
      <DetailDrawer
        title="リンク詳細"
        close={close}
        onEdit={() => close({ type: "link", mode: "edit", entity })}
        onDelete={() => removeEntity("link", entity)}
      >
        <div className="badge-row">
          <StatusBadge value="neutral" label={LINK_TYPE_LABELS[normalizeLinkType(entity.link_type)]} />
          <StatusBadge value={normalizeReferenceStatus(entity.reference_status)} label={CHAT_REFERENCE_STATUS_LABELS[normalizeReferenceStatus(entity.reference_status)]} />
          {str(entity.importance) === "high" && <StatusBadge value="review" label="重要" />}
        </div>
        <h2>{str(entity.title)}</h2>
        <a href={str(entity.url)} target="_blank" rel="noreferrer">{str(entity.url)}</a>
        <p>{str(entity.description)}</p>
      </DetailDrawer>
    );
  }
  if (type === "resource") {
    const themeName = (data.themes || []).find((t) => t.id === entity.project_id)?.name || "未設定";
    return (
      <DetailDrawer
        title="リソース詳細"
        close={close}
        onEdit={() => close({ type: "resource", mode: "edit", entity })}
        onDelete={() => removeEntity("resource", entity)}
      >
        <h2>{str(entity.title)}</h2>
        {Boolean(entity.url) && <a href={str(entity.url)} target="_blank" rel="noreferrer">{str(entity.url)}</a>}
        <dl>
          <dt>Theme</dt><dd>{themeName}</dd>
        </dl>
        {Boolean(entity.description) && <p>{str(entity.description)}</p>}
      </DetailDrawer>
    );
  }
  if (type === "task") {
    const task = entity as unknown as Task;
    const schedule = findSchedule(data, "task", task.id, entity._schedule);
    const themeName = (data.themes || []).find((t) => t.id === task.project_id)?.name || "個人業務";
    return (
      <aside className="drawer">
        <DrawerHeader title="タスク詳細" close={close} />
        <div className="drawer-content">
          <div className="badge-row">
            <StatusBadge value={task.state} label={TASK_STATE_LABELS[task.state]} />
            {task.priority === "high" && <StatusBadge value="review" label="優先" />}
          </div>
          <h2>{task.title}</h2>
          <p>{task.description || "説明なし"}</p>
          <dl>
            <dt>Theme</dt><dd>{themeName}</dd>
            <dt>予定</dt><dd>{`${formatDate(schedule?.start_date)} - ${formatDate(schedule?.end_date)}`}</dd>
          </dl>
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => close({ type: "task", mode: "edit", entity: { ...entity, _schedule: schedule } })}>編集する</button>
            <button className="primary-button" onClick={async () => {
              const nextState = task.state === "done" ? "todo" : "done";
              await saveEntities(buildSaveTaskOperations({ ...task, state: nextState, completed_at: nextState === "done" ? new Date().toISOString() : null }), nextState === "done" ? "完了しました。" : "未完了に戻しました。");
              close();
            }}>{task.state === "done" ? "未完了に戻す" : "完了にする"}</button>
            <button className="danger-button" onClick={() => removeEntity("task", entity)}>削除する</button>
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
            <button className="secondary-button" onClick={() => close({ type: "waiting", mode: "edit", entity: { ...entity, _schedule: schedule } })}>編集する</button>
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
            <button className="danger-button" onClick={() => removeEntity("waiting", entity)}>削除する</button>
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
            <button className="secondary-button" onClick={() => close({ type: "plan_node", mode: "edit", entity: { ...entity, _schedule: schedule } })}>編集する</button>
            <button className="primary-button" onClick={async () => {
              const nextState = planNode.state === "done" ? "planned" : "done";
              await saveEntities(buildSavePlanNodeOperations({ ...planNode, state: nextState }), nextState === "done" ? "完了しました。" : "未完了に戻しました。");
              close();
            }}>{planNode.state === "done" ? "未完了に戻す" : "完了にする"}</button>
            <button className="danger-button" onClick={() => removeEntity("plan_node", entity)}>削除する</button>
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
            <button className="secondary-button" onClick={() => close({ type: "capture_entry", mode: "edit", entity })}>編集する</button>
            <button className="danger-button" onClick={() => removeEntity("capture_entry", entity)}>削除する</button>
          </div>
        </div>
      </aside>
    );
  }
  return <EditDrawer drawer={{ ...drawer, mode: "edit" }} data={data} close={close} saveForm={saveForm} />;
}

function EditDrawer({ drawer, data, close, saveForm }: { drawer: DrawerConfig; data: WorkspaceData; close: CloseDrawer; saveForm: SaveForm }) {
  const type = drawer.type;
  const entity = drawer.entity;
  const typeLabels: Record<string, string> = {
    item: "タスク",
    theme: "Theme",
    note: "メモ",
    link: "リンク",
    resource: "リソース",
    status_update: "現在地",
    source_record: "情報源",
    field_definition: "追加項目",
    reference: "参照",
    task_dependency: "タスク依存",
    knowledge_node: "Knowledge",
    knowledge_edge: "Knowledge Edge",
    task: "タスク",
    waiting: "待ち",
    plan_node: "計画ノード",
    capture_entry: "キャプチャ",
  };
  const kindLabel = typeLabels[type] || type;
  const title = `${entity.id ? "編集" : "追加"}: ${kindLabel}`;
  return (
    <aside className="drawer">
      <DrawerHeader title={title} close={close} />
      <form className="drawer-form" data-entity-type={type} onSubmit={saveForm} key={`${type}:${str(entity.id) || "new"}:${str(entity.theme_id)}:${str(entity.parent_item_id)}`}>
        {type === "theme" && (
          <>
            <Field label="テーマ名"><input name="name" autoFocus defaultValue={str(entity.name)} /></Field>
            <Field label="概要"><textarea name="description" defaultValue={str(entity.description)} /></Field>
            <Field label="状態"><select name="status" defaultValue={str(entity.status) || "計画中"}><option>計画中</option><option>進行中</option><option>継続</option><option>保留</option><option>完了</option></select></Field>
            <ThemeColorPicker value={str(entity.color)} />
            <ThemeGroupPicker value={str(entity.group)} themes={data.themes} />
          </>
        )}
        {type === "note" && (
          <>
            <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
            <ItemSelect items={data.items} value={str(entity.item_id)} />
            <Field label="種別"><select name="note_type" defaultValue={str(entity.note_type) || "memo"}>{Object.entries(NOTE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="参照URL"><input name="source_url" type="url" defaultValue={str(entity.source_url)} /></Field>
            <Field label="本文（Markdown）"><textarea className="large-textarea" name="body_markdown" defaultValue={str(entity.body_markdown)} /></Field>
          </>
        )}
        {type === "link" && (
          <>
            <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
            <Field label="URL"><input name="url" type="url" defaultValue={str(entity.url)} /></Field>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
            <ChatGroupPicker value={str(entity.chat_group)} links={data.links} />
            <div className="form-grid">
              <Field label="参照状態">
                <select name="reference_status" defaultValue={normalizeReferenceStatus(entity.reference_status)}>
                  {CHAT_REFERENCE_STATUSES.map((value) => <option key={value} value={value}>{CHAT_REFERENCE_STATUS_LABELS[value]}</option>)}
                </select>
              </Field>
              <Field label="保存日"><input name="captured_at" type="date" defaultValue={dateOnly(entity.captured_at || entity.created_at)} /></Field>
            </div>
            <label className="toggle priority-toggle"><input name="importance_high" type="checkbox" defaultChecked={str(entity.importance) === "high"} />重要として残す</label>
            <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
          </>
        )}
        {type === "resource" && (
          <>
            <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
            <Field label="URL"><input name="url" type="url" defaultValue={str(entity.url)} /></Field>
            <ThemeSelect themes={data.themes} value={str(entity.project_id)} fieldName="project_id" />
            <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
          </>
        )}
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
        {type === "source_record" && (
          <>
            <Field label="種類"><select name="source_type" defaultValue={str(entity.source_type) || "manual"}>{["manual", "chatgpt", "copilot", "outlook", "teams", "email", "calendar", "meeting", "document", "sharepoint", "onedrive", "imported_yaml", "imported_json", "snapshot", "other"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field label="タイトル"><input name="source_title" autoFocus defaultValue={str(entity.source_title)} /></Field>
            <Field label="URL"><input name="source_url" type="url" defaultValue={str(entity.source_url)} /></Field>
            <Field label="要約"><textarea name="summary" defaultValue={str(entity.summary)} /></Field>
            <Field label="原文"><textarea className="large-textarea" name="raw_text" defaultValue={str(entity.raw_text)} /></Field>
          </>
        )}
        {type === "field_definition" && (
          <>
            <Field label="項目名"><input name="name" autoFocus defaultValue={str(entity.name)} /></Field>
            <Field label="型"><select name="field_type" defaultValue={str(entity.field_type) || "text"}>{["text", "long_text", "number", "date", "select", "multi_select", "checkbox", "url", "relation"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field label="対象"><select name="applies_to" defaultValue={str(entity.applies_to) || "item"}><option value="theme">Theme</option><option value="item">タスク</option><option value="note">メモ</option><option value="link">リンク</option></select></Field>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} allowAll />
            <Field label="選択肢（カンマ区切り）"><input name="options" defaultValue={((entity.options_json as string[] | undefined) || []).join(", ")} /></Field>
            <label className="toggle"><input name="is_required" type="checkbox" defaultChecked={Boolean(entity.is_required)} />必須</label>
          </>
        )}
        {type === "task_dependency" && (
          <>
            <Field label="タスク"><select name="task_id" defaultValue={str(entity.task_id)}><option value="">選択</option>{(data.tasks || []).map((t) => <option key={t.id} value={t.id}>{str(t.title)}</option>)}</select></Field>
            <Field label="依存先タスク"><select name="depends_on_task_id" defaultValue={str(entity.depends_on_task_id)}><option value="">選択</option>{(data.tasks || []).map((t) => <option key={t.id} value={t.id}>{str(t.title)}</option>)}</select></Field>
          </>
        )}
        {type === "reference" && <ReferenceFields entity={entity} data={data} />}
        {type === "knowledge_node" && <KnowledgeNodeFields entity={entity} data={data} />}
        {type === "knowledge_edge" && <KnowledgeEdgeFields entity={entity} data={data} />}
        {type === "task" && <TaskFields entity={entity} data={data} />}
        {type === "waiting" && <WaitingFields entity={entity} data={data} />}
        {type === "plan_node" && <PlanNodeFields entity={entity} data={data} />}
        {type === "capture_entry" && <CaptureEntryFields entity={entity} />}
        <button className="primary-button" type="submit">保存する</button>
      </form>
    </aside>
  );
}


function ReferenceFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const [sourceType, setSourceType] = useState(str(entity.source_type) || "task");
  const [targetType, setTargetType] = useState(str(entity.target_type) || "task");
  const REF_TYPES: Record<string, { id: string; title?: string; name?: string }[]> = {
    task: data.tasks || [],
    project: data.projects || [],
    note: data.notes || [],
    resource: [...(data.resources || []), ...(data.links || [])],
    knowledge_node: data.knowledge_nodes || [],
  };
  const sourceOptions = REF_TYPES[sourceType] || [];
  const targetOptions = REF_TYPES[targetType] || [];
  const RELATION_TYPES = ["related_to", "derived_from", "mentions", "blocks", "supports"];
  return (
    <>
      <Field label="参照元の種類"><select name="source_type" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>{Object.keys(REF_TYPES).map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
      <Field label="参照元"><select name="source_id" defaultValue={str(entity.source_id)} key={sourceType}><option value="">選択</option>{sourceOptions.map((o) => <option key={o.id} value={o.id}>{o.title || o.name}</option>)}</select></Field>
      <Field label="関係種別"><select name="relation_type" defaultValue={str(entity.relation_type) || "related_to"}>{RELATION_TYPES.map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="参照先の種類"><select name="target_type" value={targetType} onChange={(e) => setTargetType(e.target.value)}>{Object.keys(REF_TYPES).map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
      <Field label="参照先"><select name="target_id" defaultValue={str(entity.target_id)} key={targetType}><option value="">選択</option>{targetOptions.map((o) => <option key={o.id} value={o.id}>{o.title || o.name}</option>)}</select></Field>
      <Field label="メモ"><textarea name="note" defaultValue={str(entity.note)} /></Field>
    </>
  );
}

function KnowledgeNodeFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  return (
    <>
      <Field label="種類">
        <select name="node_type" defaultValue={str(entity.node_type) || "insight"}>
          {Object.entries(KNOWLEDGE_NODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
  const candidates: Record<string, { id: string; title: string }[]> = {
    note: (data.notes || []).map((n) => ({ id: n.id, title: n.title })),
    resource: [
      ...(data.resources || []).map((r) => ({ id: r.id, title: str(r.title) })),
      ...(data.links || []).filter((l) => !(data.resources || []).some((r) => r.id === l.id)).map((l) => ({ id: l.id, title: l.title })),
    ],
    task: (data.items || []).filter((i) => i.kind === "task" || !i.kind).map((i) => ({ id: i.id, title: i.title })),
    waiting: (data.items || []).filter((i) => i.kind === "waiting" || i.status === "waiting").map((i) => ({ id: i.id, title: i.title })),
    plan_node: (data.items || []).filter((i) => i.kind === "milestone" || i.kind === "period").map((i) => ({ id: i.id, title: i.title })),
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
          <button className="primary-button" onClick={onEdit}>編集する</button>
          <button className="danger-button" onClick={onDelete}>削除する</button>
        </div>
      </div>
    </aside>
  );
}

function NoteDetailDrawer({
  note,
  close,
  removeEntity,
  saveEntity,
}: {
  note: Note;
  close: CloseDrawer;
  removeEntity: RemoveEntity;
  saveEntity: SaveEntity;
}) {
  const [comment, setComment] = useState("");
  const comments = note.comments || [];

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

  return (
    <aside className="drawer">
      <DrawerHeader title="メモ詳細" close={close} />
      <div className="drawer-content">
        <StatusBadge value="neutral" label={NOTE_TYPE_LABELS[note.note_type ?? ""] || note.note_type} />
        <h2>{note.title}</h2>
        {note.source_url && <div className="link-value"><a href={note.source_url} target="_blank" rel="noreferrer">{note.source_url}</a></div>}
        <p className="note-body">{note.body_markdown}</p>
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
        <div className="drawer-actions">
          <button
            className="secondary-button"
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
            構造化する
          </button>
          <button className="primary-button" onClick={() => close({ type: "note", mode: "edit", entity: note })}>編集する</button>
          <button className="danger-button" onClick={() => removeEntity("note", note)}>削除する</button>
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
}: {
  node: KnowledgeNode;
  data: WorkspaceData;
  close: CloseDrawer;
  removeEntity: RemoveEntity;
}) {
  const relations = ((data.knowledge_edges || []) as unknown as import("../domain-model/types").KnowledgeEdge[]).filter((relation) => relation.source_node_id === node.id || relation.target_node_id === node.id);
  const sourceLabel = (() => {
    if (node.source_type && node.source_id) {
      const typeLabel = SOURCE_TYPE_LABELS[node.source_type] || node.source_type;
      if (node.source_type === "note") { const n = data.notes.find((n) => n.id === node.source_id); return `${typeLabel}: ${n?.title || node.source_id}`; }
      if (node.source_type === "resource") { const r = (data.resources || []).find((r) => r.id === node.source_id) || data.links.find((l) => l.id === node.source_id); return `${typeLabel}: ${r?.title || node.source_id}`; }
      const item = (data.items || []).find((i) => i.id === node.source_id); return `${typeLabel}: ${item?.title || node.source_id}`;
    }
    if (node.source_note_id) return `メモ: ${data.notes.find((n) => n.id === node.source_note_id)?.title || "不明"}`;
    if (node.source_link_id) return `リンク: ${data.links.find((l) => l.id === node.source_link_id)?.title || "不明"}`;
    if (node.source_item_id) return `タスク: ${(data.items || []).find((i) => i.id === node.source_item_id)?.title || "不明"}`;
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
        <div className="drawer-actions">
          <button className="secondary-button" onClick={() => close({ type: "knowledge_edge", mode: "edit", entity: { source_node_id: node.id } })}>関係を追加</button>
          <button className="primary-button" onClick={() => close({ type: "knowledge_node", mode: "edit", entity: node })}>編集する</button>
          <button className="danger-button" onClick={() => removeEntity("knowledge_node", node)}>削除する</button>
        </div>
      </div>
    </aside>
  );
}

function TaskFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const schedule = findSchedule(data, "task", str(entity.id), entity._schedule);
  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <ThemeSelect themes={data.themes} value={str(entity.project_id)} allowPersonal />
      <Field label="状態">
        <select name="state" defaultValue={str(entity.state) || "todo"}>
          {Object.entries(TASK_STATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <label className="toggle priority-toggle"><input name="priority_flag" type="checkbox" defaultChecked={str(entity.priority) === "high"} />旗を付ける</label>
      <div className="form-grid">
        <Field label="開始"><input name="start_date" type="date" defaultValue={dateOnly(schedule?.start_date)} /></Field>
        <Field label="期限"><input name="end_date" type="date" defaultValue={dateOnly(schedule?.end_date)} /></Field>
      </div>
      <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
      {schedule && <input type="hidden" name="_schedule_id" value={schedule.id} />}
    </>
  );
}

function WaitingFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const schedule = findSchedule(data, "waiting", str(entity.id), entity._schedule);
  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <Field label="相手"><input name="waiting_for" defaultValue={str(entity.waiting_for)} /></Field>
      <ThemeSelect themes={data.themes} value={str(entity.project_id)} allowPersonal />
      <Field label="状態">
        <select name="state" defaultValue={str(entity.state) || "waiting"}>
          {Object.entries(WAITING_STATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="期限"><input name="end_date" type="date" defaultValue={dateOnly(schedule?.end_date)} /></Field>
      <Field label="次アクション"><input name="next_action" defaultValue={str(entity.next_action)} /></Field>
      <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
      {schedule && <input type="hidden" name="_schedule_id" value={schedule.id} />}
    </>
  );
}

function PlanNodeFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const schedule = findSchedule(data, "plan_node", str(entity.id), entity._schedule);
  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <ThemeSelect themes={data.themes} value={str(entity.project_id)} allowPersonal />
      <div className="form-grid">
        <Field label="種類">
          <select name="node_type" defaultValue={str(entity.type) || "milestone"}>
            {Object.entries(PLAN_NODE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="状態">
          <select name="node_state" defaultValue={str(entity.state) || "planned"}>
            {Object.entries(PLAN_NODE_STATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>
      <div className="form-grid">
        <Field label="開始"><input name="start_date" type="date" defaultValue={dateOnly(schedule?.start_date)} /></Field>
        <Field label="期限"><input name="end_date" type="date" defaultValue={dateOnly(schedule?.end_date)} /></Field>
      </div>
      <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
      {schedule && <input type="hidden" name="_schedule_id" value={schedule.id} />}
    </>
  );
}

function CaptureEntryFields({ entity }: { entity: DrawerConfig["entity"] }) {
  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <Field label="本文"><textarea name="text" defaultValue={str(entity.text)} /></Field>
      <Field label="記録日"><input name="captured_at" type="date" defaultValue={dateOnly(entity.captured_at)} /></Field>
      <Field label="状態">
        <select name="entry_state" defaultValue={str(entity.state) || "untriaged"}>
          {Object.entries(CAPTURE_ENTRY_STATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
    </>
  );
}
