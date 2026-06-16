import { useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { parseSimpleYaml } from "../../../utils/dataFormat.js";
import type { BaseRecord, PageProps, SaveOperation, Theme } from "../types";
import { defaultLevel } from "../lib/domain";
import { num, str, uuid } from "../lib/format";
import { buildExportData, exportMarkdown, toYaml } from "../lib/io";
import { PageHeader } from "../components/common";

type ImportEntry = Record<string, unknown>;

interface ImportCandidate {
  type: "item" | "note" | "link";
  entry: ImportEntry;
  theme?: Theme;
  duplicate?: BaseRecord;
  action: string;
}

interface ImportPreview {
  candidates: ImportCandidate[];
}

export function ImportExportPage({ data, themes, items, activeTheme, saveEntities, setToast }: PageProps) {
  const [format, setFormat] = useState("markdown");
  const [scope, setScope] = useState("all");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const exportData = useMemo(() => buildExportData({ data, themes, items, activeTheme, scope }), [data, themes, items, activeTheme, scope]);
  const exported = format === "json"
    ? JSON.stringify({ version: 2, exported_at: new Date().toISOString(), ...exportData }, null, 2)
    : format === "yaml"
      ? toYaml(exportData)
      : exportMarkdown(exportData);

  function parseImport() {
    try {
      const raw = text.trim().startsWith("{") || text.trim().startsWith("[") ? JSON.parse(text) : parseSimpleYaml(text);
      const parsed: Record<string, unknown> = Array.isArray(raw) ? { items: raw } : raw;
      const asEntries = (key: string): ImportEntry[] => (parsed[key] as ImportEntry[] | undefined) || [];
      const candidates: ImportCandidate[] = [
        ...asEntries("items").map((entry) => ({ type: "item" as const, entry })),
        ...asEntries("tasks").map((entry) => ({ type: "item" as const, entry })),
        ...asEntries("notes").map((entry) => ({ type: "note" as const, entry })),
        ...asEntries("links").map((entry) => ({ type: "link" as const, entry })),
      ].map(({ type, entry }) => {
        const theme = themes.find((candidate) => candidate.id === entry.theme_id || candidate.name === entry.theme);
        const collection: BaseRecord[] = type === "item" ? items : type === "note" ? data.notes || [] : data.links || [];
        const duplicate = collection.find((candidate) => str(candidate.title).trim().toLowerCase() === str(entry.title).trim().toLowerCase());
        return { type, entry, theme, duplicate, action: duplicate ? "merge" : "create" };
      });
      if (!candidates.length) throw new Error("items、notes、linksのいずれかを含めてください。");
      setPreview({ candidates });
    } catch (error) {
      setToast(`内容を解析できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function executeImport() {
    if (!preview) return;
    const source: BaseRecord = {
      id: uuid(),
      source_type: text.trim().startsWith("{") ? "imported_json" : "imported_yaml",
      source_title: `AI Import ${new Date().toLocaleString("ja-JP")}`,
      captured_at: new Date().toISOString(),
      raw_text: text,
      summary: `${preview.candidates.length}件の候補`,
    };
    const operations: SaveOperation[] = [{ action: "save", type: "source_record", entity: source, options: { source: "imported" } }];
    let count = 0;
    for (const candidate of preview.candidates) {
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
            planned_start: str(entry.planned_start) || str(base.planned_start) || null,
            planned_end: str(entry.planned_end) || str(base.planned_end) || str(entry.due_date) || null,
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
      } else {
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
                <option value="open">未完了Item</option>
                <option value="waiting">Waitingのみ</option>
                <option value="recent_notes">直近メモ</option>
                <option value="milestones">マイルストーン</option>
              </select>
              <select aria-label="書き出し形式" value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="markdown">Markdown</option>
                <option value="yaml">YAML</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>
          <textarea readOnly value={exported} />
          <button className="primary-button" onClick={() => workspaceApi.copyText(exported).then(() => setToast("エクスポート内容をコピーしました。"))}>コピーする</button>
        </section>
        <section className="panel io-panel">
          <div className="section-heading"><h2>読み込む</h2><span>Item / Note / Link</span></div>
          <textarea value={text} onChange={(event) => { setText(event.target.value); setPreview(null); }} placeholder={'items:\n  - title: "測定結果を確認"\n    theme: "材料A評価"\nnotes:\n  - title: "解析方針"\n    body: "条件Bを再確認する"'} />
          <button className="secondary-button" onClick={parseImport}>候補を確認</button>
        </section>
      </div>
      {preview && (
        <section className="panel import-preview">
          <div className="section-heading"><h2>取り込み候補</h2><span>{preview.candidates.length}件</span></div>
          {preview.candidates.map((candidate, index) => (
            <div className="import-candidate" key={`${candidate.type}-${str(candidate.entry.title)}-${index}`}>
              <div>
                <strong>{str(candidate.entry.title) || "無題"}</strong>
                <small>{candidate.type} / {candidate.theme?.name || "Theme未解決"}{candidate.duplicate ? ` / 既存候補: ${str(candidate.duplicate.title)}` : ""}</small>
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
