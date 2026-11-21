import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { WorkspaceData } from "../types";
import { CHART_COLORS } from "../lib/domain";
import { str } from "../lib/format";
import { listActiveChatGroupNames } from "../lib/chatRefs";
import { Field } from "./common";

export function ThemeColorPicker({ value }: { value?: string }) {
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

export function ThemeGroupPicker({
  value,
  themes,
}: {
  value?: string;
  themes: WorkspaceData["themes"];
}) {
  const [selected, setSelected] = useState(value || "");
  const groups = [...new Set(themes.map((theme) => str(theme.group).trim()).filter(Boolean))];
  return (
    <Field label="グループ">
      <input
        name="group"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        placeholder="新しいグループ名"
      />
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

export function ThemeStorageRootField({
  value,
  setToast,
}: {
  value?: string;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}) {
  // Theme ごとの保存先は #810 から新しい保存に使わない。前の版で指定した Theme だけ、場所を読むだけで出す。
  // 値は hidden で持ち回して消さない（前に公開した AI Context を同じ場所で更新・解除するのに使うため）。
  const pathValue = (value || "").trim();
  if (!pathValue) return null;
  async function openRoot() {
    const result = await workspaceApi.openPath(pathValue);
    if (!result.ok) setToast(`フォルダを開けませんでした。${result.error || ""}`, "danger");
  }
  return (
    <Field label="Artifact保存ルート（前の版の指定）">
      <input type="hidden" name="storage_root" value={pathValue} />
      <p className="field-help">
        前に置いたファイルはここに残ります。新しい保存は Tasken ルートの <code>Themes/識別子/</code>{" "}
        へ行きます。
      </p>
      <div className="theme-storage-root">
        <code className="theme-storage-root-path" title={pathValue}>
          {pathValue}
        </code>
        <div className="inline-actions">
          <button type="button" className="text-button compact" onClick={() => void openRoot()}>
            開く
          </button>
        </div>
      </div>
    </Field>
  );
}

export function ChatGroupPicker({
  value,
  resources,
  projectId,
}: {
  value?: string;
  resources: {
    chat_group?: string | null;
    project_id?: string | null;
    theme_id?: string | null;
    archived_at?: string | null;
  }[];
  projectId?: string | null;
}) {
  const [selected, setSelected] = useState(value || "");
  const groups = listActiveChatGroupNames(resources, projectId);
  return (
    <Field label="グループ">
      <input
        name="chat_group"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        placeholder="例: 〇〇モデル改善検討"
      />
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
