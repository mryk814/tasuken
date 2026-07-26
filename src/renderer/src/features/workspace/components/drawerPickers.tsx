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

export function ThemeGroupPicker({ value, themes }: { value?: string; themes: WorkspaceData["themes"] }) {
  const [selected, setSelected] = useState(value || "");
  const groups = [...new Set(themes.map((theme) => str(theme.group).trim()).filter(Boolean))];
  return (
    <Field label="グループ">
      <input name="group" value={selected} onChange={(event) => setSelected(event.target.value)} placeholder="新しいグループ名" />
      {groups.length > 0 && (
        <div className="group-chip-list">
          <button type="button" className={`theme-chip ${!selected ? "is-selected" : ""}`} onClick={() => setSelected("")}>
            なし
          </button>
          {groups.map((group) => (
            <button key={group} type="button" className={`theme-chip ${selected === group ? "is-selected" : ""}`} onClick={() => setSelected(group)}>
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
  const [pathValue, setPathValue] = useState(value || "");
  async function chooseRoot() {
    try {
      const result = await workspaceApi.chooseDirectory("ThemeのArtifact保存ルートを選択");
      if (result.canceled || !result.path) return;
      setPathValue(result.path);
    } catch (error) {
      setToast(`フォルダを選べませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }
  async function openRoot() {
    if (!pathValue) return;
    const result = await workspaceApi.openPath(pathValue);
    if (!result.ok) setToast(`フォルダを開けませんでした。${result.error || ""}`, "danger");
  }
  return (
    <Field label="Artifact保存ルート">
      <input type="hidden" name="storage_root" value={pathValue} />
      <p className="field-help">
        未設定なら Settings の共通保存先配下 <code>Themes/識別子/</code> に Artifacts・Notes・Exports を作ります。設定するとそのルート直下に同じ3フォルダを使います。
      </p>
      <div className="theme-storage-root">
        <code className="theme-storage-root-path" title={pathValue || undefined}>
          {pathValue || "未設定（自動配置）"}
        </code>
        <div className="inline-actions">
          <button type="button" className="secondary-button compact" onClick={() => void chooseRoot()}>フォルダを選ぶ</button>
          {pathValue && (
            <>
              <button type="button" className="text-button compact" onClick={() => void openRoot()}>開く</button>
              <button type="button" className="text-button compact" onClick={() => setPathValue("")}>クリア</button>
            </>
          )}
        </div>
      </div>
    </Field>
  );
}

export function ChatGroupPicker({ value, resources, projectId }: {
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
      <input name="chat_group" value={selected} onChange={(event) => setSelected(event.target.value)} placeholder="例: 〇〇モデル改善検討" />
      {groups.length > 0 && (
        <div className="group-chip-list">
          <button type="button" className={`theme-chip ${!selected ? "is-selected" : ""}`} onClick={() => setSelected("")}>
            なし
          </button>
          {groups.map((group) => (
            <button key={group} type="button" className={`theme-chip ${selected === group ? "is-selected" : ""}`} onClick={() => setSelected(group)}>
              {group}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}
