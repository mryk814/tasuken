import type { KeyboardEvent, ReactNode } from "react";

import type { Theme } from "../types";

export function InlineAddPanel({
  heading,
  title,
  titlePlaceholder,
  theme,
  themes,
  onTitleChange,
  onThemeChange,
  onSubmit,
  submitLabel = "追加",
  extraFields,
}: {
  heading: string;
  title: string;
  titlePlaceholder: string;
  theme: string;
  themes: Theme[];
  onTitleChange: (value: string) => void;
  onThemeChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  extraFields?: ReactNode;
}) {
  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void onSubmit();
  }

  return (
    <section className="panel">
      <div className="section-heading"><h2>{heading}</h2></div>
      <div className="inline-add-panel">
        <input
          className="inline-add-title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          onKeyDown={submitOnEnter}
          placeholder={titlePlaceholder}
          autoFocus
        />
        {extraFields}
        <select value={theme} onChange={(event) => onThemeChange(event.target.value)}>
          <option value="">個人業務</option>
          {themes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <button className="primary-button compact" onClick={() => void onSubmit()}>{submitLabel}</button>
      </div>
    </section>
  );
}
