import { IconCopy, IconPencil, IconTrash } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { Note, PageProps } from "../types";
import { str } from "../lib/format";
import { isDefaultPrompt, isPromptNote, PROMPT_PURPOSE_LABELS, promptPurpose, promptVariables } from "../lib/prompts";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

export function PromptsPage({ notes, themes, activeTheme, openDrawer, removeEntity, setToast }: PageProps) {
  const prompts = notes.filter(isPromptNote);
  const purposeValues = Object.keys(PROMPT_PURPOSE_LABELS);
  const defaultPurpose = "report";
  const activeThemeId = activeTheme?.id || "";
  const visible = prompts
    .filter((note) => purposeValues.includes(promptPurpose(note)))
    .sort((a, b) =>
      Number(isDefaultPrompt(b)) - Number(isDefaultPrompt(a))
      || promptPurpose(a).localeCompare(promptPurpose(b))
      || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const grouped = purposeValues.map((purpose) => ({
    purpose,
    records: visible.filter((note) => promptPurpose(note) === purpose),
  })).filter((group) => group.records.length);

  function addPrompt(purpose = defaultPurpose) {
    openDrawer({
      type: "note",
      mode: "edit",
      entity: {
        theme_id: activeThemeId || null,
        note_type: "prompt",
        content_format: "markdown",
        title: `${PROMPT_PURPOSE_LABELS[purpose] || "汎用"}プロンプト`,
        properties_json: {
          prompt_purpose: purpose,
          prompt_variables: "themeName, periodStart, periodEnd",
          is_default: false,
          export_enabled: true,
        },
        body_markdown: "",
      },
    });
  }

  function themeName(note: Note): string {
    return themes.find((theme) => theme.id === note.theme_id)?.name || "Themeなし";
  }

  function copyPrompt(note: Note) {
    workspaceApi.copyText(str(note.body_markdown)).then(() => setToast("プロンプト本文をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Prompts" subtitle="用途別に再利用するプロンプトを整理します">
        <button className="primary-button" onClick={() => addPrompt()}>プロンプトを追加</button>
      </PageHeader>
      {grouped.length ? grouped.map((group) => (
        <section className="panel prompt-library-section" key={group.purpose}>
          <div className="section-heading">
            <h2>{PROMPT_PURPOSE_LABELS[group.purpose]}</h2>
            <span>{group.records.length}件</span>
          </div>
          <div className="prompt-library-list">
            {group.records.map((note) => (
              <article className="prompt-library-row" key={note.id}>
                <div>
                  <div className="prompt-library-title">
                    <strong>{note.title}</strong>
                    {isDefaultPrompt(note) && <StatusBadge value="neutral" label="既定" />}
                  </div>
                  <p>{str(note.body_markdown).replace(/\s+/g, " ").slice(0, 180) || "本文なし"}</p>
                  <small>{themeName(note)} / 変数: {promptVariables(note) || "未設定"}</small>
                </div>
                <div className="row-actions">
                  <button className="secondary-button compact icon-only" onClick={() => copyPrompt(note)} aria-label={`${note.title}をコピー`} title="コピー"><IconCopy size={15} /></button>
                  <button className="secondary-button compact icon-only" onClick={() => openDrawer({ type: "note", mode: "edit", entity: note })} aria-label={`${note.title}を編集`} title="編集"><IconPencil size={15} /></button>
                  <button className="danger-button compact icon-only" onClick={() => removeEntity("note", note)} aria-label={`${note.title}を削除`} title="削除"><IconTrash size={15} /></button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )) : (
        <EmptyState title="プロンプトはまだありません" action="プロンプトを追加" onAction={() => addPrompt()} />
      )}
    </div>
  );
}
