import { useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, PageProps, SaveOperation, Theme } from "../types";
import { str, uuid } from "../lib/format";
import { buildSaveTaskOperations, buildSaveWaitingOperations, buildSavePlanNodeOperations, buildSaveScheduleOperations } from "../domain-model/persistence";
import type { Task, Waiting, PlanNode, Schedule, ScheduleOwnerType } from "../domain-model/types";
import { AI_IMPORT_SCHEMA, assertImportCandidateSavable, buildAiImportPrompt, buildAiOrganizePrompt, parseAiImportPayload } from "../lib/aiImport.js";
import { buildExportData, exportMarkdown, exportProgressReport, noteProperties, notePublishEnabled, toYaml } from "../lib/io";
import { PageHeader } from "../components/common";
import { AiProposalPanel } from "../components/AiProposalPanel";

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

function compactText(value: unknown, limit = 180): string {
  const textValue = str(value).replace(/\s+/g, " ").trim();
  if (!textValue) return "";
  return textValue.length > limit ? `${textValue.slice(0, limit - 1)}...` : textValue;
}

function sortByDateDesc<T>(records: T[], fields: string[]): T[] {
  return [...records].sort((a, b) => {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const av = fields.map((field) => str(aRecord[field])).find(Boolean) || "";
    const bv = fields.map((field) => str(bRecord[field])).find(Boolean) || "";
    return bv.localeCompare(av);
  });
}

function buildOrganizeContext({ data, domain, themes, activeTheme }: Pick<PageProps, "data" | "domain" | "themes" | "activeTheme">): string {
  const themeName = (id?: string | null) => themes.find((theme) => theme.id === id)?.name || "Themeなし";
  const targetThemeIds = activeTheme ? new Set([activeTheme.id]) : null;
  const inScope = (id?: string | null) => !targetThemeIds || (id != null && targetThemeIds.has(id));
  const scheduleByOwner = new Map(domain.schedules.map((schedule) => [`${schedule.owner_type}:${schedule.owner_id}`, schedule]));
  const dateFor = (ownerType: "task" | "waiting" | "plan_node", id: string) => {
    const schedule = scheduleByOwner.get(`${ownerType}:${id}`);
    return str(schedule?.end_date || schedule?.start_date) || "予定なし";
  };
  const activeThemes = activeTheme ? [activeTheme] : themes.slice(0, 12);
  const statusUpdates = sortByDateDesc((data.status_updates || []).filter((entry) => inScope(str(entry.theme_id) || null)), ["date", "updated_at", "created_at"]).slice(0, 8);
  const openTasks = domain.tasks
    .filter((task) => inScope(task.project_id) && task.state !== "done" && task.state !== "cancelled")
    .sort((a, b) => dateFor("task", a.id).localeCompare(dateFor("task", b.id)))
    .slice(0, 20);
  const openWaitings = domain.waitings
    .filter((waiting) => inScope(waiting.project_id) && waiting.state === "waiting")
    .sort((a, b) => dateFor("waiting", a.id).localeCompare(dateFor("waiting", b.id)))
    .slice(0, 12);
  const inbox = domain.capture_entries
    .filter((entry) => entry.state === "untriaged")
    .sort((a, b) => str(b.captured_at).localeCompare(str(a.captured_at)))
    .slice(0, 15);
  const recentNotes = sortByDateDesc(domain.notes.filter((note) => inScope(note.project_id)), ["updated_at", "created_at"]).slice(0, 10);
  const recentResources = sortByDateDesc(domain.resources.filter((resource) => inScope(resource.project_id)), ["captured_at", "updated_at", "created_at"]).slice(0, 8);
  const unresolvedQuestions = domain.knowledge_nodes
    .filter((node) => inScope(node.project_id) && node.node_type === "question")
    .slice(0, 12);
  const lines = [
    "# Active Theme",
    ...(activeThemes.length
      ? activeThemes.map((theme) => `- ${theme.name}: ${compactText(theme.description || "") || "説明なし"}`)
      : ["- なし"]),
    "",
    "# 最近の現在地",
    ...(statusUpdates.length
      ? statusUpdates.map((entry) => `- ${str(entry.date) || "日付なし"} / ${themeName(str(entry.theme_id) || null)}: ${compactText(entry.summary || entry.next_actions || entry.risks)}`)
      : ["- なし"]),
    "",
    "# 未完了タスク",
    ...(openTasks.length
      ? openTasks.map((task) => `- ${dateFor("task", task.id)} / ${themeName(task.project_id)} / ${task.state}${task.priority === "high" ? " / high" : ""}: ${task.title}${task.description ? ` - ${compactText(task.description)}` : ""}`)
      : ["- なし"]),
    "",
    "# Waiting",
    ...(openWaitings.length
      ? openWaitings.map((waiting) => `- ${dateFor("waiting", waiting.id)} / ${themeName(waiting.project_id)} / 相手:${waiting.waiting_for}: ${waiting.title}${waiting.next_action ? ` / 次:${compactText(waiting.next_action)}` : ""}`)
      : ["- なし"]),
    "",
    "# 未整理Inbox",
    ...(inbox.length
      ? inbox.map((entry) => `- ${str(entry.captured_at).slice(0, 10) || "日付なし"}: ${compactText(entry.title || entry.text, 220)}`)
      : ["- なし"]),
    "",
    "# 最近のメモ要約",
    ...(recentNotes.length
      ? recentNotes.map((note) => `- ${themeName(note.project_id)} / ${note.title}: ${compactText(note.body_markdown, 220)}`)
      : ["- なし"]),
    "",
    "# 最近のリンク・資料",
    ...(recentResources.length
      ? recentResources.map((resource) => `- ${themeName(resource.project_id)} / ${resource.link_type || "resource"}: ${resource.title}${resource.url ? ` (${resource.url})` : ""}${resource.description ? ` - ${compactText(resource.description)}` : ""}`)
      : ["- なし"]),
    "",
    "# 既存ナレッジの未解決Question",
    ...(unresolvedQuestions.length
      ? unresolvedQuestions.map((node) => `- ${themeName(node.project_id)}: ${node.title}${node.body ? ` - ${compactText(node.body)}` : ""}`)
      : ["- なし"]),
  ];
  return lines.join("\n");
}

export function ImportExportPage(props: PageProps) {
  const { data, domain, themes, items, activeTheme, saveEntities, setToast } = props;
  const [format, setFormat] = useState("markdown");
  const [scope, setScope] = useState("all");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const [showOrganizeContext, setShowOrganizeContext] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const exportData = useMemo(() => buildExportData({ data, domain, themes, items, activeTheme, scope }), [data, domain, themes, items, activeTheme, scope]);
  const exported = format === "json"
    ? JSON.stringify({ version: 2, exported_at: new Date().toISOString(), ...exportData }, null, 2)
    : format === "yaml"
      ? toYaml(exportData)
      : format === "report"
        ? exportProgressReport(exportData)
        : exportMarkdown(exportData);
  const themeNames = themes.map((theme) => theme.name).join("\n");
  const conversionPromptText = useMemo(() => buildAiImportPrompt(themeNames, exported), [themeNames, exported]);
  const organizeContext = useMemo(() => buildOrganizeContext({ data, domain, themes, activeTheme }), [data, domain, themes, activeTheme]);
  const externalContextPromptText = useMemo(() => buildAiOrganizePrompt(organizeContext), [organizeContext]);
  const publishTargetNotes = useMemo(() => {
    const notes = scope === "theme" && activeTheme
      ? (data.notes || []).filter((note) => note.theme_id === activeTheme.id)
      : data.notes || [];
    return [...notes]
      .filter((note) => (str(note.content_format) || (str(note.note_type) === "artifact" ? "markdown" : "")) === "markdown")
      .filter((note) => str(note.body_markdown).trim())
      .sort((a, b) => str(b.updated_at || b.created_at).localeCompare(str(a.updated_at || a.created_at)));
  }, [activeTheme, data.notes, scope]);
  const publishEnabledCount = publishTargetNotes.filter(notePublishEnabled).length;

  async function publishWordTargets() {
    const targets = publishTargetNotes.filter(notePublishEnabled);
    if (!targets.length) {
      setToast("Publish対象のMarkdown文書がありません。");
      return;
    }
    setPublishing(true);
    try {
      const operations: SaveOperation[] = [];
      let directory = "";
      let exportedCount = 0;
      for (const note of targets) {
        const properties = noteProperties(note);
        const wordExport = properties.word_export && typeof properties.word_export === "object" && !Array.isArray(properties.word_export)
          ? properties.word_export as Record<string, unknown>
          : {};
        const result = await workspaceApi.exportMarkdownNoteToWord({
          title: str(note.title),
          bodyMarkdown: str(note.body_markdown),
          themeName: themes.find((theme) => theme.id === note.theme_id)?.name || null,
          directory: str(wordExport.directory) || directory || null,
          chooseDirectory: !str(wordExport.directory) && !directory,
        });
        if (result.canceled) {
          if (!exportedCount) setToast("Word出力をキャンセルしました。");
          break;
        }
        directory = result.directory || directory;
        exportedCount += 1;
        operations.push({
          action: "save",
          type: "note",
          entity: {
            ...note,
            properties_json: {
              ...properties,
              publish_enabled: true,
              word_export: {
                directory: result.directory,
                filePath: result.filePath,
                exportedAt: result.exportedAt,
                bodySignature: result.bodySignature,
              },
            },
          },
        });
      }
      if (operations.length) await saveEntities(operations, `${exportedCount}件のWord出力を更新しました。`);
    } catch (error) {
      setToast(`Word出力に失敗しました。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPublishing(false);
    }
  }

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
          type: "resource",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            title: str(entry.title) || "無題",
            url: str(entry.url) || str(base.url),
            link_type: str(entry.link_type) || str(base.link_type) || "other",
            project_id: candidate.theme?.id || str(base.theme_id) || null,
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

  return (
    <div className="page">
      <PageHeader title="AI連携" subtitle="外部AIへ渡し、戻ってきた候補を確認してTaskenに取り込みます。" />
      <section className="panel ai-handoff-panel">
        <div className="section-heading"><h2>AIに整理を頼む</h2></div>
        <div className="prompt-mode-grid">
          <div className="prompt-mode">
            <strong>形式変換プロンプト</strong>
            <p>手元のメモ、会話、箇条書き、表を指定スキーマの候補JSONへ変換します。</p>
            <button className="primary-button" onClick={() => workspaceApi.copyText(conversionPromptText).then(() => setToast("形式変換プロンプトをコピーしました。"))}>形式変換をコピー</button>
          </div>
          <div className="prompt-mode is-featured">
            <strong>外部AIから持ち帰るプロンプト</strong>
            <p>ChatGPT / Claude / Gemini 側が把握している会話や資料から、Taskenに戻す候補JSONを作ります。</p>
            <button className="primary-button" onClick={() => workspaceApi.copyText(externalContextPromptText).then(() => setToast("外部AI持ち帰りプロンプトをコピーしました。"))}>持ち帰り用をコピー</button>
          </div>
        </div>
        <div className="ai-handoff-steps">
          <div className="ai-handoff-step">
            <span className="ai-handoff-num">1</span>
            <div>
              <strong>プロンプトを選ぶ</strong>
              <p>形式変換は手元テキストのJSON化、持ち帰り用は外部AI側の文脈から候補作成。ChatGPT / Claude / Gemini 等に貼り付けてください。</p>
              <div className="inline-actions" style={{ marginTop: "var(--space-2)" }}>
                <select aria-label="書き出す範囲" value={scope} onChange={(event) => setScope(event.target.value)}>
                  <option value="all">全体</option>
                  <option value="theme">選択中Theme</option>
                  <option value="week">今後7日</option>
                  <option value="month">今後30日</option>
                  <option value="open">未完了タスク</option>
                  <option value="waiting">Waitingのみ</option>
                </select>
                <button className="secondary-button" onClick={() => setShowOrganizeContext((current) => !current)}>Tasken側の手がかりを見る</button>
              </div>
            </div>
          </div>
          <div className="ai-handoff-step">
            <span className="ai-handoff-num">2</span>
            <div>
              <strong>AIの出力を貼り付け</strong>
              <p>AIが返したJSONをそのまま下の入力欄に貼り付けてください。</p>
            </div>
          </div>
          <div className="ai-handoff-step">
            <span className="ai-handoff-num">3</span>
            <div>
              <strong>候補を確認して取り込む</strong>
              <p>重複チェック・Theme解決の結果をプレビューしてから保存します。</p>
            </div>
          </div>
        </div>
        {showOrganizeContext && (
          <div className="context-preview-block">
            <div className="section-heading">
              <h2>外部AIに渡すTasken側の手がかり</h2>
              <button className="secondary-button compact" onClick={() => workspaceApi.copyText(organizeContext).then(() => setToast("Tasken側の手がかりをコピーしました。"))}>コピー</button>
            </div>
            <textarea readOnly value={organizeContext} />
          </div>
        )}
      </section>
      <div className="io-grid">
        <section className="panel io-panel">
          <div className="section-heading">
            <h2>読み込む</h2>
            <div className="inline-actions">
              <button className="text-button compact" onClick={() => setShowSchema((current) => !current)}>入力JSONの形式を見る</button>
            </div>
          </div>
          {showSchema && (
            <pre className="schema-help">{AI_IMPORT_SCHEMA}</pre>
          )}
          <textarea value={text} onChange={(event) => { setText(event.target.value); setPreview(null); }} placeholder={'AIが返したJSONをここに貼り付けてください。\n\n{\n  "items": [\n    { "title": "測定結果を確認", "theme": "材料A評価", "planned_end": "2026-06-20" }\n  ]\n}'} />
          <button className="secondary-button" onClick={parseImport}>候補を確認</button>
        </section>
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
          <div className="export-target-panel">
            <div className="section-heading">
              <h2>Document Publish</h2>
              <div className="inline-actions">
                <span>Publish対象 {publishEnabledCount}件</span>
                <button className="secondary-button compact" disabled={publishing || !publishEnabledCount} onClick={publishWordTargets}>Publish対象をWord出力</button>
              </div>
            </div>
            <p className="field-help">
              対象の切り替えと出力先の確認は Notes または Note 詳細で行います。AI IO では、Publish対象になっているMarkdown文書だけをまとめてWord出力します。
            </p>
          </div>
          <textarea readOnly value={exported} />
          <div className="form-actions">
            <button className="primary-button" onClick={() => workspaceApi.copyText(exported).then(() => setToast("エクスポート内容をコピーしました。"))}>コピーする</button>
          </div>
        </section>
      </div>
      {preview && (
        <section className="panel import-preview">
          <div className="section-heading"><h2>取り込み候補</h2><span>{preview.candidates.length}件</span></div>
          {preview.payloadIssues.length > 0 && <p className="alert-note warning">注意: {preview.payloadIssues.join(" / ")}</p>}
          {preview.candidates.map((candidate, index) => (
            <div className="import-candidate" key={`${candidate.type}-${str(candidate.entry.title)}-${index}`}>
              <div>
                <strong>{str(candidate.entry.title) || "無題"}</strong>
                <small>{candidate.type} / {candidate.theme?.name || "Theme未解決"}{candidate.duplicate ? ` / 既存候補: ${str(candidate.duplicate.title)}` : ""} / source: {candidate.sourceRecordTitle}</small>
                {str(candidate.entry.reason) && <p className="field-help">理由: {str(candidate.entry.reason)}</p>}
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
      <AiProposalPanel {...props} />
    </div>
  );
}
