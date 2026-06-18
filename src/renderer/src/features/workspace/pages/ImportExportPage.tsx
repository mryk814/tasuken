import { useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, PageProps, SaveOperation, Theme } from "../types";
import { defaultLevel } from "../lib/domain";
import { num, str, uuid } from "../lib/format";
import { assertImportCandidateSavable, buildAiImportPrompt, parseAiImportPayload } from "../lib/aiImport.js";
import { buildExportData, exportMarkdown, exportProgressReport, toYaml } from "../lib/io";
import { PageHeader } from "../components/common";

type ImportEntry = Record<string, unknown>;

interface ImportCandidate {
  type: "item" | "note" | "link" | "knowledge_node" | "knowledge_relation";
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

export function ImportExportPage({ data, themes, items, activeTheme, saveEntities, setToast }: PageProps) {
  const [format, setFormat] = useState("markdown");
  const [scope, setScope] = useState("all");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const exportData = useMemo(() => buildExportData({ data, themes, items, activeTheme, scope }), [data, themes, items, activeTheme, scope]);
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
        knowledge_relations: data.knowledge_relations || [],
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
        operations.push({
          action: "save",
          type: "item",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            title: str(entry.title) || "無題",
            kind: str(entry.kind) || str(base.kind) || "task",
            level: str(entry.level) || str(base.level) || defaultLevel(str(entry.kind) || str(base.kind) || "task"),
            theme_id: candidate.theme?.id || str(base.theme_id) || null,
            status: str(entry.status) || str(base.status) || "todo",
            priority: str(entry.priority) === "high" || entry.priority === true ? "high" : "normal",
            planned_start: str(entry.planned_start) || null,
            planned_end: str(entry.planned_end) || null,
            due_date: null,
            schedule_confidence: "fixed",
            date_granularity: "day",
            progress: 0,
            description: str(entry.description) || str(base.description),
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
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
      } else if (candidate.type === "knowledge_relation") {
        const sourceNodeId = str(entry.source_node_id) || acceptedKnowledgeNodeIds.get(str(entry.source_temp_id)) || "";
        const targetNodeId = str(entry.target_node_id) || acceptedKnowledgeNodeIds.get(str(entry.target_temp_id)) || "";
        if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) continue;
        operations.push({
          action: "save",
          type: "knowledge_relation",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            relation_type: str(entry.relation_type) || str(base.relation_type) || "supports",
            description: str(entry.description) || str(base.description),
            confidence: str(entry.confidence) || str(base.confidence) || "medium",
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
  "knowledge_relations": []
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
    </div>
  );
}
