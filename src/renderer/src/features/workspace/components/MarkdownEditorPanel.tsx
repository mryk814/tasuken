import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { previewHtml, renderedText, splitFrontmatter } from "../lib/markdown";

type MarkdownEditorMode = "raw" | "preview";

export function MarkdownEditorPanel({
  name,
  label,
  value,
  format,
}: {
  name: string;
  label: string;
  value: string;
  format: string;
}) {
  const [body, setBody] = useState(value);
  const [mode, setMode] = useState<MarkdownEditorMode>("raw");
  const [copyState, setCopyState] = useState("");
  const dirty = body !== value;
  const frontmatter = format === "markdown" ? splitFrontmatter(body).frontmatter : "";
  const preview = previewHtml(body, format);

  async function copyRaw() {
    await workspaceApi.copyText(body);
    setCopyState("Rawをコピーしました。");
  }

  async function copyRendered() {
    await workspaceApi.copyText(renderedText(body, format));
    setCopyState("Previewをコピーしました。");
  }

  return (
    <section className="markdown-editor" aria-label={label}>
      <div className="markdown-editor-heading">
        <span>{label}</span>
        <span className={`markdown-save-state ${dirty ? "is-dirty" : ""}`}>{dirty ? "未保存の変更あり" : value ? "保存済み" : "保存前"}</span>
      </div>
      <div className="markdown-editor-toolbar">
        <div className="segmented" aria-label={`${label}表示`}>
          <button type="button" className={mode === "raw" ? "is-active" : ""} onClick={() => setMode("raw")}>Raw</button>
          <button type="button" className={mode === "preview" ? "is-active" : ""} onClick={() => setMode("preview")}>Preview</button>
        </div>
        <div className="markdown-editor-actions">
          <button type="button" className="secondary-button compact" onClick={copyRaw}>Copy Raw</button>
          <button type="button" className="secondary-button compact" onClick={copyRendered}>Copy Rendered text</button>
        </div>
      </div>
      {copyState && <p className="field-help">{copyState}</p>}
      {frontmatter && <p className="markdown-frontmatter-note">frontmatterあり</p>}
      {mode === "raw" ? (
        <textarea
          className="large-textarea markdown-editor-input"
          name={name}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            if (copyState) setCopyState("");
          }}
        />
      ) : (
        <>
          <input type="hidden" name={name} value={body} />
          <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        </>
      )}
    </section>
  );
}
