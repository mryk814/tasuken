import { useMemo, useState } from "react";

import type { BaseRecord, PageProps, SaveOperation, Theme } from "../types";
import { str, uuid } from "../lib/format";
import { assertImportCandidateSavable, parseAiImportPayload } from "../lib/aiImport.js";
import { buildSavePlanNodeOperations, buildSaveScheduleOperations, buildSaveTaskOperations, buildSaveWaitingOperations } from "../domain-model/persistence";
import type { PlanNode, Schedule, ScheduleOwnerType, Task, Waiting } from "../domain-model/types";
import { PageHeader } from "../components/common";

type ProposalPayloadType = "items" | "notes" | "links" | "knowledge_nodes" | "status_update";
type CandidateType = "item" | "note" | "link" | "knowledge_node" | "knowledge_edge";

interface ProposalCandidate {
  type: CandidateType;
  entry: Record<string, unknown>;
  theme?: Theme;
  duplicate?: BaseRecord;
  action: string;
  issues: string[];
}

interface ProposalPreview {
  candidates: ProposalCandidate[];
  payloadIssues: string[];
}

const PAYLOAD_TYPES: ProposalPayloadType[] = ["items", "notes", "links", "knowledge_nodes", "status_update"];

function parsePayload(raw: unknown, payloadType: ProposalPayloadType): Record<string, unknown> {
  if (typeof raw === "string") return JSON.parse(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { [payloadType]: [] };
  return raw as Record<string, unknown>;
}

function wrapPayload(payload: Record<string, unknown>, payloadType: ProposalPayloadType) {
  if (payloadType === "status_update") return payload;
  if (Array.isArray(payload[payloadType])) return payload;
  return { [payloadType]: Array.isArray(payload) ? payload : [payload] };
}

function buildPreview(proposal: BaseRecord, props: Pick<PageProps, "data" | "themes" | "items">): ProposalPreview {
  const payloadType = str(proposal.payload_type) as ProposalPayloadType;
  if (payloadType === "status_update") {
    return { candidates: [], payloadIssues: ["status_updateは内容確認後にProposalの状態だけ更新します"] };
  }
  const payload = wrapPayload(parsePayload(proposal.payload, payloadType), payloadType);
  return parseAiImportPayload(payload, props.themes, {
    items: props.items,
    notes: props.data.notes || [],
    links: props.data.links || [],
    knowledge_nodes: props.data.knowledge_nodes || [],
    knowledge_edges: props.data.knowledge_edges || [],
  });
}

function compact(value: unknown, limit = 220) {
  const text = str(value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function buildCandidateOperations(candidates: ProposalCandidate[]): SaveOperation[] {
  const operations: SaveOperation[] = [];
  const acceptedKnowledgeNodeIds = new Map<string, string>();
  for (const candidate of candidates.filter((entry) => entry.type === "knowledge_node")) {
    if (candidate.action === "ignore") continue;
    const base: Record<string, unknown> = candidate.action === "merge" && candidate.duplicate ? candidate.duplicate : {};
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
      },
      options: { source: "imported" },
    });
  }
  for (const candidate of candidates.filter((entry) => entry.type !== "knowledge_node")) {
    if (candidate.action === "ignore") continue;
    const base: Record<string, unknown> = candidate.action === "merge" && candidate.duplicate ? candidate.duplicate : {};
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
          source_url: str(entry.source_url) || str(base.source_url),
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
  }
  return operations;
}

export function ProposalInboxPage(props: PageProps) {
  const { data, themes, items, saveEntities, setToast } = props;
  const [payloadType, setPayloadType] = useState<ProposalPayloadType>("knowledge_nodes");
  const [sourceApp, setSourceApp] = useState("manual");
  const [rawPayload, setRawPayload] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<ProposalPreview | null>(null);
  const proposals = useMemo(() => (data.ai_proposals || []).filter((proposal) => str(proposal.status) === "pending"), [data.ai_proposals]);
  const selected = proposals.find((proposal) => proposal.id === selectedId) || proposals[0] || null;

  function previewProposal(proposal: BaseRecord) {
    try {
      setSelectedId(proposal.id);
      setPreview(buildPreview(proposal, { data, themes, items }));
    } catch (error) {
      setToast(`Proposalを解析できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function createProposal() {
    try {
      const payload = parsePayload(rawPayload, payloadType);
      await saveEntities([{
        action: "save",
        type: "ai_proposal",
        entity: {
          id: uuid(),
          source: "manual",
          source_app: sourceApp || "manual",
          payload_type: payloadType,
          status: "pending",
          payload,
        },
      }], "Proposalを追加しました。");
      setRawPayload("");
    } catch (error) {
      setToast(`Proposalを作成できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function rejectProposal(proposal: BaseRecord) {
    await saveEntities([{
      action: "save",
      type: "ai_proposal",
      entity: { ...proposal, status: "rejected" },
    }], "Proposalを却下しました。");
    setPreview(null);
  }

  async function acceptProposal(proposal: BaseRecord) {
    if (!preview) {
      previewProposal(proposal);
      return;
    }
    try {
      preview.candidates.forEach(assertImportCandidateSavable);
      const accepted = preview.candidates.filter((candidate) => candidate.action !== "ignore");
      const operations = buildCandidateOperations(preview.candidates);
      const status = accepted.length && accepted.length < preview.candidates.length ? "partially_accepted" : accepted.length ? "accepted" : "rejected";
      await saveEntities([
        ...operations,
        { action: "save", type: "ai_proposal", entity: { ...proposal, status } },
      ], status === "rejected" ? "Proposalを却下しました。" : "Proposalを採用しました。");
      setPreview(null);
    } catch (error) {
      setToast(`Proposalを採用できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="page">
      <PageHeader title="AI Proposal Inbox" subtitle="AIからの提案を保存前に確認します。" />
      <section className="panel io-panel">
        <div className="section-heading"><h2>Proposalを追加</h2></div>
        <div className="inline-actions">
          <select value={payloadType} onChange={(event) => setPayloadType(event.target.value as ProposalPayloadType)}>
            {PAYLOAD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input value={sourceApp} onChange={(event) => setSourceApp(event.target.value)} aria-label="source_app" />
        </div>
        <textarea value={rawPayload} onChange={(event) => setRawPayload(event.target.value)} placeholder='{"knowledge_nodes":[{"title":"確認する主張","node_type":"claim"}]}' />
        <button className="secondary-button" onClick={createProposal}>Pendingに入れる</button>
      </section>
      <section className="panel import-preview">
        <div className="section-heading"><h2>Pending</h2><span>{proposals.length}件</span></div>
        {!proposals.length && <div className="empty-state"><strong>Pending proposalはありません</strong></div>}
        {proposals.map((proposal) => (
          <div className="import-candidate" key={proposal.id}>
            <div>
              <strong>{str(proposal.payload_type)}</strong>
              <small>{str(proposal.source)} / {str(proposal.source_app) || "source_appなし"} / {str(proposal.created_at).slice(0, 10) || "日付なし"}</small>
              <p className="field-help">{compact(JSON.stringify(proposal.payload))}</p>
            </div>
            <div className="inline-actions">
              <button className="secondary-button compact" onClick={() => previewProposal(proposal)}>Preview</button>
              <button className="danger-button compact" onClick={() => rejectProposal(proposal)}>却下</button>
            </div>
          </div>
        ))}
      </section>
      {selected && preview && (
        <section className="panel import-preview">
          <div className="section-heading"><h2>Preview</h2><span>{preview.candidates.length}件</span></div>
          {preview.payloadIssues.length > 0 && <p className="alert-note warning">注意: {preview.payloadIssues.join(" / ")}</p>}
          {preview.candidates.map((candidate, index) => (
            <div className="import-candidate" key={`${candidate.type}-${str(candidate.entry.title)}-${index}`}>
              <div>
                <strong>{str(candidate.entry.title) || str(candidate.entry.relation_type) || "無題"}</strong>
                <small>{candidate.type} / {candidate.theme?.name || "Theme未解決"}{candidate.duplicate ? ` / 既存候補: ${str(candidate.duplicate.title)}` : ""}</small>
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
            <button className="secondary-button" onClick={() => setPreview(null)}>閉じる</button>
            <button className="primary-button" onClick={() => acceptProposal(selected)}>採用を保存</button>
          </div>
        </section>
      )}
    </div>
  );
}
