import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps, SnapshotChange, SnapshotPreview, Theme } from "../types";
import { entityTitle } from "../lib/domain";
import { PageHeader } from "../components/common";

interface SettingsPageProps extends PageProps {
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  activeGroup: string;
  setActiveGroup: (group: string) => void;
  allThemes: Theme[];
  loadSample: () => Promise<unknown>;
}

export function SettingsPage({ data, themeMode, setThemeMode, activeGroup, setActiveGroup, allThemes, setSnapshotPreview, snapshotPreview, setToast, loadSample }: SettingsPageProps) {
  const [busy, setBusy] = useState(false);
  const isEmpty = (data.themes.length + data.items.length + data.notes.length + data.links.length) === 0;

  async function addSample() {
    if (!isEmpty) {
      setToast("既にデータがあります。サンプルは追加されません。");
      return;
    }
    setBusy(true);
    try {
      await loadSample();
      await workspaceApi.reload();
    } catch (error) {
      setToast(`サンプルを追加できませんでした。${error instanceof Error ? error.message : String(error)}`);
      setBusy(false);
    }
  }

  async function exportSnapshot() {
    setBusy(true);
    try {
      const result = await workspaceApi.exportSnapshot();
      if (!result.canceled) setToast("作業台Snapshotを書き出しました。");
    } catch (error) {
      setToast(`Snapshotを書き出せませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function inspectSnapshot() {
    setBusy(true);
    try {
      const result = await workspaceApi.inspectSnapshot();
      if (!result.canceled && result.token) {
        const changes = (result.changes as SnapshotChange[] | undefined) || [];
        const preview: SnapshotPreview = {
          token: result.token,
          manifest: result.manifest,
          changes,
          decisions: Object.fromEntries(changes.map((change) => [change.key, change.action])),
        };
        setSnapshotPreview(preview);
      }
    } catch (error) {
      setToast(`Snapshotを読み込めませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function applySnapshot() {
    if (!snapshotPreview) return;
    setBusy(true);
    try {
      await workspaceApi.applySnapshot(snapshotPreview.token, snapshotPreview.decisions);
      await workspaceApi.reload();
    } catch (error) {
      setToast(`Snapshotを反映できませんでした。${error instanceof Error ? error.message : String(error)}`);
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Settings" />
      <div className="settings-grid">
        <section className="panel settings-form">
          <h2>表示</h2>
          <label>カラーモード
            <select value={themeMode} onChange={(event) => setThemeMode(event.target.value === "dark" ? "dark" : "light")}>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </label>
          <h2>テーマグループ</h2>
          <label>活動中のグループ
            <select value={activeGroup} onChange={(event) => setActiveGroup(event.target.value)}>
              <option value="">すべて表示</option>
              {[...new Set(allThemes.map((t) => t.group).filter(Boolean))].map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <p className="field-help">グループを選ぶと、サイドバーに表示されるテーマが絞り込まれます。テーマ編集でグループを設定してください。</p>
        </section>
        <section className="panel settings-form">
          <h2>バックアップ</h2>
          <p className="field-help">端末間の移行や復元にはZIP形式のSnapshotを使います。</p>
          <button className="secondary-button" disabled={busy} onClick={exportSnapshot}>バックアップを書き出す</button>
          <button className="secondary-button" disabled={busy} onClick={inspectSnapshot}>バックアップを読み込む</button>
          <h2>サンプルデータ</h2>
          <p className="field-help">{isEmpty ? "空の状態です。研究テーマ・タスクの例を入れて操作を試せます（あとから削除できます）。" : "既にデータがあるため、サンプルは追加できません。"}</p>
          <button className="secondary-button" disabled={busy || !isEmpty} onClick={addSample}>サンプルデータを入れる</button>
        </section>
      </div>
      {snapshotPreview && (
        <section className="panel snapshot-preview">
          <div className="section-heading"><h2>Snapshot差分</h2><span>{snapshotPreview.changes.length}件</span></div>
          {snapshotPreview.changes.map((change) => (
            <div className="import-candidate" key={change.key}>
              <div>
                <strong>{entityTitle(change.type, change.incoming)}</strong>
                <small>{change.type} / {change.category}</small>
              </div>
              <select value={snapshotPreview.decisions[change.key]} onChange={(event) => setSnapshotPreview({ ...snapshotPreview, decisions: { ...snapshotPreview.decisions, [change.key]: event.target.value } })}>
                {(change.actions || ["ignore"]).map((action) => (
                  <option key={action} value={action}>{action === "ignore" ? "無視" : action === "create" ? "新規作成" : action === "update" ? "既存を更新" : "両方残す"}</option>
                ))}
              </select>
            </div>
          ))}
          <div className="form-actions">
            <button className="secondary-button" onClick={() => setSnapshotPreview(null)}>取り消す</button>
            <button className="primary-button" disabled={busy} onClick={applySnapshot}>選択内容を反映</button>
          </div>
        </section>
      )}
    </div>
  );
}
