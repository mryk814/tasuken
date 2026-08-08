import { useState } from "react";

import { normalizeRepositoryContext, REPOSITORY_PROVIDERS, type RepositoryContext } from "../../../../../shared/repositoryContext.mjs";
import type { DrawerConfig, DrawerEntity, RemoveEntity, SaveEntities, WorkspaceData } from "../types";
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
}: {
  context: RepositoryContext;
  checked: boolean;
  onToggle: () => void;
  onSave?: (context: RepositoryContext) => Promise<void>;
  onDelete?: () => Promise<void>;
  onArchive?: () => Promise<void>;
  onRestore?: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(contextLabel(context));
  const [remoteUrl, setRemoteUrl] = useState(String(context.canonical_url || ""));
  const [localPath, setLocalPath] = useState(String(context.local_path || ""));
  const [branch, setBranch] = useState(String(context.default_branch || ""));
  const isArchived = context.active === false;
  async function save() {
    if (!onSave) return;
    const normalized = normalizeRepositoryContext({ ...context, id: context.id, label, remote_url: remoteUrl, local_path: localPath, default_branch: branch, active: !isArchived });
    await onSave({ ...context, ...normalized, id: context.id } as RepositoryContext);
    setEditing(false);
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
        {onSave && <button type="button" className="text-button compact" onClick={() => setEditing((current) => !current)}>{editing ? "閉じる" : "編集"}</button>}
        {isArchived && onRestore && <button type="button" className="text-button compact" onClick={() => void onRestore()}>復元</button>}
        {!isArchived && onArchive && <button type="button" className="text-button compact" onClick={() => void onArchive()}>Archive</button>}
        {!isArchived && onDelete && <button type="button" className="text-button compact danger-text" onClick={() => void onDelete()}>削除</button>}
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
    await saveEntities?.([{ action: "save", type: "repository_context", entity: context as unknown as Record<string, unknown> }], "RepositoryContextを保存しました。");
  };
  const archiveContext = async (context: RepositoryContext) => saveContext({ ...context, active: false });
  const restoreContext = async (context: RepositoryContext) => saveContext({ ...context, active: true, deleted_at: null });
  const deleteContext = async (context: RepositoryContext) => removeEntity?.("repository_context", context as unknown as DrawerEntity);
  return { saveContext, archiveContext, restoreContext, deleteContext };
}

export function ThemeRepositoryContextFields({
  entity,
  data,
  saveEntities,
  removeEntity,
}: {
  entity: DrawerConfig["entity"];
  data: WorkspaceData;
  saveEntities?: SaveEntities;
  removeEntity?: RemoveEntity;
}) {
  const allContexts = (data.repository_contexts || []) as unknown as RepositoryContext[];
  const contexts = allContexts.filter((context) => !context.deleted_at && context.active !== false);
  const archivedContexts = allContexts.filter((context) => !context.deleted_at && context.active === false);
  const initialIds = Array.isArray(entity.repository_context_ids) ? entity.repository_context_ids.map(String) : [];
  const [selectedIds, setSelectedIds] = useState(initialIds.filter((id) => contexts.some((context) => String(context.id) === id)));
  const [primaryId, setPrimaryId] = useState(() => {
    const initialPrimary = String(entity.primary_repository_context_id || "");
    return selectedIds.includes(initialPrimary) ? initialPrimary : selectedIds[0] || "";
  });
  const missingIds = initialIds.filter((id) => !contexts.some((context) => String(context.id) === id));
  const actions = useContextActions(saveEntities, removeEntity);
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
  return (
    <section className="drawer-subsection repository-context-section">
      <div className="section-heading"><h2>RepositoryContext</h2><span className="field-help">複数登録可。Primaryは1つです。</span></div>
      <div className="repository-context-options">
        {contexts.length ? contexts.map((context) => <ContextRow
          key={String(context.id)}
          context={context}
          checked={selectedIds.includes(String(context.id))}
          onToggle={() => toggle(String(context.id))}
          onSave={actions.saveContext}
          onDelete={async () => { await actions.deleteContext(context); removeSelection(String(context.id)); }}
          onArchive={async () => { await actions.archiveContext(context); removeSelection(String(context.id)); }}
        />) : <p className="field-help">登録済みのRepositoryContextはありません。</p>}
      </div>
      {missingIds.map((id) => <p className="field-help" key={id}>参照 {id} は利用できません（削除済み・Archive・未登録の可能性）。</p>)}
      {selectedIds.length > 0 && <PrimaryContextSelect contexts={contexts} value={primaryId} onChange={choosePrimary} />}
      {archivedContexts.length > 0 && <details className="repository-context-archived"><summary>Archive済み ({archivedContexts.length})</summary>{archivedContexts.map((context) => <ContextRow key={String(context.id)} context={context} checked={false} onToggle={() => {}} onSave={actions.saveContext} onRestore={() => actions.restoreContext(context)} />)}</details>}
      <div className="section-heading"><h3>新しいContextを追加</h3></div>
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
      <Field label="Local path"><input name="repository_new_local_path" placeholder="absolute path" /></Field>
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
  return (
    <section className="drawer-subsection repository-context-section">
      <div className="section-heading"><h2>RepositoryContext</h2><span className="field-help">Theme継承が既定です。</span></div>
      <Field label="Taskへの関連付け">
        <select name="repository_context_mode" value={Object.prototype.hasOwnProperty.call(REPOSITORY_CONTEXT_MODE_LABELS, mode) ? mode : "inherit"} onChange={(event) => setMode(event.target.value)}>
          {Object.entries(REPOSITORY_CONTEXT_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {mode !== "inherit" && <ContextOptions contexts={contexts} selectedIds={selectedIds} onToggle={toggle} />}
      {mode !== "inherit" && missingIds.map((id) => <p className="field-help" key={id}>参照 {id} は利用できません（削除済み・Archive・未登録の可能性）。</p>)}
      {mode !== "inherit" && selectedIds.length > 0 && <PrimaryContextSelect contexts={contexts} value={primaryId} onChange={choosePrimary} />}
      <div className="form-grid">
        <Field label="Subdirectory"><input name="repository_subdirectory" defaultValue={String(entity.repository_subdirectory || "")} placeholder="apps/web" /></Field>
        <Field label="Branch hint"><input name="repository_branch_hint" defaultValue={String(entity.repository_branch_hint || "")} placeholder="feature/example" /></Field>
      </div>
    </section>
  );
}
