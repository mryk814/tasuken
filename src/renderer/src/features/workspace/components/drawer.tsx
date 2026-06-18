import { useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import type {
  DrawerConfig,
  Item,
  KnowledgeNode,
  Note,
  RemoveEntity,
  SaveEntity,
  WorkspaceData,
} from "../types";
import { CHART_COLORS, KIND_LABELS, KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS, LEVEL_LABELS, NOTE_TYPE_LABELS, STATUS_LABELS, THEME_STATUS_LABELS, itemLevel, relatedEntityTitle } from "../lib/domain";
import { dateOnly, formatDate, num, str, uuid } from "../lib/format";
import { DrawerHeader, Field, ItemSelect, StatusBadge, ThemeSelect, type CloseDrawer } from "./common";

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
  toggleItem: (item: Item) => Promise<void>;
  saveEntity: SaveEntity;
}

export function EntityDrawer({ drawer, data, close, saveForm, removeEntity, toggleItem, saveEntity }: EntityDrawerProps) {
  const entity = drawer.entity || {};
  if (drawer.mode === "edit") return <EditDrawer drawer={drawer} data={data} close={close} saveForm={saveForm} />;
  const type = drawer.type;
  if (type === "item") {
    const item = entity as Item;
    const revisions = (data.plan_revisions || []).filter((revision) => revision.item_id === item.id);
    const relations = (data.relations || []).filter((relation) => relation.source_entity_id === item.id || relation.target_entity_id === item.id);
    const dependencies = (data.dependencys || []).filter((dependency) => dependency.source_item_id === item.id || dependency.target_item_id === item.id);
    return (
      <aside className="drawer">
        <DrawerHeader title="タスク詳細" close={close} />
        <div className="drawer-content">
          <div className="badge-row">
            <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""]} />
          </div>
          <h2>{item.title}</h2>
          <p>{item.description || "説明なし"}</p>
          <dl>
            <dt>種類</dt><dd>{KIND_LABELS[item.kind ?? ""]}</dd>
            <dt>予定</dt><dd>{`${formatDate(item.planned_start)} - ${formatDate(item.planned_end)}`}</dd>
          </dl>
          {(relations.length > 0 || dependencies.length > 0) && (
            <div className="revision-list">
              <h3>関係</h3>
              {dependencies.map((dependency) => (
                <div key={dependency.id}>
                  <span>依存: {(data.items || []).find((entry) => entry.id === dependency.source_item_id)?.title} → {(data.items || []).find((entry) => entry.id === dependency.target_item_id)?.title}</span>
                </div>
              ))}
              {relations.map((relation) => (
                <div key={relation.id}>
                  <span>{relation.relation_type}: {relatedEntityTitle(data, relation.target_entity_type ?? "", relation.target_entity_id)}</span>
                </div>
              ))}
            </div>
          )}
          {revisions.length > 0 && (
            <div className="revision-list">
              <h3>予定変更履歴</h3>
              {revisions.slice(0, 8).map((revision) => (
                <div key={revision.id}>
                  <time>{new Date(revision.changed_at).toLocaleString("ja-JP")}</time>
                  <span>{revision.reason || "理由未記入"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => close({ type: "item", mode: "edit", entity: item })}>編集する</button>
            <button className="secondary-button" onClick={() => close({ type: "dependency", mode: "edit", entity: { source_item_id: item.id } })}>依存を追加</button>
            <button className="secondary-button" onClick={() => close({ type: "relation", mode: "edit", entity: { source_entity_type: "item", source_entity_id: item.id } })}>関係を追加</button>
            <button className="primary-button" onClick={() => { void toggleItem(item); close(); }}>{item.status === "done" ? "未完了に戻す" : "完了にする"}</button>
            <button className="danger-button" onClick={() => removeEntity("item", item)}>削除する</button>
          </div>
        </div>
      </aside>
    );
  }
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
    status_update: "現在地",
    source_record: "情報源",
    field_definition: "追加項目",
    relation: "関連づけ",
    dependency: "依存",
    knowledge_node: "Knowledge",
    knowledge_relation: "Knowledge Relation",
  };
  const kindLabel = type === "item" && !entity.id ? KIND_LABELS[(entity as Partial<Item>).kind ?? ""] || "タスク" : typeLabels[type] || type;
  const title = `${entity.id ? "編集" : "追加"}: ${kindLabel}`;
  return (
    <aside className="drawer">
      <DrawerHeader title={title} close={close} />
      <form className="drawer-form" data-entity-type={type} onSubmit={saveForm} key={`${type}:${str(entity.id) || "new"}:${str(entity.theme_id)}:${str(entity.parent_item_id)}`}>
        {type === "item" && <ItemFields entity={entity as Partial<Item>} data={data} />}
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
        {type === "dependency" && (
          <>
            <Field label="先行タスク"><select name="source_item_id" defaultValue={str(entity.source_item_id)}><option value="">選択</option>{(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <Field label="後続タスク"><select name="target_item_id" defaultValue={str(entity.target_item_id)}><option value="">選択</option>{(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <p className="field-help">初期実装ではfinish-to-startのみ扱います。</p>
          </>
        )}
        {type === "relation" && <RelationFields entity={entity} data={data} />}
        {type === "knowledge_node" && <KnowledgeNodeFields entity={entity} data={data} />}
        {type === "knowledge_relation" && <KnowledgeRelationFields entity={entity} data={data} />}
        <button className="primary-button" type="submit">保存する</button>
      </form>
    </aside>
  );
}

function ItemFields({ entity, data }: { entity: Partial<Item>; data: WorkspaceData }) {
  const isNew = !entity.id;
  const customDefinitions = (data.field_definitions || []).filter((field) => field.applies_to === "item" && (!field.theme_id || field.theme_id === entity.theme_id));

  if (isNew) {
    return (
      <>
        <Field label="タイトル"><input name="title" autoFocus defaultValue={entity.title ?? ""} /></Field>
        <ThemeSelect themes={data.themes} value={entity.theme_id} allowPersonal />
        <Field label="状態"><select name="status" defaultValue={entity.status || "todo"}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {(entity.kind === "period" || entity.kind === "milestone") && (
          <Field label="予定開始"><input name="planned_start" type="date" defaultValue={dateOnly(entity.planned_start)} /></Field>
        )}
        <Field label="予定終了"><input name="planned_end" type="date" defaultValue={dateOnly(entity.planned_end)} /></Field>
        <Field label="説明"><textarea name="description" defaultValue={entity.description ?? ""} /></Field>
      </>
    );
  }

  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={entity.title ?? ""} /></Field>
      <ThemeSelect themes={data.themes} value={entity.theme_id} allowPersonal />
      <div className="form-grid">
        <Field label="種類"><select name="kind" defaultValue={entity.kind || "task"}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="レベル"><select name="level" defaultValue={itemLevel(entity as Item)}>{Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </div>
      <Field label="状態"><select name="status" defaultValue={entity.status || "todo"}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <ItemSelect label="親タスク" items={(data.items || []).filter((item) => item.id !== entity.id)} value={entity.parent_item_id} />
      <div className="form-grid">
        <Field label="予定開始"><input name="planned_start" type="date" defaultValue={dateOnly(entity.planned_start)} /></Field>
        <Field label="予定終了"><input name="planned_end" type="date" defaultValue={dateOnly(entity.planned_end)} /></Field>
      </div>
      <label className="toggle priority-toggle"><input name="priority_flag" type="checkbox" defaultChecked={entity.priority === "high"} />旗を付ける</label>
      <Field label="説明"><textarea name="description" defaultValue={entity.description ?? ""} /></Field>
      {customDefinitions.map((definition) => {
        const value = (data.field_values || []).find((entry) => entry.field_definition_id === definition.id && entry.entity_id === entity.id);
        return (
          <Field key={definition.id} label={definition.name}>
            <input
              name={`custom:${definition.id}`}
              type={definition.field_type === "date" ? "date" : definition.field_type === "number" ? "number" : definition.field_type === "url" ? "url" : "text"}
              required={definition.is_required}
              defaultValue={value?.value_text ?? ""}
            />
          </Field>
        );
      })}
      {entity.id && <Field label="予定変更理由（任意）"><textarea name="revision_reason" placeholder="測定結果の受領が遅れたため" /></Field>}
    </>
  );
}

function RelationFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const [targetType, setTargetType] = useState(str(entity.target_entity_type) || "item");
  const collections: Record<string, { id: string; title?: string; source_title?: string; name?: string }[]> = {
    item: data.items || [],
    note: data.notes || [],
    link: data.links || [],
    source_record: data.source_records || [],
  };
  const targets = collections[targetType] || [];
  return (
    <>
      <input type="hidden" name="source_entity_type" value={str(entity.source_entity_type) || "item"} />
      <input type="hidden" name="source_entity_id" value={str(entity.source_entity_id)} />
      <Field label="関係種別"><select name="relation_type" defaultValue={str(entity.relation_type) || "relates_to"}>{["blocks", "blocked_by", "relates_to", "duplicated_by", "follows", "references", "created_from", "evidence_for", "caused_by", "supports"].map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="関係先の種類"><select name="target_entity_type" value={targetType} onChange={(event) => setTargetType(event.target.value)}><option value="item">タスク</option><option value="note">メモ</option><option value="link">リンク</option><option value="source_record">情報源</option></select></Field>
      <Field label="関係先"><select name="target_entity_id" defaultValue={str(entity.target_entity_id)} key={targetType}><option value="">選択</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.title || target.source_title || target.name}</option>)}</select></Field>
      {!targets.length && <p className="field-help">選択できる{targetType}がありません。先に対象を追加してください。</p>}
      <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
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
      <Field label="元メモ">
        <select name="source_note_id" defaultValue={str(entity.source_note_id)}>
          <option value="">未設定</option>
          {(data.notes || []).map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}
        </select>
      </Field>
      <Field label="元リンク">
        <select name="source_link_id" defaultValue={str(entity.source_link_id)}>
          <option value="">未設定</option>
          {(data.links || []).map((link) => <option key={link.id} value={link.id}>{link.title}</option>)}
        </select>
      </Field>
      <Field label="元タスク">
        <select name="source_item_id" defaultValue={str(entity.source_item_id)}>
          <option value="">未設定</option>
          {(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </Field>
    </>
  );
}

function KnowledgeRelationFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
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
      <Field label="確度">
        <select name="confidence" defaultValue={str(entity.confidence) || "medium"}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
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
                source_note_id: note.id,
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
  const relations = (data.knowledge_relations || []).filter((relation) => relation.source_node_id === node.id || relation.target_node_id === node.id);
  const sourceNote = data.notes.find((note) => note.id === node.source_note_id);
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
          <dt>元メモ</dt><dd>{sourceNote?.title || "未設定"}</dd>
        </dl>
        {relations.length > 0 && (
          <div className="revision-list">
            <h3>関係</h3>
            {relations.map((relation) => {
              const isSource = relation.source_node_id === node.id;
              const other = data.knowledge_nodes.find((entry) => entry.id === (isSource ? relation.target_node_id : relation.source_node_id));
              return (
                <div key={relation.id}>
                  <span>{isSource ? "→" : "←"} {relation.relation_type}: {other?.title || "不明"}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="drawer-actions">
          <button className="secondary-button" onClick={() => close({ type: "knowledge_relation", mode: "edit", entity: { source_node_id: node.id } })}>関係を追加</button>
          <button className="primary-button" onClick={() => close({ type: "knowledge_node", mode: "edit", entity: node })}>編集する</button>
          <button className="danger-button" onClick={() => removeEntity("knowledge_node", node)}>削除する</button>
        </div>
      </div>
    </aside>
  );
}
