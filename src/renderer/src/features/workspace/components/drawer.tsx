import { useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import type {
  DrawerConfig,
  Item,
  Note,
  RemoveEntity,
  SaveEntity,
  WorkspaceData,
} from "../types";
import { CHART_COLORS, KIND_LABELS, LEVEL_LABELS, NOTE_TYPE_LABELS, STATUS_LABELS, THEME_STATUS_LABELS, itemLevel, relatedEntityTitle } from "../lib/domain";
import { dateOnly, formatDate, num, str, uuid } from "../lib/format";
import { DrawerHeader, Field, ItemSelect, StatusBadge, ThemeSelect, type CloseDrawer } from "./common";

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
        <DrawerHeader title="Item詳細" close={close} />
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
  if (type === "link") {
    return (
      <DetailDrawer
        title="リンク詳細"
        close={close}
        onEdit={() => close({ type: "link", mode: "edit", entity })}
        onDelete={() => removeEntity("link", entity)}
      >
        <StatusBadge value="neutral" label={str(entity.link_type)} />
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
  const kindLabel = type === "item" && !entity.id ? KIND_LABELS[(entity as Partial<Item>).kind ?? ""] || "item" : type;
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
            <Field label="種別"><select name="link_type" defaultValue={str(entity.link_type) || "other"}>{["sharepoint", "onedrive", "teams", "outlook", "chatgpt", "copilot", "github", "local_file", "notebook", "paper", "folder", "other"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
            <ItemSelect items={data.items} value={str(entity.item_id)} />
            <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
          </>
        )}
        {type === "person" && (
          <>
            <Field label="名前"><input name="name" autoFocus defaultValue={str(entity.name)} /></Field>
            <Field label="役割"><input name="role" defaultValue={str(entity.role)} /></Field>
            <Field label="所属"><input name="organization" defaultValue={str(entity.organization)} /></Field>
            <Field label="メモ"><textarea name="note" defaultValue={str(entity.note)} /></Field>
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
            <Field label="型"><select name="field_type" defaultValue={str(entity.field_type) || "text"}>{["text", "long_text", "number", "date", "select", "multi_select", "checkbox", "url", "person", "relation"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field label="対象"><select name="applies_to" defaultValue={str(entity.applies_to) || "item"}>{["theme", "item", "note", "link"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} allowAll />
            <Field label="選択肢（カンマ区切り）"><input name="options" defaultValue={((entity.options_json as string[] | undefined) || []).join(", ")} /></Field>
            <label className="toggle"><input name="is_required" type="checkbox" defaultChecked={Boolean(entity.is_required)} />必須</label>
          </>
        )}
        {type === "dependency" && (
          <>
            <Field label="先行Item"><select name="source_item_id" defaultValue={str(entity.source_item_id)}><option value="">選択</option>{(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <Field label="後続Item"><select name="target_item_id" defaultValue={str(entity.target_item_id)}><option value="">選択</option>{(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <p className="field-help">初期実装ではfinish-to-startのみ扱います。</p>
          </>
        )}
        {type === "relation" && <RelationFields entity={entity} data={data} />}
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
      <ItemSelect label="親Item" items={(data.items || []).filter((item) => item.id !== entity.id)} value={entity.parent_item_id} />
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
      <Field label="関係先の種類"><select name="target_entity_type" value={targetType} onChange={(event) => setTargetType(event.target.value)}><option value="item">Item</option><option value="note">Note</option><option value="link">Link</option><option value="source_record">情報源</option></select></Field>
      <Field label="関係先"><select name="target_entity_id" defaultValue={str(entity.target_entity_id)} key={targetType}><option value="">選択</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.title || target.source_title || target.name}</option>)}</select></Field>
      {!targets.length && <p className="field-help">選択できる{targetType}がありません。先に対象を追加してください。</p>}
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
          <button className="primary-button" onClick={() => close({ type: "note", mode: "edit", entity: note })}>編集する</button>
          <button className="danger-button" onClick={() => removeEntity("note", note)}>削除する</button>
        </div>
      </div>
    </aside>
  );
}
