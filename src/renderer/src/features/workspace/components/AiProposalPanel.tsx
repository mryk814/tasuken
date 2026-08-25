import { useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconArchive, IconHistory, IconPencil, IconRefresh, IconShieldCheck } from "@tabler/icons-react";

import type { BaseRecord, PageProps, SaveOperation, Theme } from "../types";
import type { CommandEnvelope } from "../../../../../shared/applicationCommand";
import { str, uuid } from "../lib/format";
import { assertImportCandidateSavable, parseAiImportPayload } from "../lib/aiImport.js";
import { applyMarkdownDiffHunks, buildMarkdownDiffHunks, diffMarkdownLines } from "../lib/markdownEditing";
import { buildSavePlanNodeOperations, buildSaveScheduleOperations, buildSaveTaskOperations, buildSaveWaitingOperations } from "../domain-model/persistence";
import type { PlanNode, Schedule, ScheduleOwnerType, Task, Waiting } from "../domain-model/types";
import { validateArtifactProposal, validateSafeSvg } from "../../../../../shared/proposalMedia.mjs";
import { stableProposalEntityId } from "../../../../../shared/proposalAcceptance.mjs";
import { markdownSignature } from "../../../../../shared/canonicalMarkdown.mjs";
import { buildRepositoryContextProposalCandidate, buildRepositoryContextProposalOperations } from "../../../../../shared/repositoryContextProposal.mjs";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import { ActionButton, Button } from "./common";

type ProposalPayloadType = "items" | "notes" | "links" | "knowledge_nodes" | "sketches" | "artifacts" | "status_update" | "task_work" | "repository_contexts";
type CandidateType = "item" | "note" | "link" | "knowledge_node" | "knowledge_edge" | "sketch" | "artifact" | "task_work" | "repository_context";
const taskEntityType = "task" as const;

interface ProposalCandidate {
  type: CandidateType;
  entry: Record<string, unknown>;
  theme?: Theme;
  duplicate?: BaseRecord;
  action: string;
  issues: string[];
  acceptedHunks?: number[];
  normalized?: Record<string, unknown>;
}

interface ProposalPreview {
  candidates: ProposalCandidate[];
  payloadIssues: string[];
}

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

export function buildPreview(proposal: BaseRecord, props: Pick<PageProps, "data" | "themes" | "items">): ProposalPreview {
  const payloadType = str(proposal.payload_type) as ProposalPayloadType;
  if (payloadType === "status_update") {
    return { candidates: [], payloadIssues: ["status_updateは内容確認後にProposalの状態だけ更新します"] };
  }
  const payload = wrapPayload(parsePayload(proposal.payload, payloadType), payloadType);
  if (payloadType === "task_work") {
    const entries = Array.isArray(payload.task_work) ? payload.task_work as Record<string, unknown>[] : [];
    if (!entries.length) throw new Error("task_workがありません。");
    return {
      candidates: entries.map((entry) => ({ type: "task_work", entry, action: "create", issues: [] })),
      payloadIssues: ["Work Receiptの採用はTask本文を変更せず、typed work commandとして適用します。"],
    };
  }
  if (payloadType === "repository_contexts") {
    const entries = Array.isArray(payload.repository_contexts) ? payload.repository_contexts as Record<string, unknown>[] : [];
    if (!entries.length) throw new Error("repository_contextsがありません。");
    const contexts = (props.data.repository_contexts || []) as BaseRecord[];
    return {
      candidates: entries.map((entry) => {
        const candidate = buildRepositoryContextProposalCandidate(entry, contexts);
        return {
          type: "repository_context",
          entry: candidate.entry,
          normalized: candidate.normalized,
          duplicate: candidate.duplicate as BaseRecord | undefined,
          action: candidate.action,
          issues: candidate.issues,
        };
      }),
      payloadIssues: ["RepositoryContextはcredential-free normalized projectionを確認してから保存します。local pathはAI Proposalへ公開しません。"],
    };
  }
  if (payloadType === "sketches" || payloadType === "artifacts") {
    const entries = Array.isArray(payload[payloadType]) ? payload[payloadType] as Record<string, unknown>[] : [];
    if (!entries.length) throw new Error(`${payloadType}がありません。`);
    return {
      candidates: entries.map((entry) => {
        if (payloadType === "sketches") validateSafeSvg(entry.svg);
        else validateArtifactProposal(entry);
        const themeName = str(entry.theme);
        return {
          type: payloadType === "sketches" ? "sketch" : "artifact",
          entry,
          theme: props.themes.find((theme) => theme.id === themeName || str(theme.name) === themeName),
          action: "create",
          issues: themeName && !props.themes.some((theme) => theme.id === themeName || str(theme.name) === themeName)
            ? ["Themeを解決できないため未設定で保存します"]
            : [],
        };
      }),
      payloadIssues: [],
    };
  }
  const preview = parseAiImportPayload(payload, props.themes, {
    items: props.items,
    notes: props.data.notes || [],
    links: props.data.links || [],
    knowledge_nodes: props.data.knowledge_nodes || [],
    knowledge_edges: props.data.knowledge_edges || [],
  }) as ProposalPreview;
  preview.candidates = preview.candidates.map((candidate) => {
    const hunks = noteDiffHunks(candidate);
    return hunks.length ? { ...candidate, acceptedHunks: hunks.map((_, index) => index) } : candidate;
  });
  return preview;
}

function noteDiffHunks(candidate: ProposalCandidate) {
  if (candidate.type !== "note" || !candidate.duplicate || candidate.action !== "merge") return [];
  return buildMarkdownDiffHunks(
    diffMarkdownLines(str(candidate.duplicate.body_markdown), str(candidate.entry.body)),
    2,
  );
}

export function stabilizeProposalOperations(proposalId: string, operations: SaveOperation[], stableIndexes?: number[]): SaveOperation[] {
  const createdIdMap = new Map<string, string>();
  operations.forEach((operation, index) => {
    if (!Number.isInteger(operation.entity.version)) {
      createdIdMap.set(operation.entity.id, stableProposalEntityId(proposalId, operation.type, stableIndexes?.[index] ?? index));
    }
  });
  return operations.map((operation) => ({
    ...operation,
    entity: {
      ...operation.entity,
      id: createdIdMap.get(operation.entity.id) || operation.entity.id,
      ...(typeof operation.entity.owner_id === "string" && createdIdMap.has(operation.entity.owner_id)
        ? { owner_id: createdIdMap.get(operation.entity.owner_id) }
        : {}),
      ...(typeof operation.entity.source_node_id === "string" && createdIdMap.has(operation.entity.source_node_id)
        ? { source_node_id: createdIdMap.get(operation.entity.source_node_id) }
        : {}),
      ...(typeof operation.entity.target_node_id === "string" && createdIdMap.has(operation.entity.target_node_id)
        ? { target_node_id: createdIdMap.get(operation.entity.target_node_id) }
        : {}),
    },
  })) as SaveOperation[];
}

export function buildContentProposalDecisions(preview: ProposalPreview, forceIgnore = false) {
  return preview.candidates.map((candidate, entryIndex) => ({
    entryIndex,
    type: candidate.type as "note" | "knowledge_node" | "knowledge_edge" | "artifact" | "sketch",
    action: forceIgnore || candidate.action === "ignore" ? "ignore" as const : "accept" as const,
    ...(candidate.type === "note" && candidate.duplicate
      ? {
        acceptedHunks: [...(candidate.acceptedHunks || [])],
        beforeSignature: markdownSignature(str(candidate.duplicate.body_markdown)),
      }
      : {}),
  }));
}

export function buildCandidateOperations(candidates: ProposalCandidate[], repositoryContexts: BaseRecord[] = []): SaveOperation[] {
  const operations: SaveOperation[] = [];
  const repositoryCandidates = candidates
    .filter((entry) => entry.type === "repository_context")
    .map((entry) => ({
      ...entry,
      action: entry.action as "create" | "merge" | "ignore",
    }));
  operations.push(...buildRepositoryContextProposalOperations(
    repositoryCandidates,
    repositoryContexts,
  ) as SaveOperation[]);
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
  for (const candidate of candidates.filter((entry) => entry.type !== "knowledge_node" && entry.type !== "repository_context")) {
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
      const proposedBody = str(entry.body_markdown) || str(entry.body);
      const acceptedBody = candidate.action === "merge"
        && candidate.duplicate
        && candidate.acceptedHunks
        ? applyMarkdownDiffHunks(str(candidate.duplicate.body_markdown), proposedBody, candidate.acceptedHunks)
        : proposedBody;
      operations.push({
        action: "save",
        type: "note",
        entity: {
          ...base,
          id: str(base.id) || uuid(),
          title: str(entry.title) || "無題",
          body_markdown: acceptedBody,
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
    } else if (candidate.type === "sketch") {
      const svg = validateSafeSvg(entry.svg);
      operations.push({
        action: "save",
        type: "sketch",
        entity: {
          id: uuid(),
          title: str(entry.title) || "AI Sketch",
          project_id: candidate.theme?.id || null,
          origin_capture_id: null,
          document: {
            schema_version: 1,
            mode: "page",
            pages: [{
              id: uuid(),
              title: "1",
              width: 1200,
              height: 850,
              background: "dot",
              objects: [{
                id: uuid(),
                type: "image",
                color: "#000000",
                x: 40,
                y: 40,
                w: 1120,
                h: 770,
                data_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
              }],
            }],
          },
        },
        options: { source: "ai_proposal" },
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

export function AiProposalPanel(props: PageProps) {
  const { data, domain, themes, items, saveEntities, executeCommand, setToast } = props;
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<ProposalPreview | null>(null);
  const [quarantineId, setQuarantineId] = useState("");
  const [quarantineReason, setQuarantineReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshWorkspace = useWorkspaceStore((state) => state.refresh);
  const proposals = useMemo(() => (data.ai_proposals || []).filter((proposal) => str(proposal.status) === "pending"), [data.ai_proposals]);
  const history = useMemo(() => (data.ai_proposals || [])
    .filter((proposal) => str(proposal.status) !== "pending")
    .sort((a, b) => proposalTimestamp(b).localeCompare(proposalTimestamp(a))), [data.ai_proposals]);
  const selected = proposals.find((proposal) => proposal.id === selectedId) || proposals[0] || null;

  async function refreshProposals(): Promise<void> {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshWorkspace();
      setToast("Proposalを再取得しました。", "success");
    } catch (error) {
      setToast(`Proposalを再取得できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const resyncOnFocus = () => void refreshWorkspace().catch((error) => {
      setToast(`Proposalを再取得できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    });
    window.addEventListener("focus", resyncOnFocus);
    return () => window.removeEventListener("focus", resyncOnFocus);
  }, [refreshWorkspace, setToast]);

  function previewProposal(proposal: BaseRecord) {
    try {
      setSelectedId(proposal.id);
      setPreview(buildPreview(proposal, { data, themes, items }));
    } catch (error) {
      setToast(`Proposalを解析できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function rejectProposal(proposal: BaseRecord) {
    if (str(proposal.payload_type) === "task_work") {
      await executeCommand({
        commandId: `${proposal.id}:reject`,
        name: "ApplyTaskWorkProposal",
        payload: { proposalId: proposal.id, decision: "reject" },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [{ type: "ai_proposal", id: proposal.id, version: Number(proposal.version || 0) }],
        issuedAt: new Date().toISOString(),
      } as CommandEnvelope);
      setToast("Work proposalを却下しました。", "success");
      setPreview(null);
      return;
    }
    try {
      const rejectedPreview = buildPreview(proposal, { data, themes, items });
      const isContentProposal = ["notes", "knowledge_nodes", "sketches", "artifacts"].includes(str(proposal.payload_type));
      const decisions = isContentProposal ? buildContentProposalDecisions(rejectedPreview, true) : undefined;
      await executeCommand({
        commandId: `${proposal.id}:accept:v${Number(proposal.version || 0)}`,
        name: "ApplyAiProposal",
        payload: {
          proposal: { ...proposal, status: "rejected" },
          ...(isContentProposal ? { decision: "reject" as const, decisions } : {}),
          candidates: [],
        },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [{ type: "ai_proposal", id: proposal.id, version: Number(proposal.version || 0) }],
        issuedAt: str(proposal.received_at || proposal.created_at || proposal.updated_at) || new Date(0).toISOString(),
      } as CommandEnvelope);
      setToast("Proposalを却下しました。", "success");
      setPreview(null);
    } catch (error) {
      setToast(`Proposalを却下できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function quarantineProposal(proposal: BaseRecord) {
    const reason = quarantineReason.trim();
    if (!reason) {
      setToast("隔離理由を入力してください。", "warning");
      return;
    }
    await saveEntities([{
      action: "save",
      type: "ai_proposal",
      entity: { ...proposal, status: "quarantined", quarantine_reason: reason },
    }], "Proposalを隔離しました。");
    setQuarantineId("");
    setQuarantineReason("");
    setPreview(null);
  }

  async function acceptProposal(proposal: BaseRecord) {
    if (!preview) {
      previewProposal(proposal);
      return;
    }
    if (str(proposal.payload_type) === "task_work") {
      try {
        const candidate = preview.candidates.find((entry) => entry.action !== "ignore");
        if (!candidate) {
          await rejectProposal(proposal);
          return;
        }
        if (preview.candidates.filter((entry) => entry.action !== "ignore").length !== 1) throw new Error("Work proposalは1件ずつ採用してください。");
        const taskId = str(candidate.entry.task_id);
        const task = domain.tasks.find((entry) => entry.id === taskId);
        if (!task) throw new Error("対象Taskが見つかりません。Taskを再読み込みしてください。");
        const currentVersion = Number((task as unknown as BaseRecord).version || 0);
        const proposalExpectedVersion = Number(candidate.entry.expected_version);
        if (!Number.isInteger(proposalExpectedVersion) || proposalExpectedVersion < 0) throw new Error("Work proposalにexpected_versionがありません。再取得してから報告してください。");
        if (proposalExpectedVersion !== currentVersion) throw new Error(`Taskが更新されています（proposal: ${proposalExpectedVersion} / current: ${currentVersion}）。contextを再取得して報告し直してください。`);
        const expectedVersions = [{ type: taskEntityType, id: task.id, version: proposalExpectedVersion }];
        await executeCommand({
          commandId: `${proposal.id}:accept`,
          name: "ApplyTaskWorkProposal",
          payload: { proposalId: proposal.id, decision: "accept" },
          actor: { kind: "user" },
          source: "main_ui",
          expectedVersions: [
            ...expectedVersions,
            { type: "ai_proposal", id: proposal.id, version: Number(proposal.version || 0) },
          ],
          issuedAt: new Date().toISOString(),
        } as CommandEnvelope);
        setToast("Work proposalを採用しました。Task本文は変更していません。", "success");
        setPreview(null);
      } catch (error) {
        setToast(`Work proposalを採用できませんでした。${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    try {
      preview.candidates
        .filter((candidate) => candidate.type !== "sketch" && candidate.type !== "artifact" && candidate.type !== "repository_context")
        .forEach(assertImportCandidateSavable);
      preview.candidates
        .filter((candidate) => candidate.type === "repository_context")
        .forEach((candidate) => {
          if (candidate.action !== "ignore" && candidate.issues.length) {
            throw new Error(`確認事項が残っているRepositoryContext候補があります: ${candidate.issues.join(" / ")}`);
          }
        });
      const accepted = preview.candidates.filter((candidate) => candidate.action !== "ignore");
      const isContentProposal = ["notes", "knowledge_nodes", "sketches", "artifacts"].includes(str(proposal.payload_type));
      const decisions = isContentProposal ? buildContentProposalDecisions(preview) : undefined;
      const rawOperations = buildCandidateOperations(preview.candidates, (data.repository_contexts || []) as BaseRecord[]);
      let acceptedCursor = 0;
      const acceptedDecisions = decisions?.filter((decision) => decision.action === "accept") || [];
      const operationIndexes = rawOperations.map((operation) => {
        const matched = acceptedDecisions.slice(acceptedCursor).findIndex((decision) => decision.type === operation.type);
        if (matched < 0) return acceptedCursor++;
        acceptedCursor += matched + 1;
        return acceptedDecisions[acceptedCursor - 1].entryIndex;
      });
      const operations = stabilizeProposalOperations(proposal.id, rawOperations, isContentProposal ? operationIndexes : undefined);
      for (const candidate of accepted.filter((entry) => entry.type === "artifact")) {
        const normalized = validateArtifactProposal(candidate.entry);
        const entryIndex = preview.candidates.indexOf(candidate);
        operations.push({
          action: "save",
          type: "artifact",
          entity: {
            id: stableProposalEntityId(proposal.id, "artifact", entryIndex),
            title: normalized.title,
            source_type: "ai_proposal",
            source_id: proposal.id,
            theme_id: candidate.theme?.id || null,
            description: str(candidate.entry.reason),
            generated_by: null,
            proposal_materialization: {
              entryIndex,
              themeId: candidate.theme?.id || null,
            },
          },
          options: { source: "ai_proposal" },
        });
      }
      const status = accepted.length && accepted.length < preview.candidates.length ? "partially_accepted" : accepted.length ? "accepted" : "rejected";
      const contentDecision = status === "rejected" ? "reject" as const : "accept" as const;
      const candidates = operations.map((operation) => ({ type: operation.type, entity: operation.entity }));
      await executeCommand({
        commandId: `${proposal.id}:accept:v${Number(proposal.version || 0)}`,
        name: "ApplyAiProposal",
        payload: {
          proposal: { ...proposal, status },
          ...(isContentProposal ? { decision: contentDecision, decisions } : {}),
          candidates,
        },
        actor: { kind: "user" },
        source: "main_ui",
        expectedVersions: [
          { type: "ai_proposal", id: proposal.id, version: Number(proposal.version || 0) },
          ...candidates.flatMap(({ type, entity }) => Number.isInteger(entity.version)
            ? [{ type, id: entity.id, version: Number(entity.version) }]
            : []),
        ],
        issuedAt: str(proposal.received_at || proposal.created_at || proposal.updated_at) || new Date(0).toISOString(),
      } as CommandEnvelope);
      setToast(status === "rejected" ? "Proposalを却下しました。" : "Proposalを採用しました。", "success");
      setPreview(null);
    } catch (error) {
      setToast(`Proposalを採用できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="ai-proposal-panel">
      <section className="panel proposal-inbox-panel">
        <div className="section-heading">
          <h2>Pending Proposal</h2>
          <div className="proposal-refresh-actions">
            <span className="proposal-pending-count">{proposals.length}件</span>
            <Button variant="secondary" compact disabled={refreshing} onClick={() => void refreshProposals()}>
              <IconRefresh size={14} aria-hidden="true" />{refreshing ? "更新中" : "更新"}
            </Button>
          </div>
        </div>
        {!proposals.length && (
          <div className="empty-state proposal-empty-state">
            <IconShieldCheck size={22} aria-hidden="true" />
            <strong>未処理のProposalはありません</strong>
            <span>外部AIから届いた提案はここで確認します。</span>
          </div>
        )}
        {proposals.map((proposal) => (
          <div className="proposal-inbox-row" key={proposal.id}>
            <div className="proposal-row-main">
              <div className="proposal-row-heading">
                <strong>{proposalTypeLabel(proposal)}</strong>
                <ProposalRisk proposal={proposal} />
              </div>
              <dl className="proposal-meta-list">
                <div><dt>Source</dt><dd>{proposalSourceLabel(proposal)}</dd></div>
                <div><dt>Target</dt><dd>{proposalTargetLabel(proposal)}</dd></div>
                <div><dt>Diff</dt><dd>{proposalDiffLabel(proposal)}</dd></div>
                <div><dt>受信</dt><dd>{formatProposalDate(proposal)}</dd></div>
              </dl>
              <p className="proposal-validation-hint"><IconAlertTriangle size={14} aria-hidden="true" />検証・差分・採用範囲はPreviewで確認できます。</p>
            </div>
            <div className="proposal-row-actions">
              <ActionButton action="aiProposalPreview" compact onClick={() => previewProposal(proposal)}>Preview</ActionButton>
              <ActionButton action="actionReject" compact onClick={() => rejectProposal(proposal)}>拒否する</ActionButton>
              <Button variant="secondary" compact onClick={() => { setQuarantineId(proposal.id); setQuarantineReason(""); }}>隔離する</Button>
            </div>
            {quarantineId === proposal.id && (
              <div className="proposal-quarantine-form">
                <label>
                  <span>隔離理由</span>
                  <input value={quarantineReason} onChange={(event) => setQuarantineReason(event.target.value)} placeholder="例: 対象Themeを確認してから扱う" autoFocus />
                </label>
                <Button variant="secondary" compact onClick={() => void quarantineProposal(proposal)}>隔離を保存</Button>
                <Button variant="ghost" compact onClick={() => setQuarantineId("")}>戻る</Button>
              </div>
            )}
          </div>
        ))}
      </section>
      {history.length > 0 && (
        <details className="panel proposal-history">
          <summary><span><IconHistory size={16} aria-hidden="true" />処理履歴</span><strong>{history.length}件</strong></summary>
          <div className="proposal-history-list">
            {history.map((proposal) => (
              <div className="proposal-history-row" key={proposal.id}>
                <div>
                  <strong>{proposalTypeLabel(proposal)}</strong>
                  <small>{proposalSourceLabel(proposal)} / {proposalTargetLabel(proposal)} / {formatProposalDate(proposal)}</small>
                </div>
                <span className={`proposal-status proposal-status-${str(proposal.status)}`}>
                  {proposalStatusLabel(proposal)}
                </span>
                {str(proposal.quarantine_reason) && <p>{str(proposal.quarantine_reason)}</p>}
              </div>
            ))}
          </div>
        </details>
      )}
      {selected && preview && (
        <section className="panel import-preview proposal-preview-panel">
          <div className="section-heading">
            <h2>Proposal Preview</h2>
            <span>{preview.candidates.length}件 / {proposalSourceLabel(selected)}</span>
          </div>
          <p className="proposal-preview-context">Target: {proposalTargetLabel(selected)} · {proposalDiffLabel(selected)}</p>
          {preview.payloadIssues.length > 0 && <p className="alert-note warning">注意: {preview.payloadIssues.join(" / ")}</p>}
          {preview.candidates.map((candidate, index) => (
            <div className={`import-candidate${noteDiffHunks(candidate).length ? " has-note-diff" : ""}`} key={`${candidate.type}-${str(candidate.entry.title)}-${index}`}>
              <div>
                <strong>{str(candidate.entry.title) || str(candidate.entry.label) || str(candidate.entry.summary) || str(candidate.entry.task_id) || str(candidate.entry.relation_type) || "無題"}</strong>
                <small>{candidate.type === "task_work"
                  ? `Task ${str(candidate.entry.task_id)} / ${str(candidate.entry.action)}`
                  : candidate.type === "repository_context"
                    ? `RepositoryContext / ${str(candidate.entry.provider) || "unknown"} / ${str(candidate.entry.canonical_identity) || "identity unavailable"} / credential-free normalized`
                    : `${candidate.type} / ${candidate.theme?.name || "Theme未解決"}`}{candidate.duplicate ? ` / 既存候補: ${str(candidate.duplicate.title || candidate.duplicate.label)}` : ""}</small>
                {candidate.issues.length > 0 && <p className="field-help">確認: {candidate.issues.join(" / ")}</p>}
              </div>
              <select value={candidate.action} onChange={(event) => setPreview((current) => current ? { ...current, candidates: current.candidates.map((entry, itemIndex) => itemIndex === index ? { ...entry, action: event.target.value } : entry) } : current)}>
                <option value="create">新規作成</option>
                {candidate.duplicate && <option value="merge">既存を更新</option>}
                <option value="ignore">無視</option>
              </select>
              {(candidate.type === "sketch" || (candidate.type === "artifact" && str(candidate.entry.media_type) === "image/svg+xml")) && (
                <img
                  className="proposal-svg-preview"
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(validateSafeSvg(candidate.type === "sketch" ? candidate.entry.svg : candidate.entry.content))}`}
                  alt={`${str(candidate.entry.title) || "SVG"} Preview`}
                />
              )}
              {candidate.type === "artifact" && str(candidate.entry.media_type) !== "image/svg+xml" && (
                <pre className="proposal-artifact-preview">{str(candidate.entry.content).slice(0, 4000)}</pre>
              )}
              {noteDiffHunks(candidate).length > 0 && (
                <div className="proposal-note-diff" aria-label="Note変更差分">
                  {noteDiffHunks(candidate).map((hunk, hunkIndex) => (
                    <label className="proposal-diff-hunk" key={`${index}-${hunkIndex}`}>
                      <span>
                        <input
                          type="checkbox"
                          checked={(candidate.acceptedHunks || []).includes(hunkIndex)}
                          onChange={(event) => setPreview((current) => current ? {
                            ...current,
                            candidates: current.candidates.map((entry, itemIndex) => itemIndex === index ? {
                              ...entry,
                              acceptedHunks: event.target.checked
                                ? [...(entry.acceptedHunks || []), hunkIndex].sort((a, b) => a - b)
                                : (entry.acceptedHunks || []).filter((value) => value !== hunkIndex),
                            } : entry),
                          } : current)}
                        />
                        この変更を採用
                      </span>
                      <pre>{hunk.lines.map((line) => `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} ${line.text}`).join("\n")}</pre>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="form-actions">
            <ActionButton action="actionCancel" onClick={() => setPreview(null)}>閉じる</ActionButton>
            <ActionButton action="actionReject" onClick={() => void rejectProposal(selected)}>拒否する</ActionButton>
            <ActionButton action="aiProposalAccept" onClick={() => void acceptProposal(selected)}>採用を保存</ActionButton>
          </div>
        </section>
      )}
    </div>
  );
}

function proposalTimestamp(proposal: BaseRecord): string {
  return str(proposal.updated_at || proposal.received_at || proposal.created_at);
}

function proposalEntries(proposal: BaseRecord): Record<string, unknown>[] {
  const payloadType = str(proposal.payload_type) as ProposalPayloadType;
  if (payloadType === "status_update") return [];
  try {
    const payload = wrapPayload(parsePayload(proposal.payload, payloadType), payloadType);
    return Array.isArray(payload[payloadType]) ? payload[payloadType] as Record<string, unknown>[] : [];
  } catch {
    return [];
  }
}

function proposalTypeLabel(proposal: BaseRecord): string {
  const labels: Record<string, string> = {
    items: "Task / Waiting",
    notes: "Note",
    links: "Link",
    knowledge_nodes: "Knowledge",
    sketches: "Sketch",
    artifacts: "Artifact",
    status_update: "Status Update",
    task_work: "Task Work Receipt",
    repository_contexts: "Repository Context",
  };
  return labels[str(proposal.payload_type)] || "Proposal";
}

function proposalSourceLabel(proposal: BaseRecord): string {
  return str(proposal.source_app) || str(proposal.source) || "不明なSource";
}

function proposalTargetLabel(proposal: BaseRecord): string {
  const request = proposal.request && typeof proposal.request === "object" && !Array.isArray(proposal.request)
    ? proposal.request as Record<string, unknown>
    : {};
  const requestTarget = request.target && typeof request.target === "object" && !Array.isArray(request.target)
    ? request.target as Record<string, unknown>
    : {};
  const entries = proposalEntries(proposal);
  const target = str(requestTarget.id) || str(entries[0]?.target_id);
  const targetType = str(requestTarget.type);
  if (target) return targetType ? `${targetType} ${target}` : target;
  const theme = str(entries[0]?.theme);
  return theme ? `Theme: ${theme}` : "新規候補";
}

function proposalDiffLabel(proposal: BaseRecord): string {
  const entries = proposalEntries(proposal);
  if (entries.some((entry) => str(entry.action) === "merge" || str(entry.target_id))) return "既存データの更新差分";
  if (str(proposal.payload_type) === "artifacts" || str(proposal.payload_type) === "sketches") return "ファイル内容を確認";
  return entries.length ? `${entries.length}件の新規候補` : "内容を確認";
}

function formatProposalDate(proposal: BaseRecord): string {
  const timestamp = proposalTimestamp(proposal);
  if (!timestamp) return "日付なし";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp.slice(0, 10) : date.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

function proposalRisk(proposal: BaseRecord): "update" | "file" | "create" {
  const type = str(proposal.payload_type);
  if (proposalEntries(proposal).some((entry) => str(entry.action) === "merge" || str(entry.target_id))) return "update";
  if (type === "artifacts" || type === "sketches") return "file";
  return "create";
}

function ProposalRisk({ proposal }: { proposal: BaseRecord }) {
  const risk = proposalRisk(proposal);
  const Icon = risk === "update" ? IconPencil : risk === "file" ? IconArchive : IconShieldCheck;
  const label = risk === "update" ? "既存更新" : risk === "file" ? "ファイル確認" : "新規追加";
  return <span className={`proposal-risk proposal-risk-${risk}`}><Icon size={14} aria-hidden="true" />{label}</span>;
}

function proposalStatusLabel(proposal: BaseRecord): string {
  const labels: Record<string, string> = {
    accepted: "採用済み",
    partially_accepted: "一部採用",
    rejected: "拒否済み",
    quarantined: "隔離中",
  };
  return labels[str(proposal.status)] || str(proposal.status) || "処理済み";
}
