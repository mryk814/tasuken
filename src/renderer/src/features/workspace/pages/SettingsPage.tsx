import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps, SnapshotChange, SnapshotPreview, Theme } from "../types";
import { entityTitle } from "../lib/domain";
import { PageHeader } from "../components/common";
import { validateInvariants, formatViolations } from "../domain-model/invariants";

interface SettingsPageProps extends PageProps {
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  activeGroups: string[];
  setActiveGroups: (groups: string[]) => void;
  allThemes: Theme[];
  loadSample: () => Promise<unknown>;
}

export function SettingsPage({ data, domain, themeMode, setThemeMode, activeGroups, setActiveGroups, allThemes, setSnapshotPreview, snapshotPreview, setToast, loadSample }: SettingsPageProps) {
  const [busy, setBusy] = useState(false);
  const [healthResult, setHealthResult] = useState<string | null>(null);
  const isEmpty = (data.themes.length + domain.tasks.length + domain.waitings.length + domain.plan_nodes.length + domain.capture_entries.length + domain.notes.length + domain.resources.length) === 0;

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
          <p className="field-help">選択したグループに属するテーマだけを表示します。未選択なら全テーマを表示します。</p>
          {(() => {
            const groups = [...new Set(allThemes.map((t) => t.group).filter(Boolean))] as string[];
            const toggle = (group: string) => {
              setActiveGroups(activeGroups.includes(group) ? activeGroups.filter((g) => g !== group) : [...activeGroups, group]);
            };
            return groups.length > 0 ? (
              <div className="group-chip-list">
                {groups.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`theme-chip ${activeGroups.includes(g) ? "is-selected" : ""}`}
                    onClick={() => toggle(g)}
                  >
                    {g}
                  </button>
                ))}
                {activeGroups.length > 0 && (
                  <button type="button" className="text-button compact" onClick={() => setActiveGroups([])}>すべて表示に戻す</button>
                )}
              </div>
            ) : (
              <p className="field-help">テーマにグループが設定されていません。テーマ編集でグループを設定してください。</p>
            );
          })()}
        </section>
        <section className="panel settings-form">
          <h2>データ整合性チェック</h2>
          <p className="field-help">ドメインモデルの不変条件（参照整合、循環依存、重複、状態矛盾）を検証します。</p>
          <button className="secondary-button" onClick={() => {
            const violations = validateInvariants(domain);
            setHealthResult(formatViolations(violations));
            if (!violations.length) setToast("すべての不変条件を満たしています。");
          }}>整合性をチェック</button>
          {healthResult && (
            <pre className="health-result" style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-size-small)", marginTop: "var(--spacing-sm)", padding: "var(--spacing-sm)", background: "var(--color-surface-sunken)", borderRadius: "var(--radius-default)" }}>{healthResult}</pre>
          )}
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
