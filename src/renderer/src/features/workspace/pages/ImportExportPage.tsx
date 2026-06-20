import { useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, PageProps, SaveOperation, Theme } from "../types";
import { str, uuid } from "../lib/format";
import { buildSaveTaskOperations, buildSaveWaitingOperations, buildSavePlanNodeOperations, buildSaveScheduleOperations } from "../domain-model/persistence";
import type { Task, Waiting, PlanNode, Schedule, ScheduleOwnerType } from "../domain-model/types";
import { buildLegacyMigrationOperations, formatMigrationReport, type MigrationOperations } from "../domain-model/compat/legacyAdapter";
import { assertImportCandidateSavable, buildAiImportPrompt, parseAiImportPayload } from "../lib/aiImport.js";
import { buildExportData, exportMarkdown, exportProgressReport, toYaml } from "../lib/io";
import { PageHeader } from "../components/common";

type ImportEntry = Record<string, unknown>;

interface ImportCandidate {
  type: "item" | "note" | "link" | "knowledge_node" | "knowledge_edge";
  entry: ImportEntry;
  theme?: Theme;
  duplicate?: BaseRecord;
  action: string;
  issues: string[];
  sourceRecordTitle: string;
}

interface ImportPreview {
  candidates: ImportCandidate[];
  payloadIssues: string[];
}

export function ImportExportPage({ data, domain, themes, items, activeTheme, saveEntities, removeEntityQuiet, setToast }: PageProps) {
  const [format, setFormat] = useState("markdown");
  const [scope, setScope] = useState("all");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<MigrationOperations | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationSnapshotDone, setMigrationSnapshotDone] = useState(false);
  const [migrationConfirmed, setMigrationConfirmed] = useState(false);
  const exportData = useMemo(() => buildExportData({ data, domain, themes, items, activeTheme, scope }), [data, domain, themes, items, activeTheme, scope]);
  const exported = format === "json"
    ? JSON.stringify({ version: 2, exported_at: new Date().toISOString(), ...exportData }, null, 2)
    : format === "yaml"
      ? toYaml(exportData)
      : format === "report"
        ? exportProgressReport(exportData)
        : exportMarkdown(exportData);
  const themeNames = themes.map((theme) => theme.name).join("\n");
  const promptText = useMemo(() => buildAiImportPrompt(themeNames, exported), [themeNames, exported]);

  function parseImport() {
    try {
      const parsed = parseAiImportPayload(text, themes, {
        items,
        notes: data.notes || [],
        links: data.links || [],
        knowledge_nodes: data.knowledge_nodes || [],
        knowledge_edges: data.knowledge_edges || [],
      });
      setPreview(parsed);
    } catch (error) {
      setToast(`内容を解析できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function executeImport() {
    if (!preview) return;
    try {
      preview.candidates.forEach(assertImportCandidateSavable);
    } catch (error) {
      setToast(`取り込めませんでした。${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const source: BaseRecord = {
      id: uuid(),
      source_type: "imported_json",
      source_title: `AI Import ${new Date().toLocaleString("ja-JP")}`,
      captured_at: new Date().toISOString(),
      raw_text: text,
      summary: `${preview.candidates.length}件の候補`,
    };
    const operations: SaveOperation[] = [{ action: "save", type: "source_record", entity: source, options: { source: "imported" } }];
    let count = 0;
    const acceptedKnowledgeNodeIds = new Map<string, string>();
    for (const candidate of preview.candidates.filter((entry) => entry.type === "knowledge_node")) {
      if (candidate.action === "ignore") continue;
      const base: BaseRecord | Record<string, never> = candidate.action === "merge" && candidate.duplicate ? candidate.duplicate : {};
      const entry = candidate.entry;
      const id = str(base.id) || uuid();
      if (str(entry.temp_id)) acceptedKnowledgeNodeIds.set(str(entry.temp_id), id);
      operations.push({
        action: "save",
        type: "knowledge_node",
        entity: {
          ...base,
          id,
          node_type: str(entry.node_type) || "insight",
          title: str(entry.title) || "無題",
          body: str(entry.body),
          theme_id: candidate.theme?.id || str(base.theme_id) || null,
          source_note_id: str(entry.source_note_id) || str(base.source_note_id) || null,
          source_link_id: str(entry.source_link_id) || str(base.source_link_id) || null,
          source_item_id: str(entry.source_item_id) || str(base.source_item_id) || null,
          confidence: str(entry.confidence) || str(base.confidence) || "medium",
          status: str(entry.status) || str(base.status) || "active",
          source_record_id: source.id,
        },
        options: { source: "imported" },
      });
      count += 1;
    }
    for (const candidate of preview.candidates.filter((entry) => entry.type !== "knowledge_node")) {
      if (candidate.action === "ignore") continue;
      const base: BaseRecord | Record<string, never> = candidate.action === "merge" && candidate.duplicate ? candidate.duplicate : {};
      const entry = candidate.entry;
      if (candidate.type === "item") {
        const kind = str(entry.kind) || str(base.kind) || "task";
        const entityId = str(base.id) || uuid();
        const themeId = candidate.theme?.id || str(base.theme_id) || null;
        if (kind === "waiting") {
          const waiting: Waiting = {
            id: entityId,
            project_id: themeId,
            title: str(entry.title) || "無題",
            description: str(entry.description) || str(base.description) || null,
            waiting_for: str(entry.waiting_for) || "未設定",
            state: "waiting",
            source_record_id: source.id,
          };
          operations.push(...buildSaveWaitingOperations(waiting, { source: "import" }));
        } else if (kind === "milestone" || kind === "period") {
          const planNode: PlanNode = {
            id: entityId,
            project_id: themeId,
            title: str(entry.title) || "無題",
            description: str(entry.description) || str(base.description) || null,
            type: kind === "milestone" ? "milestone" : "phase",
            state: "planned",
            sort_order: 0,
            source_record_id: source.id,
          };
          operations.push(...buildSavePlanNodeOperations(planNode, { source: "import" }));
        } else {
          const task: Task = {
            id: entityId,
            project_id: themeId,
            title: str(entry.title) || "無題",
            description: str(entry.description) || str(base.description) || null,
            state: (str(entry.status) || str(base.status) || "todo") as Task["state"],
            priority: str(entry.priority) === "high" || entry.priority === true ? "high" : "normal",
            source_record_id: source.id,
          };
          operations.push(...buildSaveTaskOperations(task, { source: "import" }));
        }
        const startDate = str(entry.planned_start) || null;
        const endDate = str(entry.planned_end) || null;
        if (startDate || endDate) {
          const ownerType: ScheduleOwnerType = kind === "waiting" ? "waiting" : kind === "milestone" || kind === "period" ? "plan_node" : "task";
          const schedule: Schedule = {
            id: uuid(),
            owner_type: ownerType,
            owner_id: entityId,
            start_date: startDate,
            end_date: endDate,
            date_kind: startDate && endDate ? "range" : endDate ? "deadline" : "point",
            confidence: "fixed",
            granularity: "day",
          };
          operations.push(...buildSaveScheduleOperations(schedule, { source: "import" }));
        }
      } else if (candidate.type === "note") {
        operations.push({
          action: "save",
          type: "note",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            title: str(entry.title) || "無題",
            body_markdown: str(entry.body_markdown) || str(entry.body),
            note_type: str(entry.note_type) || str(base.note_type) || "memo",
            theme_id: candidate.theme?.id || str(base.theme_id) || null,
            item_id: str(entry.item_id) || str(base.item_id) || null,
            source_url: str(entry.source_url) || str(base.source_url),
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
      } else if (candidate.type === "link") {
        operations.push({
          action: "save",
          type: "link",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            title: str(entry.title) || "無題",
            url: str(entry.url) || str(base.url),
            link_type: str(entry.link_type) || str(base.link_type) || "other",
            theme_id: candidate.theme?.id || str(base.theme_id) || null,
            item_id: str(entry.item_id) || str(base.item_id) || null,
            description: str(entry.description) || str(base.description),
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
      } else if (candidate.type === "knowledge_edge") {
        const sourceNodeId = str(entry.source_node_id) || acceptedKnowledgeNodeIds.get(str(entry.source_temp_id)) || "";
        const targetNodeId = str(entry.target_node_id) || acceptedKnowledgeNodeIds.get(str(entry.target_temp_id)) || "";
        if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) continue;
        operations.push({
          action: "save",
          type: "knowledge_edge",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            relation_type: str(entry.relation_type) || str(base.relation_type) || "supports",
            description: str(entry.description) || str(base.description),
          },
          options: { source: "imported" },
        });
      }
      count += 1;
    }
    operations.push({
      action: "save",
      type: "import_batch",
      entity: {
        id: uuid(),
        source: String(source.source_type),
        status: "completed",
        count,
        raw_text: text,
        source_record_id: source.id,
      },
      options: { source: "imported" },
    });
    await saveEntities(operations, `${count}件を取り込みました。`);
    setPreview(null);
    setText("");
  }

  function previewMigration() {
    try {
      const result = buildLegacyMigrationOperations(data);
      setMigrationPreview(result);
    } catch (error) {
      setToast(`マイグレーション候補の生成に失敗しました。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function createMigrationSnapshot() {
    try {
      await workspaceApi.exportSnapshot();
      setMigrationSnapshotDone(true);
      setToast("スナップショットを保存しました。マイグレーションを実行できます。");
    } catch (error) {
      setToast(`スナップショットの保存に失敗しました。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function executeMigration() {
    if (!migrationPreview || !migrationSnapshotDone || !migrationConfirmed) return;
    setMigrating(true);
    try {
      if (migrationPreview.saveOperations.length) {
        await saveEntities(migrationPreview.saveOperations, `${migrationPreview.saveOperations.length}件のv2エンティティを保存しました。`);
      }
      for (const id of migrationPreview.deleteItemIds) {
        await removeEntityQuiet("item", id);
      }
      for (const id of migrationPreview.deleteLinkIds) {
        await removeEntityQuiet("link", id);
      }
      for (const id of migrationPreview.deleteThemeIds) {
        await removeEntityQuiet("theme", id);
      }
      const deletedCount = migrationPreview.deleteItemIds.length + migrationPreview.deleteLinkIds.length + migrationPreview.deleteThemeIds.length;
      setToast(`マイグレーション完了: ${deletedCount}件のlegacyエンティティを削除しました。`);
      setMigrationPreview(null);
      setMigrationSnapshotDone(false);
      setMigrationConfirmed(false);
    } catch (error) {
      setToast(`マイグレーションに失敗しました。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMigrating(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="AI Import / Export" subtitle="構造化データをプレビューしてから安全に取り込みます。" />
      <div className="io-grid">
        <section className="panel io-panel">
          <div className="section-heading">
            <h2>書き出す</h2>
            <div className="inline-actions">
              <select aria-label="書き出す範囲" value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="all">全体</option>
                <option value="theme">選択中Theme</option>
                <option value="week">今後7日</option>
                <option value="month">今後30日</option>
                <option value="quarter">今後90日</option>
                <option value="open">未完了タスク</option>
                <option value="waiting">Waitingのみ</option>
                <option value="recent_notes">直近メモ</option>
                <option value="milestones">マイルストーン</option>
              </select>
              <select aria-label="書き出し形式" value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="markdown">AI Context Markdown</option>
                <option value="report">週報 / 現在地レポート</option>
                <option value="yaml">YAML</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>
          <textarea readOnly value={exported} />
          <div className="form-actions">
            <button className="primary-button" onClick={() => workspaceApi.copyText(exported).then(() => setToast("エクスポート内容をコピーしました。"))}>コピーする</button>
            <button className="secondary-button" onClick={() => workspaceApi.copyText(promptText).then(() => setToast("AI依頼プロンプトをコピーしました。"))}>プロンプトをコピー</button>
          </div>
        </section>
        <section className="panel io-panel">
          <div className="section-heading">
            <h2>読み込む</h2>
            <div className="inline-actions">
              <span>タスク / メモ / リンク / Knowledge</span>
              <button className="text-button compact" onClick={() => setShowSchema((current) => !current)}>入力JSONの形式を見る</button>
            </div>
          </div>
          {showSchema && (
            <pre className="schema-help">{`{
  "items": [{ "title": "測定結果を確認", "theme": "材料A評価", "kind": "task", "status": "todo", "priority": "normal", "planned_start": null, "planned_end": "2026-06-20", "description": "" }],
  "notes": [{ "title": "解析方針", "theme": "材料A評価", "note_type": "memo", "body": "条件Bを再確認する", "source_url": "" }],
  "links": [{ "title": "参考", "url": "https://example.com", "link_type": "paper", "theme": "材料A評価", "description": "" }],
  "knowledge_nodes": [{ "temp_id": "n1", "node_type": "claim", "title": "仮説", "theme": "材料A評価", "confidence": "medium" }],
  "knowledge_edges": []
}`}</pre>
          )}
          <textarea value={text} onChange={(event) => { setText(event.target.value); setPreview(null); }} placeholder={'{\n  "items": [\n    { "title": "測定結果を確認", "theme": "材料A評価", "planned_end": "2026-06-20" }\n  ],\n  "knowledge_nodes": [\n    { "temp_id": "n1", "node_type": "claim", "title": "測定条件Bが遅延要因", "theme": "材料A評価" }\n  ]\n}'} />
          <button className="secondary-button" onClick={parseImport}>候補を確認</button>
        </section>
      </div>
      {preview && (
        <section className="panel import-preview">
          <div className="section-heading"><h2>取り込み候補</h2><span>{preview.candidates.length}件</span></div>
          {preview.payloadIssues.length > 0 && <p className="field-help">注意: {preview.payloadIssues.join(" / ")}</p>}
          {preview.candidates.map((candidate, index) => (
            <div className="import-candidate" key={`${candidate.type}-${str(candidate.entry.title)}-${index}`}>
              <div>
                <strong>{str(candidate.entry.title) || "無題"}</strong>
                <small>{candidate.type} / {candidate.theme?.name || "Theme未解決"}{candidate.duplicate ? ` / 既存候補: ${str(candidate.duplicate.title)}` : ""} / source: {candidate.sourceRecordTitle}</small>
                {candidate.issues.length > 0 && <p className="field-help">確認: {candidate.issues.join(" / ")}</p>}
              </div>
              <select value={candidate.action} onChange={(event) => setPreview((current) => current ? { ...current, candidates: current.candidates.map((entry, itemIndex) => itemIndex === index ? { ...entry, action: event.target.value } : entry) } : current)}>
                <option value="create">新規作成</option>
                {candidate.duplicate && <option value="merge">既存を更新</option>}
                <option value="ignore">無視</option>
              </select>
            </div>
          ))}
          <div className="form-actions">
            <button className="secondary-button" onClick={() => setPreview(null)}>戻る</button>
            <button className="primary-button" onClick={executeImport}>取り込む</button>
          </div>
        </section>
      )}
      <section className="panel io-panel">
        <div className="section-heading">
          <h2>Legacy → v2 マイグレーション</h2>
          <span>{items.length}件のlegacy item</span>
        </div>
        {items.length === 0 ? (
          <p className="field-help">legacy item はありません。マイグレーション済みです。</p>
        ) : (
          <>
            <p className="field-help">既存のlegacy itemをv2エンティティ（Task / Waiting / PlanNode / CaptureEntry + Schedule）に変換し、legacy itemを削除します。</p>
            {!migrationPreview && (
              <div className="form-actions">
                <button className="secondary-button" onClick={previewMigration}>変換候補を確認</button>
              </div>
            )}
          </>
        )}
        {migrationPreview && (
          <div className="migration-preview">
            <pre className="schema-help">{formatMigrationReport(migrationPreview.report)}</pre>
            <p className="field-help">
              v2保存: {migrationPreview.saveOperations.length}件 /
              legacy削除: item {migrationPreview.deleteItemIds.length}件 / link {migrationPreview.deleteLinkIds.length}件 / theme {migrationPreview.deleteThemeIds.length}件
            </p>
            {migrationPreview.report.warnings.length > 0 && (
              <p className="field-help" style={{ color: "var(--color-danger)" }}>
                警告 {migrationPreview.report.warnings.length}件: 変換候補を確認してください
              </p>
            )}
            <div className="migration-safety">
              <p className="field-help">
                legacy itemを削除するとExport/Themes等で参照されていたデータが消えます。
                必ずスナップショットを保存してから実行してください。
              </p>
              <div className="form-actions">
                <button className="secondary-button" onClick={createMigrationSnapshot} disabled={migrationSnapshotDone}>
                  {migrationSnapshotDone ? "スナップショット保存済み" : "スナップショットを保存"}
                </button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-xs)", marginTop: "var(--spacing-xs)" }}>
                <input
                  type="checkbox"
                  checked={migrationConfirmed}
                  onChange={(event) => setMigrationConfirmed(event.target.checked)}
                  disabled={!migrationSnapshotDone}
                />
                変換レポートを確認し、legacy item/link/themeの削除に同意する
              </label>
            </div>
            <div className="form-actions">
              <button className="secondary-button" onClick={() => { setMigrationPreview(null); setMigrationSnapshotDone(false); setMigrationConfirmed(false); }}>戻る</button>
              <button className="primary-button" onClick={executeMigration} disabled={migrating || !migrationSnapshotDone || !migrationConfirmed}>
                {migrating ? "実行中..." : "マイグレーションを実行"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
