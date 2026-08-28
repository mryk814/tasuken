import { useEffect, useRef, useState } from "react";

import { normalizeRepositoryContext, REPOSITORY_PROVIDERS, type RepositoryContext } from "../../../../../shared/repositoryContext.mjs";
import type { DrawerConfig, DrawerEntity, RemoveEntity, SaveEntities, SaveOperation, WorkspaceData } from "../types";
import { REPOSITORY_CONTEXT_MODE_LABELS, REPOSITORY_PROVIDER_LABELS } from "../domain-model/labels";
import { Field } from "./common";

function contextLabel(context: RepositoryContext): string {
  return String(context.label || context.repository_slug || context.local_path || "Repository");
}

function contextTarget(context: RepositoryContext): string {
  return context.canonical_url || context.local_path || "未指定";
}

function ContextRow({
  context,
  checked,
  onToggle,
  onSave,
  onDelete,
  onArchive,
  onRestore,
  onEditingChange,
}: {
  context: RepositoryContext;
  checked: boolean;
  onToggle: () => void;
  onSave?: (context: RepositoryContext) => Promise<void>;
  onDelete?: () => Promise<void>;
  onArchive?: () => Promise<void>;
  onRestore?: () => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(contextLabel(context));
  const [remoteUrl, setRemoteUrl] = useState(String(context.canonical_url || ""));
  const [localPath, setLocalPath] = useState(String(context.local_path || ""));
  const [branch, setBranch] = useState(String(context.default_branch || ""));
  const isArchived = context.active === false;
  const setEditingState = (next: boolean) => {
    setEditing(next);
    onEditingChange?.(next);
  };
  async function save() {
    if (!onSave) return;
    const normalized = normalizeRepositoryContext({ ...context, id: context.id, label, remote_url: remoteUrl, local_path: localPath, default_branch: branch, active: !isArchived });
    await onSave({ ...context, ...normalized, id: context.id } as RepositoryContext);
    setEditingState(false);
  }
  async function closeEditThen(action?: () => Promise<void>) {
    if (!action) return;
    await action();
    setEditingState(false);
  }
  return (
    <div className={`repository-context-row${isArchived ? " is-archived" : ""}`}>
      {!isArchived ? (
        <label className="toggle repository-context-option">
          <input name="repository_context_ids" type="checkbox" value={String(context.id)} checked={checked} onChange={onToggle} />
          <span><strong>{contextLabel(context)}</strong><small>{REPOSITORY_PROVIDER_LABELS[context.provider] || "Unknown"} · {contextTarget(context)}</small></span>
        </label>
      ) : <span className="repository-context-option"><span><strong>{contextLabel(context)}</strong><small>Archive · {contextTarget(context)}</small></span></span>}
      <div className="repository-context-row-actions">
        {onSave && <button type="button" className="text-button compact" onClick={() => setEditingState(!editing)}>{editing ? "閉じる" : "編集"}</button>}
        {isArchived && onRestore && <button type="button" className="text-button compact" onClick={() => void closeEditThen(onRestore)}>復元</button>}
        {!isArchived && onArchive && <button type="button" className="text-button compact" onClick={() => void closeEditThen(onArchive)}>Archive</button>}
        {!isArchived && onDelete && <button type="button" className="text-button compact danger-text" onClick={() => void closeEditThen(onDelete)}>削除</button>}
      </div>
      {editing && <div className="repository-context-edit form-grid">
        <Field label="Label"><input value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
        <Field label="Remote URL"><input type="text" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} /></Field>
        <Field label="Local path"><input value={localPath} onChange={(event) => setLocalPath(event.target.value)} /></Field>
        <Field label="Default branch"><input value={branch} onChange={(event) => setBranch(event.target.value)} /></Field>
        <button type="button" className="secondary-button compact" onClick={() => void save()}>保存</button>
      </div>}
    </div>
  );
}

function ContextOptions({
  contexts,
  selectedIds,
  onToggle,
}: {
  contexts: RepositoryContext[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (!contexts.length) return <p className="field-help">登録済みのRepositoryContextはありません。</p>;
  return (
    <div className="repository-context-options">
      {contexts.map((context) => (
        <label className="toggle repository-context-option" key={String(context.id)}>
          <input
            name="repository_context_ids"
            type="checkbox"
            value={String(context.id)}
            checked={selectedIds.includes(String(context.id))}
            onChange={() => onToggle(String(context.id))}
          />
          <span>
            <strong>{contextLabel(context)}</strong>
            <small>{REPOSITORY_PROVIDER_LABELS[context.provider] || "Unknown"} · {contextTarget(context)}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

function PrimaryContextSelect({
  contexts,
  value,
  onChange,
}: {
  contexts: RepositoryContext[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Field label="Primary RepositoryContext">
      <select name="primary_repository_context_id" value={value} onChange={(event) => onChange(event.target.value)}>
        {contexts.map((context) => <option key={String(context.id)} value={String(context.id)}>{contextLabel(context)}</option>)}
      </select>
    </Field>
  );
}

function useContextActions(saveEntities?: SaveEntities, removeEntity?: RemoveEntity) {
  const saveContext = async (context: RepositoryContext) => {
    await saveEntities?.([{ action: "save", type: "repository_context", entity: context as unknown as SaveOperation["entity"] }], "RepositoryContextを保存しました。");
  };
  const archiveContext = async (context: RepositoryContext) => saveContext({ ...context, active: false });
  const restoreContext = async (context: RepositoryContext) => saveContext({ ...context, active: true, deleted_at: null });
  const deleteContext = async (context: RepositoryContext) => removeEntity?.("repository_context", context as unknown as DrawerEntity);
  return { saveContext, archiveContext, restoreContext, deleteContext };
}

export function ThemeRepositoryContextFields({
  entity,
  data,
  focusRepository = false,
  saveEntities,
  removeEntity,
}: {
  entity: DrawerConfig["entity"];
  data: WorkspaceData;
  focusRepository?: boolean;
  saveEntities?: SaveEntities;
  removeEntity?: RemoveEntity;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const allContexts = (data.repository_contexts || []) as unknown as RepositoryContext[];
  const contexts = allContexts.filter((context) => !context.deleted_at && context.active !== false);
  const archivedContexts = allContexts.filter((context) => !context.deleted_at && context.active === false);
  const initialIds = Array.isArray(entity.repository_context_ids) ? entity.repository_context_ids.map(String) : [];
  const [selectedIds, setSelectedIds] = useState(initialIds.filter((id) => contexts.some((context) => String(context.id) === id)));
  const [primaryId, setPrimaryId] = useState(() => {
    const initialPrimary = String(entity.primary_repository_context_id || "");
    return selectedIds.includes(initialPrimary) ? initialPrimary : selectedIds[0] || "";
  });
  const [inlineEditingIds, setInlineEditingIds] = useState<string[]>([]);
  const missingIds = initialIds.filter((id) => !contexts.some((context) => String(context.id) === id));
  const actions = useContextActions(saveEntities, removeEntity);
  useEffect(() => {
    if (!focusRepository) return;
    sectionRef.current?.scrollIntoView({ block: "start" });
    sectionRef.current?.focus({ preventScroll: true });
  }, [focusRepository]);
  const toggle = (id: string) => setSelectedIds((current) => {
    if (!current.includes(id)) return [...current, id];
    const next = current.filter((value) => value !== id);
    if (primaryId === id) setPrimaryId(next[0] || "");
    return next;
  });
  const removeSelection = (id: string) => {
    setSelectedIds((current) => current.filter((value) => value !== id));
    if (primaryId === id) setPrimaryId("");
  };
  const choosePrimary = (id: string) => {
    if (!selectedIds.includes(id)) setSelectedIds((current) => [...current, id]);
    setPrimaryId(id);
  };
  const setInlineEditing = (id: string, editing: boolean) => {
    setInlineEditingIds((current) => {
      if (editing) return current.includes(id) ? current : [...current, id];
      return current.filter((currentId) => currentId !== id);
    });
  };
  const focusInlineEditing = () => {
    sectionRef.current
      ?.querySelector<HTMLElement>(".repository-context-edit input, .repository-context-edit button")
      ?.focus();
  };
  return (
    <section
      className="drawer-subsection repository-context-section"
      ref={sectionRef}
      tabIndex={-1}
    >
      <div className="section-heading"><h2>Repository</h2><span className="field-help">このThemeで使うRepositoryを登録・選択します。</span></div>
      <input
        type="hidden"
        name="repository_context_inline_editing"
        value={inlineEditingIds.length > 0 ? "true" : ""}
      />
      {inlineEditingIds.length > 0 && (
        <div className="field-help">
          <p>Repositoryの行内編集を保存またはキャンセルしてから、Themeを保存してください。</p>
          <button
            type="button"
            name="repository_context_inline_editing_focus"
            className="text-button compact"
            onClick={focusInlineEditing}
          >
            行内編集へ戻る
          </button>
        </div>
      )}
      <div className="repository-context-options">
        {contexts.length ? contexts.map((context) => <ContextRow
          key={String(context.id)}
          context={context}
          checked={selectedIds.includes(String(context.id))}
          onToggle={() => toggle(String(context.id))}
          onSave={actions.saveContext}
          onDelete={async () => { await actions.deleteContext(context); removeSelection(String(context.id)); }}
          onArchive={async () => { await actions.archiveContext(context); removeSelection(String(context.id)); }}
          onEditingChange={(editing) => setInlineEditing(String(context.id), editing)}
        />) : <p className="field-help">登録済みのRepositoryContextはありません。</p>}
      </div>
      {missingIds.map((id) => <p className="field-help" key={id}>参照 {id} は利用できません（削除済み・Archive・未登録の可能性）。</p>)}
      {selectedIds.length > 0 && <PrimaryContextSelect contexts={contexts} value={primaryId} onChange={choosePrimary} />}
      {archivedContexts.length > 0 && <details className="repository-context-archived"><summary>Archive済み ({archivedContexts.length})</summary>{archivedContexts.map((context) => <ContextRow key={String(context.id)} context={context} checked={false} onToggle={() => {}} onSave={actions.saveContext} onRestore={() => actions.restoreContext(context)} onEditingChange={(editing) => setInlineEditing(String(context.id), editing)} />)}</details>}
      <div className="section-heading"><h3>新しいRepositoryを登録</h3></div>
      <p className="field-help">AIセッションを自動で関連付けるにはLocal pathを登録してください。Themeを保存すると登録と紐付けが同時に完了します。</p>
      <div className="form-grid">
        <Field label="Provider">
          <select name="repository_new_provider" defaultValue="">
            <option value="">URLから判定</option>
            {REPOSITORY_PROVIDERS.map((provider) => <option key={provider} value={provider}>{REPOSITORY_PROVIDER_LABELS[provider] || provider}</option>)}
          </select>
        </Field>
        <Field label="Label"><input name="repository_new_label" placeholder="例: Tasuken" /></Field>
      </div>
      <Field label="Remote URL"><input name="repository_new_url" type="text" placeholder="HTTPS / SSH / scp" /></Field>
      <Field label="Local path（AIセッション連携）"><input name="repository_new_local_path" placeholder="C:\\Users\\name\\projects\\example" /></Field>
      <div className="form-grid">
        <Field label="Default branch"><input name="repository_new_default_branch" placeholder="main" /></Field>
        <Field label="Subdirectory"><input name="repository_new_subdirectory" placeholder="apps/web" /></Field>
      </div>
    </section>
  );
}

export function TaskRepositoryContextFields({
  entity,
  data,
}: {
  entity: DrawerConfig["entity"];
  data: WorkspaceData;
}) {
  const contexts = ((data.repository_contexts || []) as unknown as RepositoryContext[]).filter((context) => !context.deleted_at && context.active !== false);
  const initialIds = Array.isArray(entity.repository_context_ids) ? entity.repository_context_ids.map(String) : [];
  const [selectedIds, setSelectedIds] = useState(initialIds.filter((id) => contexts.some((context) => String(context.id) === id)));
  const [primaryId, setPrimaryId] = useState(() => {
    const initialPrimary = String(entity.primary_repository_context_id || "");
    return selectedIds.includes(initialPrimary) ? initialPrimary : selectedIds[0] || "";
  });
  const [mode, setMode] = useState(String(entity.repository_context_mode || "inherit"));
  const missingIds = initialIds.filter((id) => !contexts.some((context) => String(context.id) === id));
  const toggle = (id: string) => setSelectedIds((current) => {
    if (!current.includes(id)) return [...current, id];
    const next = current.filter((value) => value !== id);
    if (primaryId === id) setPrimaryId(next[0] || "");
    return next;
  });
  const choosePrimary = (id: string) => { if (!selectedIds.includes(id)) setSelectedIds((current) => [...current, id]); setPrimaryId(id); };
  const modeLabel = REPOSITORY_CONTEXT_MODE_LABELS[mode as keyof typeof REPOSITORY_CONTEXT_MODE_LABELS]
    || REPOSITORY_CONTEXT_MODE_LABELS.inherit;
  return (
    <details className="drawer-subsection repository-context-section drawer-disclosure">
      <summary>
        <span className="drawer-disclosure-title">開発用コンテキスト</span>
        <span className="drawer-disclosure-meta">{modeLabel}</span>
      </summary>
      <div className="drawer-disclosure-body">
        <Field label="Taskへの関連付け">
          <select name="repository_context_mode" value={Object.prototype.hasOwnProperty.call(REPOSITORY_CONTEXT_MODE_LABELS, mode) ? mode : "inherit"} onChange={(event) => setMode(event.target.value)}>
            {Object.entries(REPOSITORY_CONTEXT_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        {mode !== "inherit" && <input type="hidden" name="repository_context_inputs_present" value="true" />}
        {mode !== "inherit" && <ContextOptions contexts={contexts} selectedIds={selectedIds} onToggle={toggle} />}
        {mode !== "inherit" && missingIds.map((id) => <p className="field-help" key={id}>参照 {id} は利用できません（削除済み・Archive・未登録の可能性）。</p>)}
        {mode !== "inherit" && selectedIds.length > 0 && <PrimaryContextSelect contexts={contexts} value={primaryId} onChange={choosePrimary} />}
        <div className="form-grid">
          <Field label="Subdirectory"><input name="repository_subdirectory" defaultValue={String(entity.repository_subdirectory || "")} placeholder="apps/web" /></Field>
          <Field label="Branch hint"><input name="repository_branch_hint" defaultValue={String(entity.repository_branch_hint || "")} placeholder="feature/example" /></Field>
        </div>
      </div>
    </details>
  );
}
